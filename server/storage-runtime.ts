import { realpath, stat, statfs } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { hostRuntime } from './host-runtime/index.ts';

export type StorageDevice = { key: string; path: string; freeBytes: number; totalBytes: number };
export type StorageRequest = {
  owner: string;
  taskId: string;
  label: string;
  paths: readonly string[];
  mode: 'read' | 'write';
  buffers: number;
  files: number;
  temporary?: readonly { path: string; bytes: number }[];
  /** Mutually exclusive stages: reserve the peak on each device, not their sum. */
  temporaryPhases?: readonly (readonly { path: string; bytes: number }[])[];
  lane?: 'interactive' | 'background' | 'control';
  signal?: AbortSignal;
  timeoutMs?: number;
};
type Admission = Pick<typeof hostRuntime, 'acquire'>;
type Reservation = { bytes: number; device: StorageDevice };
const reservationDomains = new WeakMap<Admission, Map<string, Map<string, number>>>();

async function inspectDevice(path: string): Promise<StorageDevice> {
  let existing = resolve(path);
  for (;;) {
    try {
      const actual = await realpath(existing);
      const [info, capacity] = await Promise.all([stat(actual), statfs(actual)]);
      // Windows drive/share roots distinguish volumes whose stat.dev is zero.
      const volume = process.platform === 'win32' ? parse(actual).root.toLowerCase() + ':' : '';
      const freeBytes = capacity.bavail * capacity.bsize;
      const totalBytes = capacity.blocks * capacity.bsize;
      if (![freeBytes, totalBytes].every(Number.isSafeInteger) || freeBytes < 0 || totalBytes < 1)
        throw new AppError('无法确认存储设备容量', 503, 'STORAGE_CAPACITY_UNKNOWN');
      return { key: volume + String(info.dev), path: actual, freeBytes, totalBytes };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

/** Admission budgets cover declared asynchronous operations and stream buffers,
 * not OS-wide disk traffic, native process RSS, or arbitrary filesystem callers.
 * A lease must outlive stream closure and temporary-file cleanup. */
export class StorageRuntime {
  private reservations: Map<string, Map<string, number>>;
  constructor(
    private admission: Admission = hostRuntime,
    private device: (path: string) => Promise<StorageDevice> = inspectDevice,
  ) {
    let reservations = reservationDomains.get(admission);
    if (!reservations) {
      reservations = new Map();
      reservationDomains.set(admission, reservations);
    }
    this.reservations = reservations;
  }

  async acquire(request: StorageRequest) {
    request.signal?.throwIfAborted();
    if (
      !request.owner ||
      !request.taskId ||
      !request.paths.length ||
      !Number.isSafeInteger(request.buffers) ||
      request.buffers < 0 ||
      !Number.isSafeInteger(request.files) ||
      request.files < 1
    )
      throw new AppError('存储预算参数无效', 400, 'STORAGE_BUDGET_INVALID');
    const paths = new Map<string, StorageDevice>();
    const phases = request.temporaryPhases?.length ? request.temporaryPhases : [[]];
    const temporary = [...(request.temporary || []), ...phases.flat()];
    for (const path of new Set([...request.paths, ...temporary.map((item) => item.path)])) {
      const info = await this.device(path);
      paths.set(path, info);
    }
    const devices = new Map([...paths.values()].map((info) => [info.key, info]));
    const reserved = new Map<string, Reservation>();
    for (const phase of phases) {
      const stage = new Map<string, Reservation>();
      for (const temporary of [...(request.temporary || []), ...phase]) {
        if (!Number.isSafeInteger(temporary.bytes) || temporary.bytes < 0)
          throw new AppError('临时存储预算无效', 400, 'STORAGE_BUDGET_INVALID');
        if (!temporary.bytes) continue;
        const device = paths.get(temporary.path)!;
        const bytes = (stage.get(device.key)?.bytes || 0) + temporary.bytes;
        if (!Number.isSafeInteger(bytes) || bytes > device.totalBytes)
          throw new AppError('临时文件预留超过设备容量', 507, 'STORAGE_SPACE_REQUIRED');
        stage.set(device.key, { bytes, device });
      }
      for (const [key, value] of stage)
        if (value.bytes > (reserved.get(key)?.bytes || 0)) reserved.set(key, value);
    }
    // All host, volume, task and temporary-space dimensions are acquired in one
    // request: no operation holds one budget while waiting to acquire another.
    const lease = await this.admission.acquire({
      owner: request.owner,
      kind: 'storage',
      label: request.label,
      lane: request.lane || 'background',
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      cost: {
        io: 1,
        ...(request.buffers ? { 'io.buffers': request.buffers } : {}),
        'io.files': request.files,
      },
      partitions: [
        { key: 'storage.task:' + request.taskId, limit: 1 },
        ...[...devices.keys()].flatMap((key) => [
          { key: 'storage.device:' + key, limit: 2 },
          { key: `storage.device.${request.mode}:` + key, limit: request.mode === 'write' ? 1 : 2 },
        ]),
        ...[...reserved].map(([key, value]) => ({
          key: 'storage.temporary:' + key,
          limit: value.device.totalBytes,
          amount: value.bytes,
        })),
      ],
    });
    let released = false;
    let cleanupPending = false;
    for (const [key, value] of reserved) {
      let holders = this.reservations.get(key);
      if (!holders) {
        holders = new Map();
        this.reservations.set(key, holders);
      }
      holders.set(lease.id, value.bytes);
    }
    const release = () => {
      if (released) return;
      released = true;
      for (const key of reserved.keys()) {
        const holders = this.reservations.get(key);
        holders?.delete(lease.id);
        if (!holders?.size) this.reservations.delete(key);
      }
      lease.release();
    };
    try {
      for (const [key, reservation] of reserved) {
        const current = await this.device(reservation.device.path);
        if (current.key !== key) throw new AppError('存储设备已改变', 409, 'STORAGE_DEVICE_CHANGED');
        // Reservations remain charged until cleanup, even after bytes become
        // materialized. This is deliberately conservative, never overbooking free space.
        const claimed = [...(this.reservations.get(key)?.values() || [])].reduce(
          (sum, bytes) => sum + bytes,
          0,
        );
        if (claimed > current.freeBytes)
          throw new AppError('设备可用空间不足以保留临时文件预算', 507, 'STORAGE_SPACE_REQUIRED');
      }
      request.signal?.throwIfAborted();
    } catch (error) {
      release();
      throw error;
    }
    return {
      id: lease.id,
      release,
      assertActive: () => {
        if (released || cleanupPending)
          throw new AppError('存储租约已撤销或等待清理', 409, 'STORAGE_LEASE_REVOKED');
      },
      cleanupPending: (error: unknown) => {
        cleanupPending = true;
        lease.cleanupPending(error);
      },
      get pendingCleanup() {
        return cleanupPending;
      },
      transfer: (owner: string) => lease.transfer(owner),
    };
  }
  async run<T>(request: StorageRequest, work: (lease: StorageLease) => Promise<T>): Promise<T> {
    const lease = await this.acquire(request);
    try {
      request.signal?.throwIfAborted();
      lease.assertActive();
      const result = await work(lease);
      lease.assertActive();
      return result;
    } catch (error) {
      if (lease.pendingCleanup) {
        const failure = new AppError('存储临时文件或句柄尚未确认清理', 503, 'STORAGE_CLEANUP_PENDING');
        failure.cause = error;
        throw failure;
      }
      throw error;
    } finally {
      if (!lease.pendingCleanup) lease.release();
    }
  }
}
export type StorageLease = Awaited<ReturnType<StorageRuntime['acquire']>>;
export const storageRuntime = new StorageRuntime();

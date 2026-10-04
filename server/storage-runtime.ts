import { realpath, stat, statfs, rm } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { Transform } from 'node:stream';

export type StorageDevice = { key: string; path: string; freeBytes: number; totalBytes: number };
export type StorageRequest = {
  owner: string;
  taskId: string;
  label: string;
  paths: readonly string[];
  mode: 'read' | 'write';
  /** A network export holds its slot through remote backpressure. Keep at most
   * one host-wide, leaving a device slot and buffers for the peer's inbound write. */
  transfer?: 'outbound';
  buffers: number;
  files: number;
  temporary?: readonly { path: string; bytes: number }[];
  /** Mutually exclusive stages: reserve the peak on each device, not their sum. */
  temporaryPhases?: readonly (readonly { path: string; bytes: number }[])[];
  /** Unknown-length outputs on these devices grow atomically without queueing. */
  dynamicTemporary?: readonly string[];
  lane?: 'interactive' | 'background' | 'control';
  signal?: AbortSignal;
  timeoutMs?: number;
};
type Admission = Pick<typeof hostRuntime, 'acquire'>;
type Reservation = { bytes: number; device: StorageDevice };
const reservationDomains = new WeakMap<Admission, Map<string, Map<string, number>>>();
const materializedDomains = new WeakMap<Admission, Map<string, Map<string, number>>>();

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
  private materialized: Map<string, Map<string, number>>;
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
    let materialized = materializedDomains.get(admission);
    if (!materialized) {
      materialized = new Map();
      materializedDomains.set(admission, materialized);
    }
    this.materialized = materialized;
  }

  async acquire(request: StorageRequest) {
    const lifetime = pluginAuthority();
    lifetime?.check('storage', true);
    if (lifetime) request = { ...request, owner: lifetime.owner,
      signal: request.signal ? AbortSignal.any([request.signal, lifetime.signal]) : lifetime.signal };
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
    for (const path of new Set([
      ...request.paths,
      ...temporary.map((item) => item.path),
      ...(request.dynamicTemporary || []),
    ])) {
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
    for (const path of request.dynamicTemporary || []) {
      const device = paths.get(path)!;
      if (!reserved.has(device.key)) reserved.set(device.key, { bytes: 1, device });
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
        ...(request.transfer === 'outbound' ? [{ key: 'storage.outbound', limit: 1 }] : []),
        ...[...devices.keys()].flatMap((key) => [
          { key: 'storage.device:' + key, limit: 2 },
          {
            key: `storage.device.${request.transfer || request.mode}:` + key,
            limit: request.transfer || request.mode === 'write' ? 1 : 2,
          },
        ]),
        ...[...reserved].map(([key, value]) => ({
          key: 'storage.temporary:' + key,
          limit: value.device.totalBytes,
          amount: value.bytes,
        })),
      ],
    });
    try { lifetime?.check('storage', true); } catch (error) { lease.release(); throw error; }
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
        const materialized = this.materialized.get(key);
        materialized?.delete(lease.id);
        if (!materialized?.size) this.materialized.delete(key);
      }
      lease.release();
    };
    try {
      for (const [key, reservation] of reserved) {
        const current = await this.device(reservation.device.path);
        if (current.key !== key) throw new AppError('存储设备已改变', 409, 'STORAGE_DEVICE_CHANGED');
        // Reservations remain charged until cleanup, even after bytes become
        // materialized. This is deliberately conservative, never overbooking free space.
        const claimed =
          [...(this.reservations.get(key)?.values() || [])].reduce((sum, bytes) => sum + bytes, 0) -
          [...(this.materialized.get(key)?.values() || [])].reduce((sum, bytes) => sum + bytes, 0);
        if (claimed > current.freeBytes)
          throw new AppError('设备可用空间不足以保留临时文件预算', 507, 'STORAGE_SPACE_REQUIRED');
      }
      request.signal?.throwIfAborted();
    } catch (error) {
      release();
      throw error;
    }
    const assertActive = (checkSignal = true) => {
      if (checkSignal) request.signal?.throwIfAborted();
      if (released || cleanupPending)
        throw new AppError('存储租约已撤销或等待清理', 409, 'STORAGE_LEASE_REVOKED');
    };
    const slots = new Map<string, { key: string; bytes: number; written: number }>();
    let resizing = Promise.resolve();
    const reserveTemporary = (path: string, bytes: number) => {
      const operation = resizing
        .catch(() => {})
        .then(async () => {
          assertActive(bytes !== 0);
          if (!Number.isSafeInteger(bytes) || bytes < 0)
            throw new AppError('临时文件长度无效', 400, 'STORAGE_BUDGET_INVALID');
          const canonical = resolve(path),
            info = await this.device(canonical);
          assertActive(bytes !== 0);
          const initial = reserved.get(info.key);
          if (!initial) throw new AppError('临时文件设备未登记', 409, 'STORAGE_DEVICE_CHANGED');
          const old = slots.get(canonical);
          const written = Math.min(
            bytes,
            (
              await stat(canonical).catch((error) => {
                if (error.code !== 'ENOENT') throw error;
                return { size: 0 };
              })
            ).size,
          );
          assertActive(bytes !== 0);
          slots.set(canonical, { key: info.key, bytes, written });
          const deviceSlots = [...slots.values()].filter((item) => item.key === info.key);
          const amount = Math.max(
            initial.bytes,
            deviceSlots.reduce((sum, item) => sum + item.bytes, 0),
          );
          let materialized = this.materialized.get(info.key);
          if (!materialized) {
            materialized = new Map();
            this.materialized.set(info.key, materialized);
          }
          materialized.set(
            lease.id,
            deviceSlots.reduce((sum, item) => sum + item.written, 0),
          );
          const holders = this.reservations.get(info.key)!;
          const before = holders.get(lease.id)!;
          // Claim before yielding for statfs so simultaneous writers see each other.
          holders.set(lease.id, amount);
          try {
            const current = await this.device(canonical);
            const outstanding =
              [...holders.values()].reduce((sum, item) => sum + item, 0) -
              [...materialized.values()].reduce((sum, item) => sum + item, 0);
            assertActive(bytes !== 0);
            if (current.key !== info.key) throw new AppError('存储设备已改变', 409, 'STORAGE_DEVICE_CHANGED');
            if (amount > before && outstanding > current.freeBytes)
              throw new AppError('临时文件增长超过设备可用空间', 507, 'STORAGE_SPACE_REQUIRED');
            lease.resize({ ['partition:storage.temporary:' + info.key]: amount });
          } catch (error) {
            holders.set(lease.id, before);
            if (old) slots.set(canonical, old);
            else slots.delete(canonical);
            materialized.set(
              lease.id,
              [...slots.values()]
                .filter((item) => item.key === info.key)
                .reduce((sum, item) => sum + item.written, 0),
            );
            throw error;
          }
        });
      resizing = operation;
      return operation;
    };
    return {
      id: lease.id,
      release,
      assertActive,
      reserveTemporary,
      /** Call only after removal or ownership transfer has completed. */
      releaseTemporary: (path: string) => reserveTemporary(path, 0),
      cleanupPending: (error: unknown) => {
        cleanupPending = true;
        lease.cleanupPending(error);
      },
      get pendingCleanup() {
        return cleanupPending;
      },
      transfer: (owner: string) => {
        if (lifetime && owner !== lifetime.owner) throw new AppError('插件不能转移资源归属', 403, 'PLUGIN_RESOURCE_OWNER');
        lease.transfer(owner);
      },
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

/** A caller may explicitly lend its operation's lease. Never infer this from a VM
 * identifier: different operations on the same VM have different lifetimes. */
export function withStorageLease<T>(
  request: StorageRequest,
  borrowed: StorageLease | undefined,
  work: (lease: StorageLease) => Promise<T>,
): Promise<T> {
  if (!borrowed) return storageRuntime.run(request, work);
  borrowed.assertActive();
  request.signal?.throwIfAborted();
  return work(borrowed);
}

/** Reserve an unknown-length file before each bounded chunk reaches its writer. */
export function storageGrowth(lease: StorageLease, file: string, maximum: number) {
  let bytes = 0,
    reserved = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximum) {
        callback(new AppError('文件超过允许的大小', 413));
        return;
      }
      if (bytes <= reserved) {
        callback(null, chunk);
        return;
      }
      reserved = Math.min(maximum, Math.ceil(bytes / 1024 ** 2) * 1024 ** 2);
      lease.reserveTemporary(file, reserved).then(() => callback(null, chunk), callback);
    },
  });
}

export async function removeStorageTemporary(lease: StorageLease, file: string) {
  try {
    await rm(file, { force: true });
  } catch (error) {
    lease.cleanupPending(error);
    throw error;
  }
  if (!lease.pendingCleanup) await lease.releaseTemporary(file);
}

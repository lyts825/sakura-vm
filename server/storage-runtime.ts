/**
 * 模块职责：按设备容量和存储操作申请预算，管理增长预留、临时文件及释放租约。
 * Module purpose: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
 */
import type { StorageRuntimeV1 } from './service-contracts/v1.ts';
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

/**
 * 入口 / Entry: inspectDevice.
 * 功能：在按设备容量和存储操作申请预算中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ key: volume + String(info.dev), path: actual, freeBytes, totalBytes }` 供上层消费（`storage-runtime.ts`）。
 * Purpose: Reads/verifies domain state and constructs a caller-facing result in `storage-runtime.ts`; this entry produces `{ key: volume + String(info.dev), path: actual, freeBytes, totalBytes }` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
 * 处理：通过 `resolve`, `realpath`, `Promise.all`, `stat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resolve`, `realpath`, `Promise.all`, `stat`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: Promise<StorageDevice>；结果来自 / values from `{ key: volume + String(info.dev), path: actual, freeBytes, totalBytes }`.
 * 副作用 / Effects: 更新 / updates `existing`.
 * 拒绝 / Refusals: 条件 / conditions `![freeBytes, totalBytes].every(Number.isSafeInteger) || freeBytes < 0 || totalBytes < 1`; `(error as NodeJS.ErrnoException).code !== 'ENOENT'`; `parent === existing`; 异常 / errors `new AppError('无法确认存储设备容量', 503, 'STORAGE_CAPACITY_UNKNOWN')`; `error`.
 * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `const parent = dirname(existing);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;`; `const parent = dirname(existing);`; these statements determine whether a failure is absorbed or rejected again.
 */
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
  /**
   * 入口 / Entry: StorageRuntime.constructor.
   * 功能：建立 StorageRuntime 的按设备容量和存储操作申请预算上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the StorageRuntime context for this module's responsibility: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: admission: Admission default=hostRuntime; device: (path: string) => Promise<StorageDevice> default=inspectDevice
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `reservationDomains.set`; `materializedDomains.set`; 更新 / updates `reservations`, `this.reservations`, `materialized`, `this.materialized`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

  /**
   * 入口 / Entry: StorageRuntime.acquire.
   * 功能：把路径映射到存储设备并申请 I/O、缓冲、句柄和增长额度，返回可调整的租约。
   * Purpose: Maps paths to devices and admits I/O/buffer/handle/growth budgets, returning an adjustable lease.
   * 设计：全部维度先验证再准入，临时增长受真实容量限制；待清理资源不交还预算，动态调整不持锁排队等待自身释放。
   * Design: Dimensions validate before admission and growth obeys capacity; pending cleanup retains budgets and resizing does not queue behind held resources.
   * 输入 / Inputs: request: StorageRequest
   * 输出 / Returns: `{ id: lease.id, release, assertActive, reserveTemporary, /** Call only after removal or ownership transfer has completed. * /…`.
   * 副作用 / Effects: `AbortSignal.any`; `request.signal.throwIfAborted`; `paths.set`; `stage.set`; `reserved.set`; 更新 / updates `request`, `holders`.
   * 拒绝 / Refusals: 条件 / conditions `!request.owner || !request.taskId || !request.paths.length || !Number.isSafeInteger(request.buffers) || request.buffers < 0 |…`; `!Number.isSafeInteger(temporary.bytes) || temporary.bytes < 0`; `!Number.isSafeInteger(bytes) || bytes > device.totalBytes`; 异常 / errors `new AppError('存储预算参数无效', 400, 'STORAGE_BUDGET_INVALID')`; `new AppError('临时存储预算无效', 400, 'STORAGE_BUDGET_INVALID')`.
   * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
    /**
     * 入口 / Entry: StorageRuntime.acquire.release.
     * 功能：在按设备容量和存储操作申请预算中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`StorageRuntime`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `StorageRuntime`; this entry produces `void` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
     * 处理：通过 `reserved.keys`, `this.reservations.get`, `holders.delete`, `this.reservations.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `reserved.keys`, `this.reservations.get`, `holders.delete`, `this.reservations.delete`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `released`; `!holders?.size`; `!materialized?.size`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `holders.delete`; `this.reservations.delete`; `materialized.delete`; `this.materialized.delete`; `lease.release`; 更新 / updates `released`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: StorageRuntime.acquire.assertActive.
     * 功能：在按设备容量和存储操作申请预算中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`StorageRuntime`）。
     * Purpose: Checks admission, input or resource ownership in `StorageRuntime`; the calls and state transitions below complete the operation. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
     * 处理：通过 `request.signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `request.signal.throwIfAborted`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `checkSignal`.
     * 输入 / Inputs: checkSignal: default=true
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `request.signal.throwIfAborted`.
     * 拒绝 / Refusals: 条件 / conditions `released || cleanupPending`; 异常 / errors `new AppError('存储租约已撤销或等待清理', 409, 'STORAGE_LEASE_REVOKED')`.
     */
    const assertActive = (checkSignal = true) => {
      if (checkSignal) request.signal?.throwIfAborted();
      if (released || cleanupPending)
        throw new AppError('存储租约已撤销或等待清理', 409, 'STORAGE_LEASE_REVOKED');
    };
    const slots = new Map<string, { key: string; bytes: number; written: number }>();
    let resizing = Promise.resolve();
    /**
     * 入口 / Entry: StorageRuntime.acquire.reserveTemporary.
     * 功能：在按设备容量和存储操作申请预算中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`StorageRuntime`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageRuntime`; this entry produces `operation` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
     * 处理：通过 `resizing.catch().then`, `resizing.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `resizing.catch().then`, `resizing.catch`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: path: string; bytes: number
     * 输出 / Returns: `operation`.
     * 副作用 / Effects: 更新 / updates `resizing`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const reserveTemporary = (path: string, bytes: number) => {
      /**
       * 入口 / Entry: StorageRuntime.acquire.callback@214.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（resizing.catch().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (resizing.catch().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `slots.set`; `this.materialized.set`; `materialized.set`; `holders.set`; `slots.delete`; 更新 / updates `materialized`.
       * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(bytes) || bytes < 0`; `!initial`; `current.key !== info.key`; 异常 / errors `new AppError('临时文件长度无效', 400, 'STORAGE_BUDGET_INVALID')`; `new AppError('临时文件设备未登记', 409, 'STORAGE_DEVICE_CHANGED')`.
       * 失败处理：catch 分支执行 `holders.set(lease.id, before);`; `if (old) slots.set(canonical, old); else slots.delete(canonical);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `holders.set(lease.id, before);`; `if (old) slots.set(canonical, old); else slots.delete(canonical);`; these statements determine whether a failure is absorbed or rejected again.
       */
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
      /**
       * 入口 / Entry: StorageRuntime.acquire.releaseTemporary.
       * 功能：把本层请求转交 `reserveTemporary`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `reserveTemporary` and propagates the provider result or rejection.
       * 输入 / Inputs: path: string
       * 输出 / Returns: `reserveTemporary(path, 0)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      releaseTemporary: (path: string) => reserveTemporary(path, 0),
      /**
       * 入口 / Entry: StorageRuntime.acquire.cleanupPending.
       * 功能：在按设备容量和存储操作申请预算中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`StorageRuntime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `StorageRuntime`; the calls and state transitions below complete the operation. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
       * 处理：通过 `lease.cleanupPending` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `lease.cleanupPending`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: error: unknown
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `cleanupPending`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      cleanupPending: (error: unknown) => {
        cleanupPending = true;
        lease.cleanupPending(error);
      },
      /**
       * 入口 / Entry: StorageRuntime.acquire.pendingCleanup.
       * 功能：向调用者提供 `cleanupPending` 的当前视图，不复制独立的业务状态。
       * Purpose: Exposes the current `cleanupPending` view rather than creating separate domain state.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `cleanupPending`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      get pendingCleanup() {
        return cleanupPending;
      },
      /**
       * 入口 / Entry: StorageRuntime.acquire.transfer.
       * 功能：在按设备容量和存储操作申请预算中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`StorageRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageRuntime`; the calls and state transitions below complete the operation. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
       * 处理：通过 `lease.transfer` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `lease.transfer`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: owner: string
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `lifetime && owner !== lifetime.owner`; 异常 / errors `new AppError('插件不能转移资源归属', 403, 'PLUGIN_RESOURCE_OWNER')`.
       */
      transfer: (owner: string) => {
        if (lifetime && owner !== lifetime.owner) throw new AppError('插件不能转移资源归属', 403, 'PLUGIN_RESOURCE_OWNER');
        lease.transfer(owner);
      },
    };
  }
  /**
   * 入口 / Entry: StorageRuntime.run.
   * 功能：在按设备容量和存储操作申请预算中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`StorageRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageRuntime`; this entry produces `result` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
   * 处理：通过 `this.acquire`, `request.signal.throwIfAborted`, `lease.assertActive`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.acquire`, `request.signal.throwIfAborted`, `lease.assertActive`, `work`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!lease.pendingCleanup`.
   * 输入 / Inputs: request: StorageRequest; work: (lease: StorageLease) => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
   * 副作用 / Effects: `this.acquire`; `request.signal.throwIfAborted`; `lease.release`; 更新 / updates `failure.cause`.
   * 拒绝 / Refusals: 条件 / conditions `lease.pendingCleanup`; 异常 / errors `failure`; `error`.
   * 收尾：退出 try 区域时始终执行 `if (!lease.pendingCleanup) lease.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!lease.pendingCleanup) lease.release();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (lease.pendingCleanup) { const failure = new AppError('存储临时文件或句柄尚未确认清理', 503, 'STORAGE_CLEANUP_PENDING'); failure.cause = …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (lease.pendingCleanup) { const failure = new AppError('存储临时文件或句柄尚未确认清理', 503, 'STORAGE_CLEANUP_PENDING'); failure.cause = …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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
export type StorageLease = Awaited<ReturnType<StorageRuntimeV1['acquire']>>;
export const storageRuntime = new StorageRuntime();

/** A caller may explicitly lend its operation's lease. Never infer this from a VM
 * identifier: different operations on the same VM have different lifetimes. */
/**
 * 入口 / Entry: withStorageLease.
 * 功能：在按设备容量和存储操作申请预算中，执行此领域的具体处理步骤并返回其结果；本入口产生 `storageRuntime.run(request, work)` / `work(borrowed)` 供上层消费（`storage-runtime.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-runtime.ts`; this entry produces `storageRuntime.run(request, work)` / `work(borrowed)` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
 * 处理：通过 `storageRuntime.run`, `borrowed.assertActive`, `request.signal.throwIfAborted`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `storageRuntime.run`, `borrowed.assertActive`, `request.signal.throwIfAborted`, `work`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!borrowed`.
 * 输入 / Inputs: request: StorageRequest; borrowed: StorageLease | undefined; work: (lease: StorageLease) => Promise<T>
 * 输出 / Returns: Promise<T>；结果来自 / values from `storageRuntime.run(request, work)`; `work(borrowed)`.
 * 副作用 / Effects: `request.signal.throwIfAborted`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: storageGrowth.
 * 功能：从当前输入或状态计算 `new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > maximum) { callback(new Ap…`，供调用方后续验证或使用。
 * Purpose: Computes `new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > maximum) { callback(new Ap…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: lease: StorageLease; file: string; maximum: number
 * 输出 / Returns: `new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; if (bytes > maximum) { callback(new Ap…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function storageGrowth(lease: StorageLease, file: string, maximum: number) {
  let bytes = 0,
    reserved = 0;
  return new Transform({
    /**
     * 入口 / Entry: storageGrowth.transform.
     * 功能：在按设备容量和存储操作申请预算中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`storage-runtime.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `storage-runtime.ts`; this entry produces `void` for its caller. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
     * 处理：通过 `callback`, `lease.reserveTemporary().then`, `lease.reserveTemporary` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `callback`, `lease.reserveTemporary().then`, `lease.reserveTemporary`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `bytes > maximum`; `bytes <= reserved`.
     * 输入 / Inputs: chunk: Buffer; _encoding; callback
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `bytes`, `reserved`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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

/**
 * 入口 / Entry: removeStorageTemporary.
 * 功能：在按设备容量和存储操作申请预算中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`storage-runtime.ts`）。
 * Purpose: Ends, revokes or cleans resources owned by this domain action in `storage-runtime.ts`; the calls and state transitions below complete the operation. Module context: Admits storage work by device capacity and budget, owning growth reservations, temporary files and leases.
 * 处理：通过 `rm`, `lease.cleanupPending`, `lease.releaseTemporary` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `rm`, `lease.cleanupPending`, `lease.releaseTemporary`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!lease.pendingCleanup`.
 * 输入 / Inputs: lease: StorageLease; file: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `rm`; `lease.releaseTemporary`.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 失败处理：catch 分支执行 `lease.cleanupPending(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `lease.cleanupPending(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function removeStorageTemporary(lease: StorageLease, file: string) {
  try {
    await rm(file, { force: true });
  } catch (error) {
    lease.cleanupPending(error);
    throw error;
  }
  if (!lease.pendingCleanup) await lease.releaseTemporary(file);
}

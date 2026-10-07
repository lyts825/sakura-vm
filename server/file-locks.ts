/**
 * 模块职责：管理实例内文件锁与续期；变更检查目录范围冲突并限制锁记录数量。
 * Module purpose: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { mutablePath } from './files.ts';

type Lease = { path: string; token: string; expiresAt: number };
/**
 * 入口 / Entry: overlaps.
 * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `left === right || left.startsWith(right + '/') || right.startsWith(left + '/')` 供上层消费（`file-locks.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `file-locks.ts`; this entry produces `left === right || left.startsWith(right + '/') || right.startsWith(left + '/')` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
 * 处理：通过 `left.startsWith`, `right.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `left.startsWith`, `right.startsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: left: string; right: string
 * 输出 / Returns: `left === right || left.startsWith(right + '/') || right.startsWith(left + '/')`.
 * 副作用 / Effects: `left.startsWith`; `right.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const overlaps = (left: string, right: string) =>
  left === right || left.startsWith(right + '/') || right.startsWith(left + '/');

/** Short-lived locks for mutations made through Sakura's file API. */
export class FileLocks {
  private leases = new Map<string, Lease[]>();
  private queues = new Map<string, Promise<void>>();
  /**
   * 入口 / Entry: FileLocks.constructor.
   * 功能：建立 FileLocks 的管理实例内文件锁与续期上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FileLocks context for this module's responsibility: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: now: default=() => Date.now(); durationMs: default=120000
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private now = () => Date.now(), private durationMs = 120000) {}

  /**
   * 入口 / Entry: FileLocks.current.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `active` 供上层消费（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; this entry produces `active` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `inline.filter`, `this.leases.get`, `this.leases.set`, `this.leases.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.filter`, `this.leases.get`, `this.leases.set`, `this.leases.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `active.length`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `active`.
   * 副作用 / Effects: `this.leases.set`; `this.leases.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private current(id: string) {
    const active = (this.leases.get(id) || []).filter((lease) => lease.expiresAt > this.now());
    if (active.length) this.leases.set(id, active);
    else this.leases.delete(id);
    return active;
  }

  /**
   * 入口 / Entry: FileLocks.serial.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await action()` 供上层消费（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; this entry produces `await action()` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `this.queues.get`, `Promise.resolve`, `preceding.then`, `this.queues.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queues.get`, `Promise.resolve`, `preceding.then`, `this.queues.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.queues.get(id) === tail`.
   * 输入 / Inputs: id: string; action: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `await action()`.
   * 副作用 / Effects: `this.queues.set`; `release`; `this.queues.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `release();`; `if (this.queues.get(id) === tail) this.queues.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `release();`; `if (this.queues.get(id) === tail) this.queues.delete(id);`; these steps also apply to exceptional exits.
   */
  private async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const preceding = this.queues.get(id) || Promise.resolve();
    let release!:
    /**
     * 中文功能：串行文件锁工作完成后交接下一等待者的本地释放通知。
     * English: Local release notification handing the serialized file lock to its next waiter.
     * 所属 / Owner: FileLocks.serial.release.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const pending = new Promise<void>((done) => { release = done; });
    const tail = preceding.then(() => pending);
    this.queues.set(id, tail);
    await preceding;
    try {
      return await action();
    } finally {
      release();
      if (this.queues.get(id) === tail) this.queues.delete(id);
    }
  }

  /**
   * 入口 / Entry: FileLocks.view.
   * 功能：在管理实例内文件锁与续期中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ path, locked: !!lock, expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null }` 供上层消费（`FileLocks`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FileLocks`; this entry produces `{ path, locked: !!lock, expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null }` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `mutablePath`, `this.current().find`, `this.current` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `this.current().find`, `this.current`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: string
   * 输出 / Returns: `{ path, locked: !!lock, expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string, input: string) {
    const path = mutablePath(input);
    const lock = this.current(id).find((item) => overlaps(item.path, path));
    return { path, locked: !!lock, expiresAt: lock ? new Date(lock.expiresAt).toISOString() : null };
  }

  /**
   * 入口 / Entry: FileLocks.acquire.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(id, async () => { const active = this.current(id); if (active.some((item) => overlaps(item.path, path))) throw ne…` 供上层消费（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; this entry produces `this.serial(id, async () => { const active = this.current(id); if (active.some((item) => overlaps(item.path, path))) throw ne…` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `mutablePath`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: string
   * 输出 / Returns: `this.serial(id, async () => { const active = this.current(id); if (active.some((item) => overlaps(item.path, path))) throw ne…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  acquire(id: string, input: string) {
    const path = mutablePath(input);
    /**
     * 入口 / Entry: FileLocks.acquire.callback@48.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path, token: lease.token, expiresAt: new Date(lease.expiresAt).toISOString() }`.
     * 副作用 / Effects: `this.leases.set`.
     * 拒绝 / Refusals: 条件 / conditions `active.some((item) => overlaps(item.path, path))`; `active.length >= 128`; 异常 / errors `new AppError('文件或所在目录已被锁定', 409)`; `new AppError('此实例的文件锁已达到 128 个上限', 409)`.
     */
    return this.serial(id, async () => {
      const active = this.current(id);
      if (active.some((item) => overlaps(item.path, path)))
        throw new AppError('文件或所在目录已被锁定', 409);
      if (active.length >= 128) throw new AppError('此实例的文件锁已达到 128 个上限', 409);
      const lease = { path, token: randomUUID(), expiresAt: this.now() + this.durationMs };
      this.leases.set(id, [...active, lease]);
      return { path, token: lease.token, expiresAt: new Date(lease.expiresAt).toISOString() };
    });
  }

  /**
   * 入口 / Entry: FileLocks.renew.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(id, async () => { const lease = this.current(id).find((item) => item.path === path && item.token === token); if (…` 供上层消费（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; this entry produces `this.serial(id, async () => { const lease = this.current(id).find((item) => item.path === path && item.token === token); if (…` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `mutablePath`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: string; token: string
   * 输出 / Returns: `this.serial(id, async () => { const lease = this.current(id).find((item) => item.path === path && item.token === token); if (…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  renew(id: string, input: string, token: string) {
    const path = mutablePath(input);
    /**
     * 入口 / Entry: FileLocks.renew.callback@61.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ path, expiresAt: new Date(lease.expiresAt).toISOString() }`.
     * 副作用 / Effects: 更新 / updates `lease.expiresAt`.
     * 拒绝 / Refusals: 条件 / conditions `!lease`; 异常 / errors `new AppError('文件锁已过期，请重新获取', 409)`.
     */
    return this.serial(id, async () => {
      const lease = this.current(id).find((item) => item.path === path && item.token === token);
      if (!lease) throw new AppError('文件锁已过期，请重新获取', 409);
      lease.expiresAt = this.now() + this.durationMs;
      return { path, expiresAt: new Date(lease.expiresAt).toISOString() };
    });
  }

  /**
   * 入口 / Entry: FileLocks.release.
   * 功能：在管理实例内文件锁与续期中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.serial(id, async () => { const leases = this.current(id); if (!leases.some((item) => item.path === path && item.token ==…` 供上层消费（`FileLocks`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FileLocks`; this entry produces `this.serial(id, async () => { const leases = this.current(id); if (!leases.some((item) => item.path === path && item.token ==…` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `mutablePath`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `mutablePath`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: string; token: string
   * 输出 / Returns: `this.serial(id, async () => { const leases = this.current(id); if (!leases.some((item) => item.path === path && item.token ==…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  release(id: string, input: string, token: string) {
    const path = mutablePath(input);
    /**
     * 入口 / Entry: FileLocks.release.callback@71.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ released: path }`.
     * 副作用 / Effects: `this.leases.set`.
     * 拒绝 / Refusals: 条件 / conditions `!leases.some((item) => item.path === path && item.token === token)`; 异常 / errors `new AppError('文件锁已过期或不属于此编辑器', 409)`.
     */
    return this.serial(id, async () => {
      const leases = this.current(id);
      if (!leases.some((item) => item.path === path && item.token === token))
        throw new AppError('文件锁已过期或不属于此编辑器', 409);
      this.leases.set(id, leases.filter((item) => item.path !== path || item.token !== token));
      return { released: path };
    });
  }

  /**
   * 入口 / Entry: FileLocks.withMutation.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(id, async () => { const leases = this.current(id); if (token && !leases.some((item) => item.token === token && pa…` 供上层消费（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; this entry produces `this.serial(id, async () => { const leases = this.current(id); if (token && !leases.some((item) => item.token === token && pa…` for its caller. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `inputs.map`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inputs.map`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; inputs: string[]; token: string | undefined; action: () => Promise<T>
   * 输出 / Returns: `this.serial(id, async () => { const leases = this.current(id); if (token && !leases.some((item) => item.token === token && pa…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  withMutation<T>(id: string, inputs: string[], token: string | undefined, action: () => Promise<T>) {
    const paths = inputs.map(mutablePath);
    /**
     * 入口 / Entry: FileLocks.withMutation.callback@82.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `action()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `token && !leases.some((item) => item.token === token && paths.some((path) => overlaps(item.path, path)))`; `leases.some((item) => paths.some((path) => overlaps(item.path, path)) && item.token !== token)`; 异常 / errors `new AppError('文件锁已过期，请重新获取', 409)`; `new AppError('文件或所在目录已被其他编辑器锁定', 409)`.
     */
    return this.serial(id, async () => {
      const leases = this.current(id);
      if (token && !leases.some((item) => item.token === token && paths.some((path) => overlaps(item.path, path))))
        throw new AppError('文件锁已过期，请重新获取', 409);
      if (leases.some((item) => paths.some((path) => overlaps(item.path, path)) && item.token !== token))
        throw new AppError('文件或所在目录已被其他编辑器锁定', 409);
      return action();
    });
  }

  /**
   * 入口 / Entry: FileLocks.clear.
   * 功能：在管理实例内文件锁与续期中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`FileLocks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FileLocks`; the calls and state transitions below complete the operation. Module context: Owns VM file locks and renewal, detecting directory-scope conflicts and bounding lock records before mutation.
   * 处理：通过 `this.leases.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.leases.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.leases.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  clear() {
    this.leases.clear();
  }
}

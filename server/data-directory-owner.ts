/**
 * 模块职责：以独立本地通道持有数据目录的宿主归属，直到领域清理完成才释放独占保护。
 * Module purpose: Holds kernel-backed directory ownership on a separate local endpoint until domain cleanup releases exclusivity.
 */
import { createHash } from 'node:crypto';
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type { Server } from 'node:net';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { NetworkRuntime, NetworkScope } from './network/index.ts';

/** Kernel-owned local endpoint, released even after an ungraceful host exit.
 * A separate lifetime of the same network layer keeps directory ownership until
 * domain cleanup has finished; draining ordinary transports cannot drop this lock.
 */
export class DataDirectoryOwner {
  readonly directory: string;
  private readonly network = new NetworkRuntime();
  private readonly scope = new NetworkScope({ owner: 'core:data-directory', purpose: 'host-ownership' }, this.network);
  private server?: Server;
  private lease?: ResourceLease;
  private closeTask?: Promise<void>;
  /**
   * 入口 / Entry: DataDirectoryOwner.constructor.
   * 功能：建立 DataDirectoryOwner 的以独立本地通道持有数据目录的宿主归属上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DataDirectoryOwner context for this module's responsibility: Holds kernel-backed directory ownership on a separate local endpoint until domain cleanup releases exclusivity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: directory: string
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.directory`.
   */
  private constructor(directory: string) { this.directory = directory; }
  /**
   * 入口 / Entry: DataDirectoryOwner.resourceId.
   * 功能：向调用者提供 `this.lease?.id` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.lease?.id` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.lease?.id`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get resourceId() { return this.lease?.id; }

  /**
   * 入口 / Entry: DataDirectoryOwner.acquire.
   * 功能：在以独立本地通道持有数据目录的宿主归属中，执行此领域的具体处理步骤并返回其结果；本入口产生 `owner` 供上层消费（`DataDirectoryOwner`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DataDirectoryOwner`; this entry produces `owner` for its caller. Module context: Holds kernel-backed directory ownership on a separate local endpoint until domain cleanup releases exclusivity.
   * 处理：通过 `resolve`, `mkdir`, `realpath`, `dirname` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `resolve`, `mkdir`, `realpath`, `dirname`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `options.create !== false`.
   * 输入 / Inputs: directory: string; options: { create?: boolean } default={}
   * 输出 / Returns: Promise<DataDirectoryOwner>；结果来自 / values from `owner`.
   * 副作用 / Effects: `mkdir`; `suffix.unshift`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `canonical`, `ancestor`, `owner.server`, `owner.lease`.
   * 拒绝 / Refusals: 条件 / conditions `(error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor`; `(cause as NodeJS.ErrnoException).code === 'EADDRINUSE'`; 异常 / errors `error`; `new AppError('该数据目录已由另一宿主管理，或其本地归属通道被占用', 409, 'DATA_DIRECTORY_IN_USE')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;`; `suffix.unshift(basename(ancestor));`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;`; `suffix.unshift(basename(ancestor));`; these statements determine whether a failure is absorbed or rejected again.
   */
  static async acquire(directory: string, options: { create?: boolean } = {}): Promise<DataDirectoryOwner> {
    const absolute = resolve(directory);
    if (options.create !== false) await mkdir(absolute, { recursive: true });
    // A migration reserves its future destination without creating it before
    // atomic publication. Resolve the existing ancestor so aliases still agree.
    let ancestor = absolute;
    const suffix: string[] = [];
    let canonical: string;
    for (;;) {
      try { canonical = resolve(await realpath(ancestor), ...suffix); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
        suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
      }
    }
    const owner = new DataDirectoryOwner(canonical);
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    const hash = createHash('sha256').update(key).digest('hex');
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\sakura-data-${hash}`
      : process.platform === 'linux' ? `\0sakura-data-${hash}` : undefined;
    try {
      const server = owner.server = owner.scope.createServer(socket => socket.destroy());
      /**
       * 入口 / Entry: DataDirectoryOwner.acquire.callback@48.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
       * 输入 / Inputs: done; reject
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `server.listen`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      await new Promise<void>((done, reject) => {
        /**
         * 入口 / Entry: DataDirectoryOwner.acquire.error.
         * 功能：把本层请求转交 `reject`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `reject` and propagates the provider result or rejection.
         * 输入 / Inputs: cause: Error
         * 输出 / Returns: `reject(cause)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const error = (cause: Error) => reject(cause);
        server.once('error', error);
        /**
         * 入口 / Entry: DataDirectoryOwner.acquire.ready.
         * 功能：在以独立本地通道持有数据目录的宿主归属中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`DataDirectoryOwner`）。
         * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DataDirectoryOwner`; the calls and state transitions below complete the operation. Module context: Holds kernel-backed directory ownership on a separate local endpoint until domain cleanup releases exclusivity.
         * 处理：通过 `server.off`, `done` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `server.off`, `done`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const ready = () => { server.off('error', error); done(); };
        if (endpoint) server.listen({ path: endpoint, readableAll: false, writableAll: false }, ready);
        // Other hosts use a stable loopback reservation. A hash/port collision
        // fails closed; another endpoint is never selected to bypass ownership.
        else server.listen({ host: '127.0.0.1', port: 20000 + Number.parseInt(hash.slice(0, 8), 16) % 30000, exclusive: true }, ready);
      });
      owner.lease = hostRuntime.register({ owner: 'core:data-directory', kind: 'metadata.owner',
        label: '数据目录宿主归属', lane: 'control' });
      return owner;
    } catch (cause) {
      await owner.close();
      if ((cause as NodeJS.ErrnoException).code === 'EADDRINUSE')
        throw new AppError('该数据目录已由另一宿主管理，或其本地归属通道被占用', 409, 'DATA_DIRECTORY_IN_USE');
      throw cause;
    }
  }

  /**
   * 入口 / Entry: DataDirectoryOwner.close.
   * 功能：在以独立本地通道持有数据目录的宿主归属中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask ||= (async () => { if (this.server) await this.network.closeServer(this.server); await this.scope.close(); awa…` 供上层消费（`DataDirectoryOwner`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `DataDirectoryOwner`; this entry produces `this.closeTask ||= (async () => { if (this.server) await this.network.closeServer(this.server); await this.scope.close(); awa…` for its caller. Module context: Holds kernel-backed directory ownership on a separate local endpoint until domain cleanup releases exclusivity.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask ||= (async () => { if (this.server) await this.network.closeServer(this.server); await this.scope.close(); awa…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    /**
     * 入口 / Entry: DataDirectoryOwner.close.callback@69.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.network.closeServer`; `this.scope.close`; `this.network.close`; `this.lease.release`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.closeTask ||= (async () => {
      if (this.server) await this.network.closeServer(this.server);
      await this.scope.close();
      await this.network.close();
      this.lease?.release();
    })().catch(error => { this.lease?.cleanupPending(error); this.closeTask = undefined; throw error; });
  }
}

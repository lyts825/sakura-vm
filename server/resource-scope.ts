/**
 * 模块职责：按依赖顺序关闭已登记资源，失败者及其依赖继续保留，重试不重复已成功清理。
 * Module purpose: Closes registered resources in dependency order, retaining failed owners/dependencies and skipping successful cleanup on retry.
 */
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';

export const ClosePhase = {
  admission: 0, clients: 50, services: 200, plugins: 380,
  machines: 390, audit: 400, transport: 900, engine: 1000,
} as const;
type Registry = Pick<typeof hostRuntime, 'register'>;
type ScopeOptions = { owner?: string; registry?: Registry; signal?: AbortSignal };
type Resource = { name: string; order: number; sequence: number; requires: readonly string[];
  /**
   * 签名 / Signature: Resource.dispose.
   * 功能：为按依赖顺序关闭已登记资源声明 dispose 的输入与结果契约，所属容器为 Resource。
   * Purpose: Declares the input/result contract for dispose in Resource. Module responsibility: Closes registered resources in dependency order, retaining failed owners/dependencies and skipping successful cleanup on retry.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: unknown.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  dispose: () => unknown; lease: ResourceLease };

/** 资源创建即登记归属，异步初始化失败也能按依赖关系清理已创建部分。 */
export class ResourceScope {
  private resources: Resource[] = [];
  private sequence = 0;
  private closing?: Promise<void>;
  private settled = false;
  private readonly controller = new AbortController();
  private readonly registry: Registry;
  private readonly owner: string;
  /**
   * 签名 / Signature: ResourceScope.detach.
   * 功能：为按依赖顺序关闭已登记资源声明 detach 的输入与结果契约，所属容器为 ResourceScope。
   * Purpose: Declares the input/result contract for detach in ResourceScope. Module responsibility: Closes registered resources in dependency order, retaining failed owners/dependencies and skipping successful cleanup on retry.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private readonly detach: () => void;
  readonly signal = this.controller.signal;
  /**
   * 入口 / Entry: ResourceScope.constructor.
   * 功能：建立有宿主登记归属的资源容器，并将父取消信号连接到本作用域。
   * Purpose: Creates an owned host-registered resource container and forwards parent cancellation to this scope.
   * 输入 / Inputs: options: ScopeOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `options.signal.addEventListener`; `abort`; 更新 / updates `this.owner`, `this.registry`, `this.detach`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(options: ScopeOptions = {}) {
    this.owner = options.owner ?? 'core:scope';
    this.registry = options.registry ?? hostRuntime;
    /**
     * 入口 / Entry: ResourceScope.constructor.abort.
     * 功能：把本层请求转交 `this.controller.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.controller.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.controller.abort(options.signal?.reason)`.
     * 副作用 / Effects: `this.controller.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => this.controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    /**
     * 入口 / Entry: ResourceScope.constructor.this.detach.
     * 功能：把本层请求转交 `options.signal.removeEventListener`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `options.signal.removeEventListener` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `options.signal?.removeEventListener('abort', abort)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.detach = () => options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) abort();
  }
  /**
   * 入口 / Entry: ResourceScope.defer.
   * 功能：登记资源名、清理顺序及依赖，返回关闭前可交出归属的撤销函数。
   * Purpose: Registers a resource name, cleanup order and dependencies, returning an ownership withdrawal function valid before closing.
   * 设计：关闭开始后拒绝新增或移交，避免同一资源同时被接管和销毁。
   * Design: Rejects registration or transfer after closing begins so a resource cannot be handed over while disposal owns it.
   * 输入 / Inputs: name: string; dispose: () => unknown; order: default=0; requires: readonly string[] default=[]
   * 输出 / Returns: `() => { // 清理开始前才允许交出归属，避免一个资源同时被移交和销毁。 if (!this.closing && this.resources.includes(resource)) { this.resources = this.resou…`.
   * 副作用 / Effects: `this.registry.register`; `this.resources.push`.
   * 拒绝 / Refusals: 条件 / conditions `this.closing || this.signal.aborted`; 异常 / errors `new Error('Resource scope is closing')`.
   */
  defer(name: string, dispose: () => unknown, order = 0, requires: readonly string[] = []) {
    if (this.closing || this.signal.aborted) throw new Error('Resource scope is closing');
    const lease = this.registry.register({ owner: this.owner, kind: 'lifecycle', label: name });
    const resource = { name, dispose, order, requires: [...requires], sequence: this.sequence++, lease };
    this.resources.push(resource);
    return () => {
      // 清理开始前才允许交出归属，避免一个资源同时被移交和销毁。
      if (!this.closing && this.resources.includes(resource)) {
        this.resources = this.resources.filter((item) => item !== resource);
        lease.release();
      }
    };
  }
  /**
   * 入口 / Entry: ResourceScope.own.
   * 功能：把对象的 close 方法登记为清理责任，并原样返回对象供调用方使用。
   * Purpose: Registers the object's close method as a disposal responsibility and returns the same object for its caller.
   * 输入 / Inputs: name: string; value: T; order: default=0
   * 输出 / Returns: T；结果来自 / values from `value`.
   * 副作用 / Effects: `this.defer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  own<T extends {
  /**
   * 签名 / Signature: ResourceScope.own.T.close.
   * 功能：为按依赖顺序关闭已登记资源声明 close 的输入与结果契约，所属容器为 ResourceScope.own.T。
   * Purpose: Declares the input/result contract for close in ResourceScope.own.T. Module responsibility: Closes registered resources in dependency order, retaining failed owners/dependencies and skipping successful cleanup on retry.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: unknown.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  close(): unknown }>(name: string, value: T, order = 0): T {
    this.defer(name, () => value.close(), order);
    return value;
  }
  /**
   * 入口 / Entry: ResourceScope.child.
   * 功能：创建继承取消和登记器的子作用域，并把子清理重试登记到父级。
   * Purpose: Creates a child scope sharing cancellation and registry, registering child cleanup retries with its parent.
   * 输入 / Inputs: name: string; order: default=0; owner: default=this.owner
   * 输出 / Returns: `child`.
   * 副作用 / Effects: `this.defer`.
   * 拒绝 / Refusals: 条件 / conditions `this.closing || this.signal.aborted`; 异常 / errors `new Error('Resource scope is closing')`.
   */
  child(name: string, order = 0, owner = this.owner) {
    if (this.closing || this.signal.aborted) throw new Error('Resource scope is closing');
    const child = new ResourceScope({ owner, registry: this.registry, signal: this.signal });
    this.defer(name, () => child.retryCleanup(), order);
    return child;
  }
  /** 显式重试仅处理保留的失败资源；已成功销毁的资源不会再次调用清理。 */
  /**
   * 入口 / Entry: ResourceScope.retryCleanup.
   * 功能：重新启动已结束但仍保留失败资源的清理，不重复成功清理。
   * Purpose: Restarts cleanup after settlement when failed resources remain without repeating successful disposal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.close()`.
   * 副作用 / Effects: `this.close`; 更新 / updates `this.closing`, `this.settled`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retryCleanup(): Promise<void> {
    if (!this.settled || !this.resources.length) return this.close();
    this.closing = undefined;
    this.settled = false;
    return this.close();
  }
  /**
   * 入口 / Entry: ResourceScope.close.
   * 功能：按消费者先于依赖的顺序销毁资源，聚合失败并保留失败资源及所需依赖。
   * Purpose: Disposes consumers before their dependencies, aggregating failures and retaining failed resources with their required dependencies.
   * 设计：先发布共享 Promise 防止并发重入；同阶段按逆登记顺序，循环依赖作为失败报告而不猜测安全销毁顺序。
   * Design: Publishes the shared Promise before disposal to prevent concurrent reentry; ties use reverse registration order, and dependency cycles are reported rather than guessing a safe disposal order.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closing`.
   * 副作用 / Effects: `this.resources.splice().sort`; `this.resources.splice`; 更新 / updates `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (!this.closing) {
      const resources = this.resources.splice(0).sort((a, b) => a.order - b.order || b.sequence - a.sequence);
      // 先发布关闭 Promise，再开始销毁，让并发 close 调用等待同一次清理。
      /**
       * 入口 / Entry: ResourceScope.close.callback@68.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.controller.abort`; `resource.lease.release`; `remaining.delete`; `failed.add`; `failures.push`; 更新 / updates `this.settled`.
       * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures, 'Application cleanup failed')`.
       * 失败处理：catch 分支执行 `resource.lease.cleanupPending(cause);`; `failed.add(resource);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `resource.lease.cleanupPending(cause);`; `failed.add(resource);`; these statements determine whether a failure is absorbed or rejected again.
       */
      this.closing = Promise.resolve().then(async () => {
        this.controller.abort();
        const failures: Error[] = [];
        const remaining = new Set(resources), failed = new Set<Resource>();
        while (remaining.size) {
          // 消费者先于依赖关闭；消费者失败时保留它依赖的资源，便于下一次原位重试。
          const resource = [...remaining].find(candidate => !failed.has(candidate) &&
            ![...remaining].some(consumer => consumer.requires.includes(candidate.name)));
          if (!resource) break;
          try {
            resource.lease.beginCleanup?.();
            await resource.dispose();
            resource.lease.release();
            remaining.delete(resource);
          } catch (cause) {
            resource.lease.cleanupPending(cause);
            failed.add(resource);
            failures.push(new Error(`Resource cleanup failed: ${resource.name}`, { cause }));
          }
        }
        for (const resource of remaining) {
          if (!failed.has(resource)) {
            const cause = new Error(`Resource retained for dependent cleanup: ${resource.name}`);
            resource.lease.cleanupPending(cause);
          }
          this.resources.push(resource);
        }
        if (remaining.size && !failures.length)
          failures.push(new Error('Resource cleanup dependencies form a cycle: ' +
            [...remaining].map(resource => resource.name).join(', ')));
        this.detach();
        this.settled = true;
        if (failures.length) throw new AggregateError(failures, 'Application cleanup failed');
      });
    }
    return this.closing;
  }
}

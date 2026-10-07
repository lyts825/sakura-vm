/**
 * 模块职责：绑定一次项目执行的身份、取消信号与资源预算；清理回执未确认时保留原额度。
 * Module purpose: Binds an execution to identity, cancellation and resource admission; unconfirmed cleanup retains its original budget.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import {
  hostRuntime,
  withResourceContext,
  captureResourceContext,
  type HostRuntime,
  type ResourceLease,
} from './host-runtime/index.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { vmLiveIdentity, type VmLive as Live } from './vm-reference.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { vmHostIdentity } from './vm-access.ts';
import { pluginAuthority, withPluginCleanup } from './plugin-authority.ts';

export type ExecutionIdentity = Readonly<
  VmIdentity & { projectId: string; configVersion?: string; operationId: string }
>;
export type ExecutionOptions = {
  machines: Machines;
  vmId: string;
  projectId: string;
  signal: AbortSignal;
  live?: Live;
  owner?: string;
  identity?: VmIdentity;
  configVersion?: string;
  delegate?: boolean;
  governor?: Pick<HostRuntime, 'acquire'>;
};
const context = new AsyncLocalStorage<{ scope: ExecutionScope; delegate: boolean }>();
/**
 * 入口 / Entry: cleanupFailed.
 * 功能：识别清理、退役或确认失败的 503 AppError，让这类失败保留执行额度。
 * Purpose: Recognizes cleanup, retirement or confirmation-related 503 AppErrors so their execution capacity remains retained.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: boolean；结果来自 / values from `error instanceof AppError && error.status === 503 && /(?:CLEANUP|RETIRE|UNCONFIRMED)/.test(error.code || '')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const cleanupFailed = (error: unknown): boolean =>
  error instanceof AppError &&
  error.status === 503 &&
  /(?:CLEANUP|RETIRE|UNCONFIRMED)/.test(error.code || '');
type Cleanup = {
  instance?: ReturnType<typeof pluginAuthority>;
  owner: ExecutionScope;
  /**
   * 签名 / Signature: Cleanup.work.
   * 功能：为绑定一次项目执行的身份、取消信号与资源预算声明 work 的输入与结果契约，所属容器为 Cleanup。
   * Purpose: Declares the input/result contract for work in Cleanup. Module responsibility: Binds an execution to identity, cancellation and resource admission; unconfirmed cleanup retains its original budget.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  work: () => Promise<void>;
  complete: boolean;
  attempted: boolean;
  task?: Promise<void>;
};

/** 一次实际操作持有一个预算；显式委派的运行器仅在同一项目调用链内借用该预算。 */
export class ExecutionScope {
  readonly identity: ExecutionIdentity;
  readonly signal: AbortSignal;
  readonly live: Live;
  readonly owner: string;
  private readonly resourceIdentity;
  private readonly lifetime;
  private readonly controller = new AbortController();
  private readonly children = new Set<Promise<unknown>>();
  private childTail: Promise<unknown> = Promise.resolve();
  private failure?: unknown;
  private finished = false;
  private activity!: ReturnType<ReturnType<typeof vmLifetime>['enter']>;
  private lease!: ResourceLease;
  private readonly root: ExecutionScope;
  private cleanups = new Set<Cleanup>();
  private cleanupErrors = new Map<unknown, Cleanup>();
  private failures = new Set<unknown>();
  private settled = false;
  private retired = false;
  /**
   * 入口 / Entry: ExecutionScope.constructor.
   * 功能：捕获客户机运行身份、项目配置与操作 UUID，并把父级身份及取消信号绑定到子执行。
   * Purpose: Captures VM identity, project configuration and an operation UUID, binding parent identity and cancellation to child executions.
   * 设计：先拒绝关闭的宿主和已替换的 live 引用；共享项目调用链只能复用父身份，不能重造一个看似相同的票据。
   * Design: Rejects closing hosts and replaced live references first; a shared project chain reuses its parent ticket rather than manufacturing an apparently equivalent identity.
   * 输入 / Inputs: options: ExecutionOptions; parent: ExecutionScope optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `AbortSignal.any`; 更新 / updates `this.root`, `this.live`, `this.lifetime`, `this.identity`.
   * 拒绝 / Refusals: 条件 / conditions `options.machines.closing`; `!live || options.machines.live.get(options.vmId) !== live`; 异常 / errors `new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING')`; `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private constructor(
    readonly options: ExecutionOptions,
    parent?: ExecutionScope,
  ) {
    this.root = parent?.root || this;
    if (options.machines.closing) throw new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING');
    const live = options.live || options.machines.live.get(options.vmId);
    if (!live || options.machines.live.get(options.vmId) !== live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    this.live = live;
    this.lifetime = vmLifetime(options.vmId, live);
    const identity = options.identity || this.lifetime.capture();
    this.lifetime.assert(identity);
    this.identity =
      parent?.identity ||
      Object.freeze({
        ...identity,
        projectId: options.projectId,
        ...(options.configVersion ? { configVersion: options.configVersion } : {}),
        operationId: randomUUID(),
      });
    this.owner = parent?.owner || options.owner || `execution:${this.identity.operationId}`;
    this.resourceIdentity = captureResourceContext({ ...this.identity, owner: this.owner });
    this.signal = AbortSignal.any([
      options.signal,
      this.lifetime.signal,
      this.controller.signal,
      ...(parent ? [parent.signal] : []),
    ]);
  }
  /**
   * 入口 / Entry: ExecutionScope.assert.
   * 功能：在继续操作前核对取消、执行代次及宿主 live 引用，阻止旧项目执行触碰新客户机。
   * Purpose: Checks cancellation, execution generation and the host live reference before continuing, preventing stale project work from touching a replacement VM.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.options.machines.live.get(this.options.vmId) !== this.live`; 异常 / errors `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  assert() {
    this.signal.throwIfAborted();
    this.lifetime.assert(this.identity);
    if (this.options.machines.live.get(this.options.vmId) !== this.live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  }
  /**
   * 入口 / Entry: ExecutionScope.current.
   * 功能：读取当前异步调用链的执行作用域，供显式委派入口决定能否借用预算。
   * Purpose: Reads the execution scope of the current asynchronous chain so explicit delegation can determine whether its budget is reusable.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `context.getStore()?.scope`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  static current() {
    return context.getStore()?.scope;
  }
  /** 只向原领域所有者交付清理闭包；取消信号不能代替原资源清理成功的确认。 */
  /**
   * 入口 / Entry: ExecutionScope.deferCleanup.
   * 功能：登记由当前执行拥有的原资源清理，并返回可以重复调用的清理入口。
   * Purpose: Registers original-resource cleanup owned by this execution and returns a repeatable cleanup entry.
   * 设计：登记清理时捕获插件归属；实际清理脱离用户操作检查，但仍在原插件清理权限下执行。
   * Design: Captures plugin ownership at registration; actual disposal exits user-operation checks while retaining the original plugin cleanup authority.
   * 输入 / Inputs: work: () => Promise<void>
   * 输出 / Returns: () => Promise<void>；结果来自 / values from `() => this.clean(entry)`.
   * 副作用 / Effects: `this.root.cleanups.add`.
   * 拒绝 / Refusals: 条件 / conditions `this.finished`; 异常 / errors `new AppError('执行作用域已经结束', 409, 'EXECUTION_SCOPE_CLOSED')`.
   */
  deferCleanup(work: () => Promise<void>): () => Promise<void> {
    if (this.finished) throw new AppError('执行作用域已经结束', 409, 'EXECUTION_SCOPE_CLOSED');
    const entry: Cleanup = { owner: this, work, complete: false, attempted: false, instance: pluginAuthority() };
    this.root.cleanups.add(entry);
    return () => this.clean(entry);
  }
  /**
   * 入口 / Entry: ExecutionScope.clean.
   * 功能：合并对同一清理条目的并发调用，记录成功回执或保留尚未确认的失败。
   * Purpose: Coalesces concurrent calls for one cleanup entry and records either its completion receipt or an unconfirmed failure.
   * 设计：失败后清空 task 以便重试，但不设置 complete；成功才尝试交還根执行预算。
   * Design: Clears the task after failure to permit retry without marking completion; only success attempts retirement of the root budget.
   * 输入 / Inputs: entry: Cleanup
   * 输出 / Returns: Promise<void>；结果来自 / values from `void`; `entry.task`.
   * 副作用 / Effects: 更新 / updates `entry.attempted`, `entry.task`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async clean(entry: Cleanup): Promise<void> {
    if (entry.complete) return;
    if (!entry.task) {
      entry.attempted = true;
      /**
       * 入口 / Entry: ExecutionScope.clean.callback@128.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().then).
       * 输入 / Inputs: cause
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.root.cleanupErrors.set`.
       * 拒绝 / Refusals: 异常 / errors `error`.
       */
      entry.task = Promise.resolve()
        .then(() => withoutOperationContext(() => entry.instance ? withPluginCleanup(entry.instance, entry.work) : entry.work()))
        .then(
          () => {
            entry.complete = true;
            this.root.tryRetire();
          },
          (cause) => {
            const error = cleanupFailed(cause)
              ? cause
              : new AppError(
                  `原执行资源清理尚未确认：${cause instanceof Error ? cause.message : String(cause)}`,
                  503,
                  'EXECUTION_CLEANUP_PENDING',
                );
            this.root.cleanupErrors.set(error, entry);
            this.root.recordFailure(error);
            throw error;
          },
        )
        .finally(() => {
          entry.task = undefined;
        });
    }
    return entry.task;
  }
  /** 领域处理器把恢复能力与完整不可变票据一起保存，防止只凭资源 ID 核销新的运行。 */
  /**
   * 入口 / Entry: ExecutionScope.recovery.
   * 功能：创建只核销当前所有者清理条目的恢复闭包。
   * Purpose: Creates a recovery closure that settles only the current owner's cleanup entries.
   * 设计：根执行未退出时拒绝恢复，防止正常执行与恢复并行清理同一资源。
   * Design: Rejects recovery before the root execution exits so normal work and recovery cannot dispose the same resource concurrently.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: () => Promise<void>；结果来自 / values from `async () => { if (!owner.root.settled) throw new AppError('原执行尚未退出，不能并行核销', 409, 'EXECUTION_RECOVERY_ACTIVE'); for (const ent…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  recovery(): () => Promise<void> {
    const owner = this;
    return async () => {
      if (!owner.root.settled)
        throw new AppError('原执行尚未退出，不能并行核销', 409, 'EXECUTION_RECOVERY_ACTIVE');
      for (const entry of owner.root.cleanups) if (entry.owner === owner) await owner.clean(entry);
      owner.root.tryRetire();
    };
  }
  /**
   * 入口 / Entry: ExecutionScope.hasPendingCleanup.
   * 功能：检查根登记表中是否还有属于当前执行且未确认的清理。
   * Purpose: Checks whether the root registry still contains unconfirmed cleanup owned by this execution.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.root.cleanups].some((entry) => entry.owner === this && !entry.complete)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  hasPendingCleanup() {
    return [...this.root.cleanups].some((entry) => entry.owner === this && !entry.complete);
  }
  /**
   * 入口 / Entry: ExecutionScope.recordFailure.
   * 功能：保留根执行的首个失败，并把本次失败加入后续回执核销集合。
   * Purpose: Retains the root execution's first failure and adds this failure to the set requiring later receipt confirmation.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.root.failures.add`; 更新 / updates `this.root.failure`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private recordFailure(error: unknown) {
    this.root.failure ||= error;
    this.root.failures.add(error);
  }
  /**
   * 入口 / Entry: ExecutionScope.tryRetire.
   * 功能：在执行退出、全部清理和历史失败均已核销时释放活动及宿主额度。
   * Purpose: Releases activity and host capacity once execution has exited and every cleanup and historical failure is confirmed.
   * 设计：错误聚合递归核对各条原清理回执；单纯 settled 或取消不能触发资源释放。
   * Design: Recursively checks each original cleanup receipt in aggregate errors; settlement or cancellation alone cannot release resources.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.activity.release`; `this.lease.release`; 更新 / updates `this.retired`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private tryRetire() {
    if (!this.settled || this.retired || [...this.cleanups].some((entry) => !entry.complete)) return;
    /**
     * 入口 / Entry: ExecutionScope.tryRetire.confirmed.
     * 功能：在绑定一次项目执行的身份、取消信号与资源预算中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `Array.isArray(errors) && errors.length > 0 && errors.every(confirmed)` 供上层消费（`ExecutionScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExecutionScope`; this entry produces `true` / `Array.isArray(errors) && errors.length > 0 && errors.every(confirmed)` for its caller. Module context: Binds an execution to identity, cancellation and resource admission; unconfirmed cleanup retains its original budget.
     * 处理：通过 `this.cleanupErrors.get`, `errors.every` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.cleanupErrors.get`, `errors.every`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `this.cleanupErrors.get(error)?.complete`.
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: boolean；结果来自 / values from `true`; `Array.isArray(errors) && errors.length > 0 && errors.every(confirmed)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const confirmed = (error: unknown): boolean => {
      if (this.cleanupErrors.get(error)?.complete) return true;
      const errors = (error as { errors?: unknown[] } | null)?.errors;
      return Array.isArray(errors) && errors.length > 0 && errors.every(confirmed);
    };
    if (![...this.failures].every(confirmed)) return;
    // 执行退出、所有清理回执以及历史清理错误都已确认后，才交还执行和宿主额度。
    this.retired = true;
    this.activity?.release();
    this.lease.release();
  }
  /**
   * 入口 / Entry: ExecutionScope.matches.
   * 功能：比对宿主、VM、项目、live 身份、所有者和配置版本，判断子操作是否可借用本执行。
   * Purpose: Compares host, VM, project, live identity, owner and configuration version to decide whether a child may borrow this execution.
   * 输入 / Inputs: options: ExecutionOptions
   * 输出 / Returns: `( !this.finished && vmHostIdentity(this.options.machines) === vmHostIdentity(options.machines) && this.identity.vmId === opti…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private matches(options: ExecutionOptions) {
    return (
      !this.finished &&
      vmHostIdentity(this.options.machines) === vmHostIdentity(options.machines) &&
      this.identity.vmId === options.vmId &&
      this.identity.projectId === options.projectId &&
      (!options.live || vmLiveIdentity(options.live) === vmLiveIdentity(this.live)) &&
      (!options.owner || options.owner === this.owner) &&
      (!options.configVersion || this.identity.configVersion === options.configVersion)
    );
  }
  /**
   * 入口 / Entry: ExecutionScope.invoke.
   * 功能：在执行与资源异步上下文中调用领域处理器，并保留显式委派标志。
   * Purpose: Invokes the domain handler in execution and resource asynchronous contexts while retaining the explicit delegation flag.
   * 输入 / Inputs: work: (scope: ExecutionScope) => Promise<T>; delegate: boolean
   * 输出 / Returns: `context.run({ scope: this, delegate }, () => withResourceContext(this.resourceIdentity, () => work(this)), )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private invoke<T>(work: (scope: ExecutionScope) => Promise<T>, delegate: boolean) {
    return context.run({ scope: this, delegate }, () =>
      withResourceContext(this.resourceIdentity, () => work(this)),
    );
  }
  /**
   * 入口 / Entry: ExecutionScope.borrow.
   * 功能：把同一项目的委派子操作加入有界串行队列，共享根额度并等待子执行收尾。
   * Purpose: Queues explicitly delegated work for the same project in a bounded serial chain, sharing root capacity and waiting for child settlement.
   * 设计：进入子操作前重查原授权；失败的前一个子任务不阻塞后续排队，但清理未确认会保留在根失败集合。
   * Design: Rechecks original authorization before child admission; an earlier rejected task does not block later queue entries, but unconfirmed cleanup remains in the root failure set.
   * 输入 / Inputs: options: ExecutionOptions; work: (scope: ExecutionScope) => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.children.add`; 更新 / updates `this.childTail`.
   * 拒绝 / Refusals: 条件 / conditions `this.children.size >= 64`; 异常 / errors `new AppError('当前执行的子操作等待队列已满', 429, 'EXECUTION_QUEUE_FULL')`.
   */
  private borrow<T>(options: ExecutionOptions, work: (scope: ExecutionScope) => Promise<T>) {
    this.assert();
    if (this.children.size >= 64)
      throw new AppError('当前执行的子操作等待队列已满', 429, 'EXECUTION_QUEUE_FULL');
    const child = new ExecutionScope(options, this);
    const check = captureOperationCheck();
    /**
     * 入口 / Entry: ExecutionScope.borrow.callback@201.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.childTail.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.childTail.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `await child.invoke(work, !!options.delegate)`.
     * 副作用 / Effects: `child.controller.abort`; 更新 / updates `child.finished`.
     * 拒绝 / Refusals: 条件 / conditions `child.failure !== undefined`; 异常 / errors `error`; `child.failure`.
     * 收尾：退出 try 区域时始终执行 `child.finished = true;`; `await Promise.allSettled([...child.children]);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `child.finished = true;`; `await Promise.allSettled([...child.children]);`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `child.controller.abort(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `child.controller.abort(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const task = this.childTail
      .catch(() => {})
      .then(async () => {
        try {
          child.assert();
          // 子操作借用已有额度，没有再次经过宿主准入，所以进入前重查原授权。
          await check();
          child.assert();
          return await child.invoke(work, !!options.delegate);
        } catch (error) {
          child.controller.abort(error);
          throw error;
        } finally {
          child.finished = true;
          await Promise.allSettled([...child.children]);
          child.controller.abort();
          if (child.failure !== undefined) throw child.failure;
        }
      });
    this.childTail = task;
    this.children.add(task);
    void task
      .catch((error) => {
        if (cleanupFailed(error)) {
          this.failure = error;
          this.recordFailure(error);
        }
      })
      .finally(() => this.children.delete(task));
    return task;
  }
  /**
   * 入口 / Entry: ExecutionScope.run.
   * 功能：为项目操作取得宿主执行预算并进入客户机活动，或对匹配的显式子委派借用父额度。
   * Purpose: Acquires host execution capacity and enters VM activity for project work, or borrows parent capacity for matching explicit delegation.
   * 设计：准入后重查身份；finally 等待子任务并尝试登记的原清理，未确认清理保留租约与活动，禁止用业务结束冒充资源核销。
   * Design: Rechecks identity after admission; finally waits for children and attempts registered original cleanup, retaining the lease/activity when cleanup is unconfirmed rather than equating business completion with release.
   * 输入 / Inputs: options: ExecutionOptions; work: (scope: ExecutionScope) => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `parent.scope.borrow(options, work)`; `await scope.invoke(work, !!options.delegate)`.
   * 副作用 / Effects: `inline.acquire`; `scope.activity.signal.addEventListener`; `scope.controller.abort`; 更新 / updates `scope.lease`, `scope.activity`, `detach`, `scope.failure`.
   * 拒绝 / Refusals: 条件 / conditions `parent`; `options.machines.closing`; `scope.failure !== undefined`; 异常 / errors `new AppError('嵌套执行必须由同一项目操作显式委派', 409, 'EXECUTION_NESTING_INVALID')`; `new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING')`.
   * 收尾：退出 try 区域时始终执行 `scope.finished = true;`; `scope.lease.beginCleanup?.();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `scope.finished = true;`; `scope.lease.beginCleanup?.();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (cleanupFailed(error)) { scope.failure = error; scope.recordFailure(error); }`; `scope.controller.abort(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (cleanupFailed(error)) { scope.failure = error; scope.recordFailure(error); }`; `scope.controller.abort(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  static async run<T>(options: ExecutionOptions, work: (scope: ExecutionScope) => Promise<T>): Promise<T> {
    const parent = context.getStore();
    // 委派子操作在父额度内串行执行；若占着父额度再申请子额度，全部父操作都可能互相等待。
    if (parent) {
      if (parent.delegate && parent.scope.matches(options)) return parent.scope.borrow(options, work);
      throw new AppError('嵌套执行必须由同一项目操作显式委派', 409, 'EXECUTION_NESTING_INVALID');
    }
    const scope = new ExecutionScope(options);
    scope.lease = await (options.governor || hostRuntime).acquire({
      owner: scope.owner,
      kind: 'execution',
      label: `${options.vmId}/${options.projectId}`,
      cost: { execution: 1 },
      partitions: [
        { key: `execution:vm:${options.vmId}`, limit: 8 },
        { key: `execution:project:${options.vmId}:${options.projectId}`, limit: 4 },
      ],
      identity: scope.resourceIdentity,
      signal: scope.signal,
      timeoutMs: 60_000,
    });
    /**
     * 入口 / Entry: ExecutionScope.run.detach.
     * 功能：在绑定一次项目执行的身份、取消信号与资源预算中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ExecutionScope`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ExecutionScope`; the calls and state transitions below complete the operation. Module context: Binds an execution to identity, cancellation and resource admission; unconfirmed cleanup retains its original budget.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    let detach = () => {};
    try {
      if (options.machines.closing) throw new AppError('服务正在关闭', 503, 'RESOURCE_DRAINING');
      scope.assert();
      scope.activity = scope.lifetime.enter(scope.identity);
      // 实例状态切换也能取消此活动，这一信号独立于用户请求本身的取消。
      /**
       * 入口 / Entry: ExecutionScope.run.cancel.
       * 功能：把本层请求转交 `scope.controller.abort`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `scope.controller.abort` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `scope.controller.abort(scope.activity.signal.reason)`.
       * 副作用 / Effects: `scope.controller.abort`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => scope.controller.abort(scope.activity.signal.reason);
      scope.activity.signal.addEventListener('abort', cancel, { once: true });
      /**
       * 入口 / Entry: ExecutionScope.run.detach.
       * 功能：把本层请求转交 `scope.activity.signal.removeEventListener`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `scope.activity.signal.removeEventListener` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `scope.activity.signal.removeEventListener('abort', cancel)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      detach = () => scope.activity.signal.removeEventListener('abort', cancel);
      return await scope.invoke(work, !!options.delegate);
    } catch (error) {
      if (cleanupFailed(error)) {
        scope.failure = error;
        scope.recordFailure(error);
      }
      scope.controller.abort(error);
      throw error;
    } finally {
      scope.finished = true;
      scope.lease.beginCleanup?.();
      await Promise.allSettled([...scope.children]);
      for (const cleanup of scope.cleanups)
        if (!cleanup.attempted) await scope.clean(cleanup).catch(() => {});
      detach();
      scope.controller.abort();
      scope.settled = true;
      scope.tryRetire();
      if (scope.failure !== undefined) {
        if (!scope.retired) {
          scope.lease.cleanupPending(scope.failure);
          scope.activity?.cleanupPending(scope.failure);
        }
      }
      if (scope.failure !== undefined) throw scope.failure;
    }
  }
}

/**
 * 模块职责：向插件暴露受管任务与存储能力，限制租约数量并保留待恢复的任务资源。
 * Module purpose: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { ExecutionScope, type ExecutionOptions } from './execution-scope.ts';
import { withResourceContext, resourceContext } from './host-runtime/index.ts';
import { Jobs, type JobMeta } from './jobs.ts';
import type { Machines } from './machines.ts';
import { networkFor } from './network/index.ts';
import { pluginDataFile } from './plugin-data.ts';
import type { PluginScope } from './plugin-scope.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withPluginAuthority } from './plugin-authority.ts';
import { storageRuntime, type StorageLease, type StorageRequest } from './storage-runtime.ts';
import { vmAccess } from './vm-access.ts';
import { pluginMetadata } from './plugin-metadata.ts';
import { projectTerminalsFor } from './terminal-backend.ts';

type PluginExecution = Pick<ExecutionOptions, 'vmId' | 'projectId' | 'configVersion'> & {
  signal?: AbortSignal;
};
type PluginStorage = Omit<StorageRequest, 'owner' | 'taskId' | 'transfer'>;
export type PluginExecutionScope = Pick<
  ExecutionScope,
  'identity' | 'signal' | 'owner' | 'assert' | 'deferCleanup' | 'recovery' | 'hasPendingCleanup'
>;
export type PluginStorageLease = Omit<StorageLease, 'transfer'>;
type JobOptions = {
  persistent?: boolean;
  /** Preserves the domain's durable task history across upgrades. */ historyName?: string;
};

class PluginJobs extends Jobs {
  private keys = new Set<string>();
  /**
   * 入口 / Entry: PluginJobs.constructor.
   * 功能：建立 PluginJobs 的向插件暴露受管任务与存储能力上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PluginJobs context for this module's responsibility: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: name: string | undefined; pluginId: string; lifetime: PluginScope
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `lifetime.signal.addEventListener`; `lifetime.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    name: string | undefined,
    private pluginId: string,
    private lifetime: PluginScope,
  ) {
    super(name);
    /**
     * 入口 / Entry: PluginJobs.constructor.cancel.
     * 功能：在向插件暴露受管任务与存储能力中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginJobs`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginJobs`; the calls and state transitions below complete the operation. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
     * 处理：通过 `this.cancel` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.cancel`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cancel = () => {
      for (const key of this.keys) this.cancel(key, lifetime.signal.reason);
    };
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    lifetime.add(async () => {
      await this.close();
      lifetime.signal.removeEventListener('abort', cancel);
    });
  }
  /**
   * 入口 / Entry: PluginJobs.start.
   * 功能：在向插件暴露受管任务与存储能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `view` 供上层消费（`PluginJobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginJobs`; this entry produces `view` for its caller. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
   * 处理：通过 `this.lifetime.signal.throwIfAborted`, `withResourceContext`, `this.keys.add`, `Jobs.detached().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifetime.signal.throwIfAborted`, `withResourceContext`, `this.keys.add`, `Jobs.detached().then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string; work: Parameters<JobsV1['start']>[1]; meta: JobMeta default={}
   * 输出 / Returns: `view`.
   * 副作用 / Effects: `this.keys.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  override start(key: string, work: Parameters<JobsV1['start']>[1], meta: JobMeta = {}) {
    this.lifetime.signal.throwIfAborted();
    const view = withResourceContext({ owner: `plugin:${this.pluginId}`, pluginId: this.pluginId }, () =>
      super.start(key, work, { ...meta, owner: `plugin:${this.pluginId}` }),
    );
    this.keys.add(key);
    // Observe completion outside Jobs' nesting context; this observer is not a dependent job.
    void Jobs.detached(() => this.wait(key)).then(
      () => this.keys.delete(key),
      () => this.keys.delete(key),
    );
    return view;
  }
  /**
   * 入口 / Entry: PluginJobs.close.
   * 功能：在向插件暴露受管任务与存储能力中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PluginJobs`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginJobs`; the calls and state transitions below complete the operation. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
   * 处理：通过 `inline.close`, `this.list().some`, `this.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.close`, `this.list().some`, `this.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `inline.close`.
   * 拒绝 / Refusals: 条件 / conditions `this.list().some((job) => job.admission === 'cleanup-pending')`; 异常 / errors `new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING')`.
   */
  override async close() {
    await super.close();
    if (this.list().some((job) => job.admission === 'cleanup-pending'))
      throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
  }
}

/** Cooperative ownership for trusted first-party plugins, not an OS security sandbox.
 * Work callbacks must await resource closure and pass the supplied signal to domain APIs. */
/**
 * 入口 / Entry: pluginCapabilities.
 * 功能：构造插件受管任务、网络、存储及事件能力，把调用绑定到实例权限和作用域。
 * Purpose: Builds managed job/network/storage/event capabilities bound to plugin authority and scope.
 * 设计：调用前重查撤销与取消，创建资源即时登记；失败清理保留原资源能力，不把公开句柄转为无限制宿主访问。
 * Design: Calls recheck revocation/cancellation and immediately own resources; failed cleanup retains original capabilities without unrestricted host access.
 * 输入 / Inputs: pluginId: string; machines: Machines; scope: PluginScope; instance: PluginInstance optional
 * 输出 / Returns: `Object.freeze({ sessions: Object.freeze({ terminals: () => run('execution', () => projectTerminalsFor(machines)) }), networki…`.
 * 副作用 / Effects: `scope.add`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function pluginCapabilities(
  pluginId: string,
  machines: Machines,
  scope: PluginScope,
  instance?: PluginInstance,
) {
  const owner = `plugin:${pluginId}`;
  const identity = instance?.resourceIdentity || { owner, pluginId };
  /**
   * 入口 / Entry: pluginCapabilities.check.
   * 功能：在向插件暴露受管任务与存储能力中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`plugin-capabilities.ts`）。
   * Purpose: Checks admission, input or resource ownership in `plugin-capabilities.ts`; the calls and state transitions below complete the operation. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
   * 处理：通过 `scope.signal.throwIfAborted`, `instance.check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `scope.signal.throwIfAborted`, `instance.check`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: permission: string optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const check = (permission?: string) => {
    scope.signal.throwIfAborted();
    instance?.check(permission, true);
  };
  /**
   * 入口 / Entry: pluginCapabilities.run.
   * 功能：在向插件暴露受管任务与存储能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `instance ? withPluginAuthority(instance, work, () => check(permission)) : withResourceContext(identity, work)` 供上层消费（`plugin-capabilities.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-capabilities.ts`; this entry produces `instance ? withPluginAuthority(instance, work, () => check(permission)) : withResourceContext(identity, work)` for its caller. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
   * 处理：通过 `check`, `withPluginAuthority`, `withResourceContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `check`, `withPluginAuthority`, `withResourceContext`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: permission: string; work: () => T
   * 输出 / Returns: T；结果来自 / values from `instance ? withPluginAuthority(instance, work, () => check(permission)) : withResourceContext(identity, work)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const run = <T>(permission: string, work:
  /**
   * 中文功能：将 pluginCapabilities.run.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by pluginCapabilities.run.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: pluginCapabilities.run.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `T`.
   */
  () => T): T => {
    check(permission);
    return instance
      ? withPluginAuthority(instance, work, () => check(permission))
      : withResourceContext(identity, work);
  };
  const networking = run('network', () => networkFor(owner, 'plugin-network', scope.signal));
  scope.add(() => networking.close());
  /**
   * 入口 / Entry: pluginCapabilities.signalFor.
   * 功能：从当前输入或状态计算 `signal ? AbortSignal.any([scope.signal, signal]) : scope.signal`，供调用方后续验证或使用。
   * Purpose: Computes `signal ? AbortSignal.any([scope.signal, signal]) : scope.signal` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `signal ? AbortSignal.any([scope.signal, signal]) : scope.signal`.
   * 副作用 / Effects: `AbortSignal.any`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const signalFor = (signal?: AbortSignal) =>
    signal ? AbortSignal.any([scope.signal, signal]) : scope.signal;
  let stores = 0;
  return Object.freeze({
    sessions: Object.freeze({
    /**
     * 入口 / Entry: pluginCapabilities.terminals.
     * 功能：把本层请求转交 `run`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `run` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `run('execution', () => projectTerminalsFor(machines))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    terminals: () => run('execution', () => projectTerminalsFor(machines)) }),
    networking,
    vm: vmAccess(machines, scope, instance, (vmId, signal, work) =>
      run('execution', () =>
        ExecutionScope.run(
          {
            machines,
            vmId,
            projectId: resourceContext()?.projectId || 'default',
            owner: ExecutionScope.current()?.owner || owner,
            signal,
            delegate: true,
          },
          work,
        ),
      ),
    ),
    metadata: pluginMetadata(pluginId, owner, scope, run),
    execution: Object.freeze({
      /**
       * 入口 / Entry: pluginCapabilities.run.
       * 功能：把本层请求转交 `scope.run`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `scope.run` and propagates the provider result or rejection.
       * 输入 / Inputs: options: PluginExecution; work: (execution: PluginExecutionScope) => Promise<T>
       * 输出 / Returns: Promise<T>；结果来自 / values from `scope.run(() => run('execution', () => ExecutionScope.run( { ...options, machines, owner: ExecutionScope.current()?.owner || …`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run<T>(options: PluginExecution, work: (execution: PluginExecutionScope) => Promise<T>): Promise<T> {
        return scope.run(() =>
          run('execution', () =>
            ExecutionScope.run(
              {
                ...options,
                machines,
                owner: ExecutionScope.current()?.owner || owner,
                signal: signalFor(options.signal),
                delegate: true,
              },
              (execution) =>
                work(
                  Object.freeze({
                    identity: execution.identity,
                    signal: execution.signal,
                    owner: execution.owner,
                    /**
                     * 入口 / Entry: pluginCapabilities.run.assert.
                     * 功能：把本层请求转交 `execution.assert`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `execution.assert` and propagates the provider result or rejection.
                     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                     * 输出 / Returns: `execution.assert()`.
                     * 副作用 / Effects: `execution.assert`.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    assert: () => execution.assert(),
                    /**
                     * 入口 / Entry: pluginCapabilities.run.deferCleanup.
                     * 功能：把本层请求转交 `execution.deferCleanup`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `execution.deferCleanup` and propagates the provider result or rejection.
                     * 输入 / Inputs: cleanup: () => Promise<void>
                     * 输出 / Returns: `execution.deferCleanup(cleanup)`.
                     * 副作用 / Effects: `execution.deferCleanup`.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    deferCleanup: (cleanup:
                    /**
                     * 中文功能：登记原插件执行资源的异步清理工作，交由资源域等待其完成。
                     * English: Registers asynchronous cleanup of original plugin execution resources for the resource scope to await.
                     * 所属 / Owner: pluginCapabilities.execution.run.deferCleanup.cleanup.
                     * 输入 / Inputs: 无显式参数 / no explicit parameters.
                     * 结果 / Result: `Promise<void>`.
                     */
                    () => Promise<void>) => execution.deferCleanup(cleanup),
                    /**
                     * 入口 / Entry: pluginCapabilities.run.recovery.
                     * 功能：把本层请求转交 `execution.recovery`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `execution.recovery` and propagates the provider result or rejection.
                     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                     * 输出 / Returns: `execution.recovery()`.
                     * 副作用 / Effects: `execution.recovery`.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    recovery: () => execution.recovery(),
                    /**
                     * 入口 / Entry: pluginCapabilities.run.hasPendingCleanup.
                     * 功能：把本层请求转交 `execution.hasPendingCleanup`，沿用该实现的结果与失败路径。
                     * Purpose: Delegates this request to `execution.hasPendingCleanup` and propagates the provider result or rejection.
                     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
                     * 输出 / Returns: `execution.hasPendingCleanup()`.
                     * 副作用 / Effects: `execution.hasPendingCleanup`.
                     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
                     */
                    hasPendingCleanup: () => execution.hasPendingCleanup(),
                  }),
                ),
            ),
          ),
        );
      },
    }),
    storage: Object.freeze({
      /**
       * 入口 / Entry: pluginCapabilities.run.
       * 功能：在向插件暴露受管任务与存储能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `scope.run(() => run('storage', () => storageRuntime.run( { ...request, transfer: undefined, owner, taskId: randomUUID(), sign…` 供上层消费（`plugin-capabilities.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-capabilities.ts`; this entry produces `scope.run(() => run('storage', () => storageRuntime.run( { ...request, transfer: undefined, owner, taskId: randomUUID(), sign…` for its caller. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
       * 处理：通过 `signalFor`, `scope.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `signalFor`, `scope.run`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: request: PluginStorage; work: (lease: PluginStorageLease, signal: AbortSignal) => Promise<T>
       * 输出 / Returns: Promise<T>；结果来自 / values from `scope.run(() => run('storage', () => storageRuntime.run( { ...request, transfer: undefined, owner, taskId: randomUUID(), sign…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run<T>(
        request: PluginStorage,
        work: (lease: PluginStorageLease, signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        const signal = signalFor(request.signal);
        return scope.run(() =>
          run('storage', () =>
            storageRuntime.run(
              { ...request, transfer: undefined, owner, taskId: randomUUID(), signal },
              (lease) => {
                const { transfer: _transfer, ...publicLease } = lease;
                return work(Object.freeze(publicLease), signal);
              },
            ),
          ),
        );
      },
    }),
    jobs: Object.freeze({
      /**
       * 入口 / Entry: pluginCapabilities.create.
       * 功能：在向插件暴露受管任务与存储能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `store` 供上层消费（`plugin-capabilities.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-capabilities.ts`; this entry produces `store` for its caller. Module context: Exposes managed jobs/storage to plugins, bounding leases and retaining unresolved job resources for recovery.
       * 处理：通过 `check`, `pluginDataFile`, `run` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `check`, `pluginDataFile`, `run`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `options.historyName`.
       * 输入 / Inputs: name: string; options: JobOptions default={}
       * 输出 / Returns: JobsV1；结果来自 / values from `store`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `stores >= 16`; 异常 / errors `new AppError('插件任务存储数量已达上限', 429, 'PLUGIN_QUEUE_FULL')`.
       */
      create(name: string, options: JobOptions = {}): JobsV1 {
        check('jobs');
        pluginDataFile(pluginId, name); // Same bounded identifier rules as plugin metadata.
        if (options.historyName) pluginDataFile(pluginId, options.historyName);
        if (stores >= 16) throw new AppError('插件任务存储数量已达上限', 429, 'PLUGIN_QUEUE_FULL');
        const store = run(
          'jobs',
          () =>
            new PluginJobs(
              options.persistent === false ? undefined : options.historyName || `plugin-${pluginId}-${name}`,
              pluginId,
              scope,
            ),
        );
        stores++;
        return store;
      },
    }),
    /**
     * 入口 / Entry: pluginCapabilities.diagnostics.
     * 功能：把本层请求转交 `scope.diagnostics`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `scope.diagnostics` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `scope.diagnostics()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    diagnostics: () => scope.diagnostics(),
  });
}

export type PluginCapabilities = ReturnType<typeof pluginCapabilities>;

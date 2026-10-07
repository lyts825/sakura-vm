/**
 * 模块职责：提供插件终端后端及子句柄，子句柄只能释放自身持有的连接资源。
 * Module purpose: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
 */
import type { ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import type { Machines } from './machines.ts';
import { ProjectTerminals } from './project-terminals.ts';
import type { PreparedProject } from './project-preparation.ts';
import { Workspaces } from './workspaces.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { pluginAuthority, withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { vmAccess } from './vm-access.ts';
import { vmHostIdentity } from './vm-reference.ts';
import { ExecutionScope } from './execution-scope.ts';
import { resourceContext, withResourceContext } from './host-runtime/context.ts';
import { AppError } from '../shared/errors.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';
import type { ServiceBroker } from './service-broker.ts';

export type TerminalService = ProjectTerminalsV1;
const backends = new WeakMap<object, TerminalBackend>();

/** One provider owns native sessions; each consumer owns only its connection leases. */
export class TerminalBackend {
  private root: ProjectTerminals;
  /**
   * 入口 / Entry: TerminalBackend.constructor.
   * 功能：建立 TerminalBackend 的提供插件终端后端及子句柄上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the TerminalBackend context for this module's responsibility: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; instance: PluginInstance; context: ConstructorParameters<typeof Workspaces>[1] optional; broker: ServiceBroker optional; host: PluginInstance optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `instance.scope.add`; `broker.registerSystem`; `backends.set`; 更新 / updates `this.root`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(machines: Machines, readonly instance: PluginInstance,
    context?: ConstructorParameters<typeof Workspaces>[1], private broker?: ServiceBroker, private host?: PluginInstance) {
    const port = vmAccess(machines, instance.scope, instance, (vmId, signal, work) =>
      ExecutionScope.run({ machines, vmId, projectId: resourceContext()?.projectId || 'default',
        signal, owner: ExecutionScope.current()?.owner || instance.owner, delegate: true }, work));
    const workspace = withPluginAuthority(instance, () => new Workspaces(port, context, { background: false }));
    this.root = withPluginAuthority(instance, () => new ProjectTerminals(port, workspace));
    instance.scope.add(() => workspace.close());
    broker?.registerSystem(instance, this.root);
    backends.set(machines, this);
    instance.scope.add(() => withPluginCleanup(instance, () => this.root.close()));
  }
  /**
   * 入口 / Entry: TerminalBackend.handle.
   * 功能：在提供插件终端后端及子句柄中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.freeze({ get workspaces() { check(); return publicRoot.workspaces; }, get preparation() { check(); return publicRoot.p…` 供上层消费（`TerminalBackend`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalBackend`; this entry produces `Object.freeze({ get workspaces() { check(); return publicRoot.workspaces; }, get preparation() { check(); return publicRoot.p…` for its caller. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
   * 处理：通过 `AbortSignal.any`, `consumer.scope.add`, `this.broker.system` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `consumer.scope.add`, `this.broker.system`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `consumer`.
   * 输入 / Inputs: consumer: default=pluginAuthority()
   * 输出 / Returns: TerminalService；结果来自 / values from `Object.freeze({ get workspaces() { check(); return publicRoot.workspaces; }, get preparation() { check(); return publicRoot.p…`.
   * 副作用 / Effects: `AbortSignal.any`; `consumer.scope.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  handle(consumer = pluginAuthority()): TerminalService {
    const leases = new Set<PreparedProject>();
    const lifetime = new AbortController();
    const signal = consumer ? AbortSignal.any([consumer.signal, lifetime.signal]) : lifetime.signal;
    /**
     * 入口 / Entry: TerminalBackend.handle.check.
     * 功能：在提供插件终端后端及子句柄中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`TerminalBackend`）。
     * Purpose: Checks admission, input or resource ownership in `TerminalBackend`; the calls and state transitions below complete the operation. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
     * 处理：通过 `signal.throwIfAborted`, `consumer.check`, `this.instance.check` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `consumer.check`, `this.instance.check`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const check = () => { signal.throwIfAborted(); consumer?.check('execution', true); this.instance.check(undefined, true); };
    /**
     * 入口 / Entry: TerminalBackend.handle.invoke.
     * 功能：在提供插件终端后端及子句柄中，执行此领域的具体处理步骤并返回其结果；本入口产生 `withPluginAuthority(this.instance, () => withResourceContext({ callerPluginInstanceId: consumer?.identity, callerPluginGenera…` 供上层消费（`TerminalBackend`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalBackend`; this entry produces `withPluginAuthority(this.instance, () => withResourceContext({ callerPluginInstanceId: consumer?.identity, callerPluginGenera…` for its caller. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
     * 处理：通过 `check`, `withPluginAuthority` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `check`, `withPluginAuthority`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: work: () => T
     * 输出 / Returns: T；结果来自 / values from `withPluginAuthority(this.instance, () => withResourceContext({ callerPluginInstanceId: consumer?.identity, callerPluginGenera…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const invoke = <T>(work:
    /**
     * 中文功能：在终端后端准入上下文执行并返回结果的同步工作。
     * English: Synchronous work returning a result inside terminal-backend admission context.
     * 所属 / Owner: TerminalBackend.handle.invoke.work.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `T`.
     */
    () => T): T => {
      check(); return withPluginAuthority(this.instance, () => withResourceContext({
        callerPluginInstanceId: consumer?.identity, callerPluginGeneration: consumer?.generation,
      }, work), check);
    };
    /**
     * 入口 / Entry: TerminalBackend.handle.retain.
     * 功能：在提供插件终端后端及子句柄中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`TerminalBackend`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `TerminalBackend`; this entry produces `result` for its caller. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
     * 处理：通过 `consumer.scope.observe`, `this.instance.scope.observe`, `cleanupReceipt`, `leases.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `consumer.scope.observe`, `this.instance.scope.observe`, `cleanupReceipt`, `leases.add`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `signal.aborted`.
     * 输入 / Inputs: pending: Promise<PreparedProject>
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `consumer.scope.observe`; `this.instance.scope.observe`; `leases.add`; `release`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const retain = async (pending: Promise<PreparedProject>) => {
      consumer?.scope.observe(pending); this.instance.scope.observe(pending);
      const prepared = await pending;
      let closed = false;
      /**
       * 入口 / Entry: TerminalBackend.handle.callback@51.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（cleanupReceipt）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (cleanupReceipt).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `leases.delete`; 更新 / updates `closed`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const release = cleanupReceipt(async () => {
        if (closed) return;
        await withPluginCleanup(this.instance, () => prepared.release());
        closed = true; leases.delete(result);
      });
      const result = Object.freeze({ ...prepared, release }); leases.add(result);
      if (signal.aborted) { await release(); signal.throwIfAborted(); }
      return result;
    };
    /**
     * 入口 / Entry: TerminalBackend.handle.close.
     * 功能：在提供插件终端后端及子句柄中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`TerminalBackend`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `TerminalBackend`; the calls and state transitions below complete the operation. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
     * 处理：通过 `lifetime.abort`, `Promise.all`, `inline.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `lifetime.abort`, `Promise.all`, `inline.map`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lifetime.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const close = async () => { lifetime.abort(); await Promise.all([...leases].map(lease => lease.release())); };
    if (consumer) consumer.scope.add(close);
    const root = this.root;
    const publicRoot = this.broker ? this.broker.system<TerminalService>(consumer || this.host!, 'terminal-backend', ['terminal-backend'])! : root;
    return Object.freeze({
      /**
       * 入口 / Entry: TerminalBackend.handle.workspaces.
       * 功能：从当前输入或状态计算 `publicRoot.workspaces`，供调用方后续验证或使用。
       * Purpose: Computes `publicRoot.workspaces` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `publicRoot.workspaces`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get workspaces() { check(); return publicRoot.workspaces; },
      /**
       * 入口 / Entry: TerminalBackend.handle.preparation.
       * 功能：从当前输入或状态计算 `publicRoot.preparation`，供调用方后续验证或使用。
       * Purpose: Computes `publicRoot.preparation` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `publicRoot.preparation`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get preparation() { check(); return publicRoot.preparation; },
      /**
       * 入口 / Entry: TerminalBackend.handle.prepare.
       * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
       * 输入 / Inputs: args: Parameters<ProjectTerminalsV1['prepare']>
       * 输出 / Returns: `invoke(() => { args[4] = args[4] ? AbortSignal.any([signal, args[4]]) : signal; return retain(root.prepare(...args)); })`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepare: (...args: Parameters<ProjectTerminalsV1['prepare']>) => invoke(() => {
        args[4] = args[4] ? AbortSignal.any([signal, args[4]]) : signal; return retain(root.prepare(...args));
      }),
      /**
       * 入口 / Entry: TerminalBackend.handle.prepareTask.
       * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
       * 输入 / Inputs: args: Parameters<ProjectTerminalsV1['prepareTask']>
       * 输出 / Returns: `invoke(() => { args[2] = args[2] ? AbortSignal.any([signal, args[2]]) : signal; return retain(root.prepareTask(...args)); })`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepareTask: (...args: Parameters<ProjectTerminalsV1['prepareTask']>) => invoke(() => {
        args[2] = args[2] ? AbortSignal.any([signal, args[2]]) : signal; return retain(root.prepareTask(...args));
      }),
      /**
       * 入口 / Entry: TerminalBackend.handle.validate.
       * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
       * 输入 / Inputs: args: Parameters<ProjectTerminalsV1['validate']>
       * 输出 / Returns: `invoke(() => root.validate(...args))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      validate: (...args: Parameters<ProjectTerminalsV1['validate']>) => invoke(() => root.validate(...args)),
      /**
       * 入口 / Entry: TerminalBackend.handle.stop.
       * 功能：把本层请求转交 `invoke`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `invoke` and propagates the provider result or rejection.
       * 输入 / Inputs: args: Parameters<ProjectTerminalsV1['stop']>
       * 输出 / Returns: `invoke(() => { if (consumer && consumer.pluginId !== 'terminal-workspace') throw new AppError('终端子句柄只能释放自己持有的连接', 403, 'PLUGI…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      stop: (...args: Parameters<ProjectTerminalsV1['stop']>) => invoke(() => {
        if (consumer && consumer.pluginId !== 'terminal-workspace')
          throw new AppError('终端子句柄只能释放自己持有的连接', 403, 'PLUGIN_TERMINAL_OWNERSHIP');
        args[3] = args[3] ? AbortSignal.any([signal, args[3]]) : signal; return root.stop(...args);
      }), close,
    });
  }
}

/**
 * 入口 / Entry: projectTerminalsFor.
 * 功能：在提供插件终端后端及子句柄中，执行此领域的具体处理步骤并返回其结果；本入口产生 `backend.handle()` / `new ProjectTerminals(machines, workspaces, context, options)` 供上层消费（`terminal-backend.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `terminal-backend.ts`; this entry produces `backend.handle()` / `new ProjectTerminals(machines, workspaces, context, options)` for its caller. Module context: Provides plugin terminal backends/subhandles; each subhandle can release only its own held connections.
 * 处理：通过 `backends.get`, `vmHostIdentity`, `backend.handle`, `pluginAuthority` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `backends.get`, `vmHostIdentity`, `backend.handle`, `pluginAuthority`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `backend`.
 * 输入 / Inputs: machines: ConstructorParameters<typeof ProjectTerminals>[0]; workspaces: WorkspacesV1 optional; context: ConstructorParameters<typeof Workspaces>[1] optional; options: ConstructorParameters<typeof ProjectTerminals>[3] optional
 * 输出 / Returns: TerminalService；结果来自 / values from `backend.handle()`; `new ProjectTerminals(machines, workspaces, context, options)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `pluginAuthority()`; 异常 / errors `new AppError('插件终端提供者尚未运行', 503, 'PLUGIN_SERVICE_UNAVAILABLE')`.
 */
export function projectTerminalsFor(machines: ConstructorParameters<typeof ProjectTerminals>[0],
  workspaces?: WorkspacesV1, context?: ConstructorParameters<typeof Workspaces>[1],
  options?: ConstructorParameters<typeof ProjectTerminals>[3]): TerminalService {
  const backend = backends.get(vmHostIdentity(machines));
  if (backend) return backend.handle();
  if (pluginAuthority()) throw new AppError('插件终端提供者尚未运行', 503, 'PLUGIN_SERVICE_UNAVAILABLE');
  return new ProjectTerminals(machines, workspaces, context, options);
}

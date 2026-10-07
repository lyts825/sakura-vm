/**
 * 模块职责：采样项目服务健康状态并维护期望值，后台检查遵循当前实例与项目运行状态。
 * Module purpose: Samples project service health against expectations, following current VM/project runtime state for background checks.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { runServices, serviceOrder } from './project-services.ts';
import { ProjectRunScopes, projectIdentityTask } from './project-run-scope.ts';
import { Jobs } from './jobs.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { privateLog, redactValues } from './secrets.ts';
import { AppError } from '../shared/errors.ts';
import { ProjectServiceScopes, projectServiceBinding } from './project-service-scope.ts';

const lifecycleRefusals = new Set([
  'GUEST_TASK_CLEANUP_FAILED', 'GUEST_TASK_SCOPE_UNAVAILABLE',
  'SERVICE_CLEANUP_FAILED', 'SERVICE_SCOPE_UNAVAILABLE',
  'SERVICE_SCOPE_UNMANAGED', 'SERVICE_SCOPE_CHANGED',
  'SERVICE_IDENTITY_REQUIRED',
]);
/**
 * 入口 / Entry: needsManualCleanup.
 * 功能：在采样项目服务健康状态并维护期望值中，执行此领域的具体处理步骤并返回其结果；本入口产生 `error instanceof AppError && (lifecycleRefusals.has(error.code || '') || error.code?.startsWith('PROJECT_IDENTITY_') || error…` 供上层消费（`service-health.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `service-health.ts`; this entry produces `error instanceof AppError && (lifecycleRefusals.has(error.code || '') || error.code?.startsWith('PROJECT_IDENTITY_') || error…` for its caller. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
 * 处理：通过 `lifecycleRefusals.has`, `error.code.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lifecycleRefusals.has`, `error.code.startsWith`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `error instanceof AppError && (lifecycleRefusals.has(error.code || '') || error.code?.startsWith('PROJECT_IDENTITY_') || error…`.
 * 副作用 / Effects: `error.code.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const needsManualCleanup = (error: unknown) => error instanceof AppError &&
  (lifecycleRefusals.has(error.code || '') || error.code?.startsWith('PROJECT_IDENTITY_') ||
    error.code?.startsWith('PROJECT_DIRECTORY_') || error.code?.startsWith('DIRECTORY_MIGRATION_'));

export type HealthView = {
  name: string;
  desired: boolean;
  status: 'waiting' | 'healthy' | 'unhealthy' | 'restarting' | 'stopped' | 'exhausted';
  failures: number;
  restarts: number;
  checkedAt?: string;
  nextCheck: number;
  error?: string;
};
export class ServiceHealth {
  jobs = new Jobs('health');
  private states = new Map<string, Map<string, HealthView>>();
  private checks = new Map<string, AbortController>();
  private generations = new Map<string, number>();
  private blockedChecks = new Map<string, Set<string>>();
  private pending?: Promise<void>;
  private closed = false;
  private timer?: ScheduleHandle;
  /**
   * 签名 / Signature: ServiceHealth.removeAction.
   * 功能：为采样项目服务健康状态并维护期望值声明 removeAction 的输入与结果契约，所属容器为 ServiceHealth。
   * Purpose: Declares the input/result contract for removeAction in ServiceHealth. Module responsibility: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private removeAction?: () => void;
  private initialized = false;
  /**
   * 入口 / Entry: ServiceHealth.onChange.
   * 功能：在采样项目服务健康状态并维护期望值中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `state.desired`, `state.status`（`ServiceHealth`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceHealth`; the outcome is recorded in `state.desired`, `state.status`. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `this.states.keys`, `this.machines.live.has`, `key.split`, `this.blockedChecks.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.states.keys`, `this.machines.live.has`, `key.split`, `this.blockedChecks.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.machines.live.has(key.split(':')[0])`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.blockedChecks.delete`; `this.checks.get().abort`; `this.generations.set`; 更新 / updates `state.desired`, `state.status`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    for (const key of this.states.keys())
      if (!this.machines.live.has(key.split(':')[0])) {
        this.blockedChecks.delete(key);
        this.checks.get(key)?.abort();
        this.jobs.cancel(key);
        this.generations.set(key, (this.generations.get(key) || 0) + 1);
        for (const state of this.states.get(key)!.values()) {
          state.desired = false;
          state.status = 'stopped';
        }
      }
  };
  /**
   * 入口 / Entry: ServiceHealth.constructor.
   * 功能：建立 ServiceHealth 的采样项目服务健康状态并维护期望值上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ServiceHealth context for this module's responsibility: Samples project service health against expectations, following current VM/project runtime state for background checks. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: { deferInitialization?: boolean } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private workspaces: WorkspacesV1,
    options: { deferInitialization?: boolean } = {},
  ) {
    if (!options.deferInitialization) this.init();
  }
  /**
   * 入口 / Entry: ServiceHealth.init.
   * 功能：在采样项目服务健康状态并维护期望值中，初始化并核对当前领域状态；本入口产生 `void` 供上层消费（`ServiceHealth`）。
   * Purpose: Initializes and verifies current domain state in `ServiceHealth`; this entry produces `void` for its caller. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `this.workspaces.beforeAction`, `this.machines.on`, `scheduler.register`, `this.machines.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.beforeAction`, `this.machines.on`, `scheduler.register`, `this.machines.off`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.initialized`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.removeAction`, `this.timer`, `this.initialized`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('服务健康检查已关闭', 503)`; `error`.
   * 失败处理：catch 分支执行 `this.machines.off('change', this.onChange);`; `this.removeAction?.();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.machines.off('change', this.onChange);`; `this.removeAction?.();`; these statements determine whether a failure is absorbed or rejected again.
   */
  init() {
    if (this.closed) throw new AppError('服务健康检查已关闭', 503);
    if (this.initialized) return;
    try {
      this.removeAction = this.workspaces.beforeAction((id, action, service) => this.expect(id, action, service));
      this.machines.on('change', this.onChange);
      this.timer = scheduler.register({ owner: 'plugin:service-health', label: '项目服务健康检查', intervalMs: 5000,
        overlap: 'skip',
        /**
         * 入口 / Entry: ServiceHealth.init.run.
         * 功能：在采样项目服务健康状态并维护期望值中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.pending`（`ServiceHealth`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceHealth`; the outcome is recorded in `this.pending`. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
         * 处理：通过 `this.tick().finally`, `this.tick` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.tick().finally`, `this.tick`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!this.pending`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 更新 / updates `this.pending`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: async () => {
          if (!this.pending)
            this.pending = this.tick()
              .finally(() => {
                this.pending = undefined;
              });
          await this.pending;
        } });
      this.initialized = true;
    } catch (error) {
      this.machines.off('change', this.onChange);
      this.removeAction?.();
      this.removeAction = undefined;
      throw error;
    }
  }
  /**
   * 入口 / Entry: ServiceHealth.expect.
   * 功能：在采样项目服务健康状态并维护期望值中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(success: boolean) => { if (this.generations.get(key) !== generation || this.closed) return; if (!success) { this.states.set(…` 供上层消费（`ServiceHealth`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceHealth`; this entry produces `(success: boolean) => { if (this.generations.get(key) !== generation || this.closed) return; if (!success) { this.states.set(…` for its caller. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `this.workspaces.projects.key`, `this.workspaces.jobs.view`, `this.checks.get().abort`, `this.checks.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.key`, `this.workspaces.jobs.view`, `this.checks.get().abort`, `this.checks.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; action: 'start' | 'stop'; service: string optional
   * 输出 / Returns: `(success: boolean) => { if (this.generations.get(key) !== generation || this.closed) return; if (!success) { this.states.set(…`.
   * 副作用 / Effects: `this.checks.get().abort`; `this.generations.set`; `previous.set`; `this.states.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.workspaces.jobs.view(key)?.status === 'running'`; 异常 / errors `new AppError('请等待项目操作完成', 409)`.
   */
  async expect(id: string, action: 'start' | 'stop', service?: string) {
    const key = this.workspaces.projects?.key(id) || id;
    if (this.workspaces.jobs.view(key)?.status === 'running') throw new AppError('请等待项目操作完成', 409);
    this.checks.get(key)?.abort();
    this.jobs.cancel(key);
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    await this.jobs.wait(key);
    const project = await this.workspaces.config(id),
      previous = this.states.get(key) || new Map<string, HealthView>();
    const generation = this.generations.get(key),
      saved = new Map([...previous].map(([name, state]) => [name, { ...state }]));
    const names =
      action === 'start'
        ? serviceOrder(project.services || [], service).map((s) => s.name)
        : service
          ? [service]
          : (project.services || []).map((s) => s.name);
    for (const name of names)
      previous.set(name, { name, desired: false, status: 'stopped', failures: 0, restarts: 0, nextCheck: 0 });
    this.states.set(key, previous);
    /**
     * 入口 / Entry: ServiceHealth.expect.callback@109.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: success: boolean
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `this.states.set`; `previous.set`; `this.blockedChecks.get().delete`; `this.blockedChecks.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return (success: boolean) => {
      if (this.generations.get(key) !== generation || this.closed) return;
      if (!success) {
        this.states.set(key, saved);
        return;
      }
      for (const name of names)
        previous.set(name, {
          name,
          desired: action === 'start',
          status: action === 'start' ? 'waiting' : 'stopped',
          failures: 0,
          restarts: 0,
          nextCheck: 0,
        });
      for (const name of names) this.blockedChecks.get(key)?.delete(name);
      if (!this.blockedChecks.get(key)?.size) this.blockedChecks.delete(key);
    };
  }
  /**
   * 入口 / Entry: ServiceHealth.view.
   * 功能：在采样项目服务健康状态并维护期望值中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ services: (config.services || []) .filter((s) => s.health) .map<HealthView>( (s) => this.states.get(key)?.get(s.name) || { …` 供上层消费（`ServiceHealth`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ServiceHealth`; this entry produces `{ services: (config.services || []) .filter((s) => s.health) .map<HealthView>( (s) => this.states.get(key)?.get(s.name) || { …` for its caller. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `this.workspaces.projects.key`, `this.workspaces.config`, `inline.filter().map`, `inline.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.key`, `this.workspaces.config`, `inline.filter().map`, `inline.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ services: (config.services || []) .filter((s) => s.health) .map<HealthView>( (s) => this.states.get(key)?.get(s.name) || { …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const key = this.workspaces.projects?.key(id) || id;
    const config = await this.workspaces.config(id);
    return {
      services: (config.services || [])
        .filter((s) => s.health)
        .map<HealthView>(
          (s) =>
            this.states.get(key)?.get(s.name) || {
              name: s.name,
              desired: false,
              status: 'stopped',
              failures: 0,
              restarts: 0,
              nextCheck: 0,
            },
        ),
      job: this.jobs.view(key),
    };
  }
  /**
   * 入口 / Entry: ServiceHealth.observed.
   * 功能：把本层请求转交 `inline.flatMap`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `inline.flatMap` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `[...this.states].flatMap(([key, states]) => { const [vmId, projectId = 'default'] = key.split(':'); return vmId === id ? [...…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  observed(id: string) {
    return [...this.states].flatMap(([key, states]) => {
      const [vmId, projectId = 'default'] = key.split(':');
      return vmId === id ? [...states.values()].map((state) => ({ ...state, projectId })) : [];
    });
  }
  /**
   * 入口 / Entry: ServiceHealth.tick.
   * 功能：在采样项目服务健康状态并维护期望值中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ServiceHealth`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ServiceHealth`; the calls and state transitions below complete the operation. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `key.split`, `this.workspaces.projects.inScope`, `check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `key.split`, `this.workspaces.projects.inScope`, `check`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.workspaces.projects`.
   * 输入 / Inputs: now: default=Date.now()
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async tick(now = Date.now()) {
    for (const [key, states] of this.states) {
      const [id, projectId = 'default'] = key.split(':');
      /**
       * 入口 / Entry: ServiceHealth.tick.check.
       * 功能：把本层请求转交 `this.checkProject`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.checkProject` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.checkProject(id, key, states, now)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const check = () => this.checkProject(id, key, states, now);
      if (this.workspaces.projects) await this.workspaces.projects.inScope(id, projectId, check);
      else await check();
    }
  }
  /**
   * 入口 / Entry: ServiceHealth.checkProject.
   * 功能：检查项目服务完整归属和探测结果，更新健康状态并按期望策略处理。
   * Purpose: Checks full project-service ownership/probe results and updates health state under expectations.
   * 设计：配置、执行代次及原会话在每次检查中固定；未知服务不自动停止或重启，失败仍释放检查准备资源。
   * Design: Each check pins configuration/generation/session; unknown services are not automatically restarted and failures release check preparation.
   * 输入 / Inputs: id: string; key: string; states: Map<string, HealthView>; now: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.checks.set`; `this.jobs.start`; `blocked.add`; `this.blockedChecks.set`; `this.checks.delete`; 更新 / updates `privateValues`, `state.nextCheck`, `state.checkedAt`, `state.status`.
   * 拒绝 / Refusals: 条件 / conditions `ownership.status === 'prepared' || ownership.status === 'unconfirmed' || (ownership.status === 'running' && ownership.record?…`; `ownership.status === 'running'`; `!ownership.record || !await identities.hasRun(id, ownership.record.projectId, ownership.record.runId)`; 异常 / errors `new AppError('服务启动或配置归属未确认，请先停止并重建', 409, 'SERVICE_SCOPE_CHANGED')`; `new AppError('服务尚未接入项目账号，请先确认停止全部后代再重新启动', 409, 'SERVICE_IDENTITY_REQUIRED')`.
   * 收尾：退出 try 区域时始终执行 `if (this.checks.get(key) === abort) this.checks.delete(key);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (this.checks.get(key) === abort) this.checks.delete(key);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `if (!abort.signal.aborted && generation === this.generations.get(key)) { const unconfirmed = needsManualCleanup(error); const…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (!abort.signal.aborted && generation === this.generations.get(key)) { const unconfirmed = needsManualCleanup(error); const…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async checkProject(id: string, key: string, states: Map<string, HealthView>, now: number) {
    if (
      this.closed ||
      !this.machines.live.has(id) ||
      this.machines.state(id) !== 'running' ||
      this.workspaces.jobs.view(key)?.status === 'running' ||
      this.jobs.view(key)?.status === 'running'
    )
      return;
    const abort = new AbortController(),
      generation = this.generations.get(key);
    this.checks.set(key, abort);
    let privateValues: string[] | undefined;
    try {
      const project = await this.workspaces.resolvedConfig(id);
      privateValues = projectPrivateValues(project);
      for (const service of project.services || []) {
        const policy = service.health,
          state = states.get(service.name);
        if (!policy || !state?.desired || state.nextCheck > now || abort.signal.aborted || this.blockedChecks.get(key)?.has(service.name)) continue;
        state.nextCheck = now + policy.interval * 1000;
        const ownership = await new ProjectServiceScopes(this.machines, id, project).status(service.name, abort.signal);
        if (ownership.status === 'prepared' || ownership.status === 'unconfirmed' ||
            (ownership.status === 'running' && ownership.record?.binding !== projectServiceBinding(project, service)))
          throw new AppError('服务启动或配置归属未确认，请先停止并重建', 409, 'SERVICE_SCOPE_CHANGED');
        if (ownership.status === 'running') {
          const identities = new ProjectRunScopes(this.machines);
          if (!ownership.record || !await identities.hasRun(id, ownership.record.projectId, ownership.record.runId))
            throw new AppError('服务尚未接入项目账号，请先确认停止全部后代再重新启动', 409, 'SERVICE_IDENTITY_REQUIRED');
          if (!await identities.readonlyActive(id, ownership.record.projectId, ownership.record.runId, abort.signal))
            throw new AppError('服务账号票据归属未确认，请先停止并重建', 409, 'SERVICE_SCOPE_CHANGED');
        }
        const result = ownership.status !== 'running' ? { code: 1 } : await projectIdentityTask(
          this.machines,
          id,
          project,
          { command: policy.command, environment: { ...project.environment, ...service.environment } },
          abort.signal,
          undefined,
          policy.timeout * 1000,
        ).catch((error) => {
          abort.signal.throwIfAborted();
          if (needsManualCleanup(error)) throw error;
          return { code: 1, stderr: (error as Error).message };
        });
        if (generation !== this.generations.get(key)) break;
        state.checkedAt = new Date().toISOString();
        if (result.code === 0) {
          state.status = 'healthy';
          state.failures = 0;
          delete state.error;
          continue;
        }
        state.failures++;
        state.status = 'unhealthy';
        state.error = '健康检查失败';
        if (!policy.restart || state.failures < policy.failures) continue;
        if (state.restarts >= policy.maxRestarts) {
          state.status = 'exhausted';
          state.error = '已达到自动重启上限，请检查日志后手动启动';
          continue;
        }
        state.restarts++;
        state.status = 'restarting';
        state.nextCheck = now + Math.min(3600, policy.backoff * 2 ** (state.restarts - 1)) * 1000;
        const affected = serviceOrder(project.services || []).filter(
          (s) =>
            states.get(s.name)?.desired &&
            serviceOrder(project.services || [], s.name).some(
              (dependency) => dependency.name === service.name,
            ),
        );
        /**
         * 入口 / Entry: ServiceHealth.checkProject.callback@236.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
         * 输入 / Inputs: rawLog; signal
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `blocked.add`; `this.blockedChecks.set`; 更新 / updates `state.status`, `paused.status`, `paused.error`, `state.error`.
         * 拒绝 / Refusals: 条件 / conditions `generation !== this.generations.get(key)`; 异常 / errors `new AppError('服务意图已改变')`; `new AppError(detail, error instanceof AppError ? error.status : 500, error instanceof AppError ? error.code : undefined)`.
         * 收尾：退出 try 区域时始终执行 `output.flush();`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `output.flush();`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `const detail = redactValues((error as Error).message, projectPrivateValues(project));`; `if (generation === this.generations.get(key)) { if (needsManualCleanup(error)) { const blocked = this.blockedChecks.get(key) …`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `const detail = redactValues((error as Error).message, projectPrivateValues(project));`; `if (generation === this.generations.get(key)) { if (needsManualCleanup(error)) { const blocked = this.blockedChecks.get(key) …`; these statements determine whether a failure is absorbed or rejected again.
         */
        this.jobs.start(
          key,
          async (rawLog, signal) => {
            const output = privateLog(rawLog, projectPrivateValues(project));
            try {
              if (generation !== this.generations.get(key)) throw new AppError('服务意图已改变');
              for (const target of [...affected].reverse()) {
                signal.throwIfAborted();
                await runServices(this.machines, id, project, 'stop', output.write, signal, target.name);
              }
              for (const target of affected) {
                signal.throwIfAborted();
                await runServices(this.machines, id, project, 'start', output.write, signal, target.name);
              }
              if (generation === this.generations.get(key)) state.status = 'waiting';
            } catch (error) {
              const detail = redactValues((error as Error).message, projectPrivateValues(project));
              if (generation === this.generations.get(key)) {
                if (needsManualCleanup(error)) {
                  const blocked = this.blockedChecks.get(key) || new Set<string>();
                  for (const target of affected) {
                    const paused = states.get(target.name);
                    if (!paused?.desired) continue;
                    blocked.add(target.name);
                    paused.status = 'unhealthy';
                    paused.error = '服务归属或清理未确认，自动检查与重启已暂停；请核查任务归属后手动停止服务。' + detail;
                  }
                  this.blockedChecks.set(key, blocked);
                } else {
                  state.status = 'unhealthy';
                  state.error = detail;
                }
              }
              throw new AppError(detail, error instanceof AppError ? error.status : 500,
                error instanceof AppError ? error.code : undefined);
            } finally {
              output.flush();
            }
          },
          {
            title: `服务自动重启 · ${service.name}（${state.restarts}/${policy.maxRestarts}）`,
            vmId: id,
            projectId: this.workspaces.projects?.current(id) || 'default',
          },
        );
        break;
      }
    } catch (error) {
      if (!abort.signal.aborted && generation === this.generations.get(key)) {
        const unconfirmed = needsManualCleanup(error);
        const detail = privateValues ? redactValues((error as Error).message, privateValues) : '';
        for (const state of states.values())
          if (state.desired) {
            state.status = 'unhealthy';
            state.checkedAt = new Date().toISOString();
            if (unconfirmed) {
              const blocked = this.blockedChecks.get(key) || new Set<string>();
              blocked.add(state.name);
              this.blockedChecks.set(key, blocked);
              state.error = '健康检查任务隔离或清理未确认，自动检查与重启已暂停；请核查任务归属后手动停止服务。' + detail;
            } else {
              state.error = '无法完成健康检查，请检查项目配置和私密配置引用' + (detail ? '：' + detail : '');
            }
          }
      }
    } finally {
      if (this.checks.get(key) === abort) this.checks.delete(key);
    }
  }
  /**
   * 入口 / Entry: ServiceHealth.close.
   * 功能：在采样项目服务健康状态并维护期望值中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `this.removeAction`（`ServiceHealth`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ServiceHealth`; the outcome is recorded in `this.closed`, `this.removeAction`. Module context: Samples project service health against expectations, following current VM/project runtime state for background checks.
   * 处理：通过 `this.machines.off`, `this.removeAction`, `this.checks.values`, `abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.removeAction`, `this.checks.values`, `abort.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `abort.abort`; `this.timer.close`; `this.jobs.close`; 更新 / updates `this.closed`, `this.removeAction`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    this.removeAction?.();
    this.removeAction = undefined;
    for (const abort of this.checks.values()) abort.abort();
    await this.timer?.close();
    await this.pending;
    await this.jobs.close();
  }
}

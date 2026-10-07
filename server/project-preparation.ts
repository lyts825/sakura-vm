/**
 * 模块职责：串行准备项目目录与执行资源，记录保留租约并在关闭时等待原准备资源清理。
 * Module purpose: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';
import {
  ensureProjectNetworkScript,
  projectNetworkCheckScript,
  projectNetworkNamespace,
} from './project-network-isolation.ts';
import { ProjectRunScopes } from './project-run-scope.ts';
import { terminalShell } from './project-shell.ts';
import { quote } from './shell.ts';
import { Workspaces } from './workspaces.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { preparationLeases, type PreparationLease as Lease } from './project-preparation-registry.ts';
export { assertProjectPreparationIdle } from './project-preparation-registry.ts';

export type PreparationContext = {
  id: string;
  scope: string;
  project: Project;
  version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>;
  abort: AbortSignal;
  identity?: VmIdentity;
};
export type PreparedProject = {
  command: string;
  projectId: string;
  networkIsolation: string;
  terminalId?: string;
  /**
   * 签名 / Signature: PreparedProject.release.
   * 功能：为串行准备项目目录与执行资源声明 release 的输入与结果契约，所属容器为 PreparedProject。
   * Purpose: Declares the input/result contract for release in PreparedProject. Module responsibility: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void | Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  release: () => void | Promise<void>;
  signal?: AbortSignal;
  captured?: {
    project: Project;
    configVersion: string;
    live: PreparationContext['live'];
    identity?: VmIdentity;
  };
};

/** Shared configuration capture and admission lease for tasks and terminals. */
export class ProjectPreparation {
  readonly workspaces: WorkspacesV1;
  private ownedWorkspaces?: Workspaces;
  private leases = new Set<Lease>();
  private pending = new Map<string, Promise<unknown>>();
  private controller = new AbortController();
  /**
   * 签名 / Signature: ProjectPreparation.unguard.
   * 功能：为串行准备项目目录与执行资源声明 unguard 的输入与结果契约，所属容器为 ProjectPreparation。
   * Purpose: Declares the input/result contract for unguard in ProjectPreparation. Module responsibility: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unguard: () => void;
  private scopes: Pick<ProjectRunScopes, 'assertAdmission'>;
  /**
   * 入口 / Entry: ProjectPreparation.signal.
   * 功能：向调用者提供 `this.controller.signal` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.controller.signal` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.controller.signal`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get signal() {
    return this.controller.signal;
  }
  /**
   * 入口 / Entry: ProjectPreparation.constructor.
   * 功能：建立 ProjectPreparation 的串行准备项目目录与执行资源上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectPreparation context for this module's responsibility: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1 optional; context: ConstructorParameters<typeof Workspaces>[1] optional; scopes: Pick<ProjectRunScopes, 'assertAdmission'> optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.ownedWorkspaces`, `this.workspaces`, `this.scopes`, `this.unguard`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    workspaces?: WorkspacesV1,
    context?: ConstructorParameters<typeof Workspaces>[1],
    scopes?: Pick<ProjectRunScopes, 'assertAdmission'>,
  ) {
    this.ownedWorkspaces = workspaces ? undefined : new Workspaces(machines, context);
    this.workspaces = workspaces || this.ownedWorkspaces!;
    this.scopes = scopes || new ProjectRunScopes(machines);
    /**
     * 入口 / Entry: ProjectPreparation.constructor.callback@66.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.workspaces.beforeConfigChange）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.workspaces.beforeConfigChange).
     * 输入 / Inputs: id; previous; next
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `[...this.leases].some( (lease) => lease.vmId === id && lease.projectId === (previous._workspace || 'default'), )`; 异常 / errors `new AppError('请先结束此项目的终端或命令，再修改目录或网络模式', 409)`.
     */
    this.unguard = this.workspaces.beforeConfigChange(async (id, previous, next) => {
      if (
        previous.directory === next.directory &&
        (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')
      )
        return;
      if (
        [...this.leases].some(
          (lease) => lease.vmId === id && lease.projectId === (previous._workspace || 'default'),
        )
      )
        throw new AppError('请先结束此项目的终端或命令，再修改目录或网络模式', 409);
    });
  }
  /**
   * 入口 / Entry: ProjectPreparation.serial.
   * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`ProjectPreparation`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; this entry produces `operation` for its caller. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 处理：通过 `inline.catch().then`, `inline.catch`, `this.pending.get`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.catch().then`, `inline.catch`, `this.pending.get`, `Promise.resolve`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal; action: (signal: AbortSignal) => Promise<T>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `this.pending.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  serial<T>(id: string, signal: AbortSignal, action: (signal: AbortSignal) => Promise<T>) {
    /**
     * 入口 / Entry: ProjectPreparation.serial.callback@83.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.machines .locked(`project-preparation:${id}`, () => action(AbortSignal.any([signal, activity.signal]))) .finally(activit…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!live`; 异常 / errors `new AppError('客户机运行身份未确认', 409)`.
     */
    const operation = (this.pending.get(id) || Promise.resolve())
      .catch(() => {})
      .then(() => {
        signal.throwIfAborted();
        const live = this.machines.live.get(id);
        if (!live) throw new AppError('客户机运行身份未确认', 409);
        const activity = vmLifetime(id, live).enter();
        return this.machines
          .locked(`project-preparation:${id}`, () => action(AbortSignal.any([signal, activity.signal])))
          .finally(activity.release);
      });
    this.pending.set(id, operation);
    void operation
      .finally(() => {
        if (this.pending.get(id) === operation) this.pending.delete(id);
      })
      .catch(() => {});
    return operation;
  }
  /**
   * 入口 / Entry: ProjectPreparation.hasTerminal.
   * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...preparationLeases(this.machines)].some( (lease) => lease.vmId === vmId && lease.terminalId === terminalId, )` 供上层消费（`ProjectPreparation`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; this entry produces `[...preparationLeases(this.machines)].some( (lease) => lease.vmId === vmId && lease.terminalId === terminalId, )` for its caller. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 处理：通过 `inline.some`, `preparationLeases` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.some`, `preparationLeases`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; terminalId: string
   * 输出 / Returns: `[...preparationLeases(this.machines)].some( (lease) => lease.vmId === vmId && lease.terminalId === terminalId, )`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  hasTerminal(vmId: string, terminalId: string) {
    return [...preparationLeases(this.machines)].some(
      (lease) => lease.vmId === vmId && lease.terminalId === terminalId,
    );
  }
  /**
   * 入口 / Entry: ProjectPreparation.prepare.
   * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(id, abort, (abort) => this.workspaces.projects.with(id, projectId, async () => { if (this.machines.state(id) !== …` 供上层消费（`ProjectPreparation`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; this entry produces `this.serial(id, abort, (abort) => this.workspaces.projects.with(id, projectId, async () => { if (this.machines.state(id) !== …` for its caller. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 处理：通过 `AbortSignal.any`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal | undefined; options: { task: boolean; readOnly?: boolean; verifyOnly?: boolean }; action: (context: PreparationContext) => Promise<T>
   * 输出 / Returns: `this.serial(id, abort, (abort) => this.workspaces.projects.with(id, projectId, async () => { if (this.machines.state(id) !== …`.
   * 副作用 / Effects: `AbortSignal.any`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async prepare<T>(
    id: string,
    projectId: string | null | undefined,
    signal: AbortSignal | undefined,
    options: { task: boolean; readOnly?: boolean; verifyOnly?: boolean },
    action: (context: PreparationContext) => Promise<T>,
  ) {
    const { task, readOnly = false } = options;
    const abort = AbortSignal.any([this.signal, ...(signal ? [signal] : [])]);
    /**
     * 入口 / Entry: ProjectPreparation.prepare.callback@115.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.workspaces.projects.with）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.workspaces.projects.with).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `action({ id, scope, project, version, live, abort: executionAbort, identity })`.
     * 副作用 / Effects: `AbortSignal.any`; `this.machines.exec`; `executionAbort.throwIfAborted`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!live`; `!readOnly`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`; `new AppError('客户机运行身份未确认', 409)`.
     */
    return this.serial(id, abort, (abort) =>
      this.workspaces.projects.with(id, projectId,
      /**
       * 中文功能：捕获 live、寿命、项目版本和执行身份，通过准入后按只读/task/verifyOnly 准备网络和目录，再复核并交付上下文。
       * English: Captures live/lifetime/project-version identity, checks admission and prepares networking/directory by readonly/task/verifyOnly mode, then rechecks and delivers context.
       * 所属 / Owner: ProjectPreparation.prepare.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 设计：verifyOnly 不修复缺失 namespace；task 不创建缺失目录，避免读核验隐式迁移原项目执行身份。
       * Design: verifyOnly does not repair missing namespaces and task does not create missing directories, preventing verification from implicitly migrating execution identity.
       */
      async () => {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
        const live = this.machines.live.get(id);
        if (!live) throw new AppError('客户机运行身份未确认', 409);
        const lifetime = vmLifetime(id, live),
          identity = lifetime.capture();
        const executionAbort = AbortSignal.any([abort, lifetime.signal]);
        const project = await this.workspaces.config(id);
        const version = projectVersion(project);
        const scope = project._workspace || 'default';
        await this.scopes.assertAdmission(id, scope);
        const { assertNoPendingProjectDirectoryMigration } = await import('./project-admission.ts');
        await assertNoPendingProjectDirectoryMigration(this.machines, id, scope, abort);
        if (!readOnly) {
          const distro = this.machines.get(id).distro || 'alpine';
          const install =
            distro === 'alpine'
              ? 'apk add --no-cache --timeout 30 tmux'
              : 'export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update && apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 install -y tmux';
          const namespace = projectNetworkNamespace(project);
          const prepared = await this.machines.exec(
            id,
            `set -eu\n` +
              `${!task ? `if ! command -v tmux >/dev/null; then ${install}; fi\n` : ''}` +
              (namespace
                ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\n` +
                  (options.verifyOnly
                    ? `else\n  echo 'SAKURA_TASK_NETWORK_MISSING: 原项目网络空间不存在，只读核对未修复' >&2; exit 74\n`
                    : '') +
                  `fi\n`
                : '') +
              (options.verifyOnly ? '' : `${ensureProjectNetworkScript(project, distro)}`) +
              (task
                ? `if [ ! -d ${quote(project.directory)} ] || [ -L ${quote(project.directory)} ]; then\n` +
                  `  echo 'SAKURA_TASK_DIRECTORY_MISSING: 项目目录不存在或是链接，请先显式准备并迁移原目录' >&2; exit 74\nfi`
                : `mkdir -p ${quote(project.directory)}`),
            180_000,
            abort,
          );
          if (prepared.code !== 0)
            throw new AppError(
              prepared.stderr || '无法准备项目终端',
              409,
              task && prepared.stderr.includes('SAKURA_TASK_DIRECTORY_MISSING:')
                ? 'PROJECT_IDENTITY_DIRECTORY_MISSING'
                : undefined,
            );
        }
        lifetime.assert(identity);
        executionAbort.throwIfAborted();
        return action({ id, scope, project, version, live, abort: executionAbort, identity });
      }),
    );
  }
  /**
   * 入口 / Entry: ProjectPreparation.retain.
   * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `lease.release` 供上层消费（`ProjectPreparation`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; this entry produces `lease.release` for its caller. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 处理：通过 `this.leases.add`, `preparationLeases().add`, `preparationLeases`, `abort.addEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.leases.add`, `preparationLeases().add`, `preparationLeases`, `abort.addEventListener`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!task`.
   * 输入 / Inputs: context: PreparationContext; task: boolean; terminalId: string optional; stop: () => Promise<void> optional
   * 输出 / Returns: `lease.release`.
   * 副作用 / Effects: `this.leases.add`; `preparationLeases().add`; `abort.addEventListener`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retain(context: PreparationContext, task: boolean, terminalId?: string, stop?: () => Promise<void>) {
    const { id, scope, abort } = context;
    let finish!:
    /**
     * 中文功能：准备租约保留期间的本地结束通知，输入为空且无业务返回值。
     * English: Local completion notification during retained preparation leases, with no input or business return value.
     * 所属 / Owner: ProjectPreparation.retain.finish.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    /**
     * 入口 / Entry: ProjectPreparation.retain.done.
     * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectPreparation`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; the calls and state transitions below complete the operation. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
     * 处理：通过 `this.leases.delete`, `preparationLeases().delete`, `preparationLeases`, `abort.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.leases.delete`, `preparationLeases().delete`, `preparationLeases`, `abort.removeEventListener`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.leases.delete`; `preparationLeases().delete`; `abort.removeEventListener`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const done = () => {
      this.leases.delete(lease);
      preparationLeases(this.machines).delete(lease);
      abort.removeEventListener('abort', onAbort);
      finish();
    };
    let cleanup: Promise<void> | undefined;
    const lease: Lease = {
      vmId: id,
      projectId: scope,
      task,
      terminalId,
      finished,
      /**
       * 入口 / Entry: ProjectPreparation.retain.release.
       * 功能：在串行准备项目目录与执行资源中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` / `cleanup` 供上层消费（`ProjectPreparation`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectPreparation`; this entry produces `void` / `cleanup` for its caller. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
       * 处理：通过 `done`, `this.leases.has`, `stop().then().catch`, `stop().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `done`, `this.leases.has`, `stop().then().catch`, `stop().then`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!stop`; `!this.leases.has(lease)`; `!cleanup`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`; `cleanup`.
       * 副作用 / Effects: `stop().then().catch`; `stop().then`; `stop`; 更新 / updates `cleanup`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      release: () => {
        if (!stop) {
          done();
          return;
        }
        if (!this.leases.has(lease)) return cleanup;
        if (!cleanup)
          cleanup = stop()
            .then(done)
            .catch((error) => {
              cleanup = undefined;
              throw error;
            });
        return cleanup;
      },
    };
    /**
     * 入口 / Entry: ProjectPreparation.retain.onAbort.
     * 功能：在串行准备项目目录与执行资源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectPreparation`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPreparation`; the calls and state transitions below complete the operation. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
     * 处理：通过 `Promise.resolve().catch`, `Promise.resolve`, `lease.release` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `Promise.resolve().catch`, `Promise.resolve`, `lease.release`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `lease.release`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const onAbort = () => {
      void Promise.resolve(lease.release()).catch((error) => {
        console.error('Terminal cleanup unconfirmed:', { vmId: id, projectId: scope, terminalId, error });
      });
    };
    this.leases.add(lease);
    preparationLeases(this.machines).add(lease);
    if (!task) abort.addEventListener('abort', onAbort, { once: true });
    return lease.release;
  }
  /**
   * 入口 / Entry: ProjectPreparation.prepareTask.
   * 功能：把本层请求转交 `this.prepare`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.prepare` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; projectId: string | null | undefined; signal: AbortSignal optional; options: { verifyOnly?: boolean } default={}
   * 输出 / Returns: Promise<PreparedProject>；结果来自 / values from `this.prepare(id, projectId, signal, { ...options, task: true }, async (context) => { context.abort.throwIfAborted(); if (this…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  prepareTask(
    id: string,
    projectId: string | null | undefined,
    signal?: AbortSignal,
    options: { verifyOnly?: boolean } = {},
  ): Promise<PreparedProject> {
    /**
     * 入口 / Entry: ProjectPreparation.prepareTask.callback@220.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.prepare）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.prepare).
     * 输入 / Inputs: context
     * 输出 / Returns: `{ command: terminalShell(context.project), projectId: context.scope, networkIsolation: context.project.networkIsolation || 'h…`.
     * 副作用 / Effects: `context.abort.throwIfAborted`.
     * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(id) !== context.live`; 异常 / errors `new AppError('客户机运行身份在准备期间改变', 409)`.
     */
    return this.prepare(id, projectId, signal, { ...options, task: true }, async (context) => {
      context.abort.throwIfAborted();
      if (this.machines.live.get(id) !== context.live)
        throw new AppError('客户机运行身份在准备期间改变', 409);
      return {
        command: terminalShell(context.project),
        projectId: context.scope,
        networkIsolation: context.project.networkIsolation || 'host',
        release: this.retain(context, true),
        signal: context.abort,
        captured: {
          project: context.project,
          configVersion: context.version,
          live: context.live,
          identity: context.identity,
        },
      };
    });
  }
  /**
   * 入口 / Entry: ProjectPreparation.close.
   * 功能：在串行准备项目目录与执行资源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectPreparation`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectPreparation`; the calls and state transitions below complete the operation. Module context: Serializes project/resource preparation, retaining leases and waiting for original preparation cleanup on close.
   * 处理：通过 `this.controller.abort`, `Promise.allSettled`, `this.pending.values`, `inline.filter().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `Promise.allSettled`, `this.pending.values`, `inline.filter().map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`; `this.ownedWorkspaces.close`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError( failures.map((result) => result.reason), '项目终端清理未确认，运行记录继续保留', )`.
   */
  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending.values()]);
    const cleanup = await Promise.allSettled(
      [...this.leases].filter((lease) => !lease.task).map((lease) => lease.release()),
    );
    const failures = cleanup.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        '项目终端清理未确认，运行记录继续保留',
      );
    await Promise.all([...this.leases].map((lease) => lease.finished));
    this.unguard();
    await this.ownedWorkspaces?.close();
  }
}

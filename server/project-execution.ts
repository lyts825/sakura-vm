/**
 * 模块职责：准备并执行项目命令，将输入、日志脱敏及取消绑定到捕获的项目运行身份。
 * Module purpose: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
 */
import type { ProjectPreparationV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
import { envPrefix } from './project-services.ts';
import {
  projectNetworkCommand,
  ensureProjectNetworkScript,
  projectNetworkNamespace,
  projectNetworkCheckScript,
} from './project-network-isolation.ts';
import { Workspaces, projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { redactValues } from './secrets.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { ExecutionScope } from './execution-scope.ts';
import { vmLifetime } from './vm-lifetime.ts';

/**
 * 入口 / Entry: projectExecutionCommand.
 * 功能：在准备并执行项目命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `projectNetworkCommand( project, `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` + `exec /bin/s…` 供上层消费（`project-execution.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-execution.ts`; this entry produces `projectNetworkCommand( project, `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` + `exec /bin/s…` for its caller. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
 * 处理：通过 `projectNetworkCommand`, `envPrefix`, `quote` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectNetworkCommand`, `envPrefix`, `quote`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; command: string
 * 输出 / Returns: `projectNetworkCommand( project, `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` + `exec /bin/s…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function projectExecutionCommand(project: Project, command: string) {
  return projectNetworkCommand(
    project,
    `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` +
      `exec /bin/sh -c ${quote(command)}`,
  );
}

/**
 * 入口 / Entry: redactProjectOutput.
 * 功能：在准备并执行项目命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values), }` 供上层消费（`project-execution.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-execution.ts`; this entry produces `{ ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values), }` for its caller. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
 * 处理：通过 `projectPrivateValues`, `redactValues` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `projectPrivateValues`, `redactValues`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: project: Project; result: T
 * 输出 / Returns: `{ ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values), }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function redactProjectOutput<T extends { stdout: string; stderr: string }>(
  project: Project,
  result: T,
) {
  const values = projectPrivateValues(project);
  return {
    ...result,
    stdout: redactValues(result.stdout, values),
    stderr: redactValues(result.stderr, values),
  };
}

/** Project commands hold the VM lock through setup, execution and cleanup. */
/**
 * 入口 / Entry: withProjectCommand.
 * 功能：在准备并执行项目命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `workspaces ? await run() : await scope.projects.with(id, undefined, run)` 供上层消费（`project-execution.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-execution.ts`; this entry produces `workspaces ? await run() : await scope.projects.with(id, undefined, run)` for its caller. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
 * 处理：通过 `run`, `scope.projects.with`, `owned.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `run`, `scope.projects.with`, `owned.close`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal | undefined; workspaces: WorkspacesV1 | undefined; action: (project: Project) => Promise<T>
 * 输出 / Returns: `workspaces ? await run() : await scope.projects.with(id, undefined, run)`.
 * 副作用 / Effects: `owned.close`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `await owned?.close();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await owned?.close();`; these steps also apply to exceptional exits.
 */
export async function withProjectCommand<T>(
  machines: Machines,
  id: string,
  signal: AbortSignal | undefined,
  workspaces: WorkspacesV1 | undefined,
  action: (project: Project) => Promise<T>,
) {
  const owned = workspaces ? undefined : new Workspaces(machines);
  const scope = workspaces || owned!;
  try {
    /**
     * 入口 / Entry: withProjectCommand.callback@59.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `action(project)`.
     * 副作用 / Effects: `machines.exec`.
     * 拒绝 / Refusals: 条件 / conditions `machines.state(id) !== 'running'`; `setup.code !== 0`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`; `new AppError(setup.stderr || '无法准备项目命令', 409)`.
     */
    /**
     * 入口 / Entry: withProjectCommand.run.
     * 功能：把本层请求转交 `machines.locked`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `machines.locked` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `machines.locked(id, async () => { signal?.throwIfAborted(); if (machines.state(id) !== 'running') throw new AppError('请先启动或恢复…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const run = () =>
      machines.locked(id,
      /**
       * 中文功能：要求运行实例，解析原项目配置并准备网络 namespace/目录，命令成功且未取消后调用 action。
       * English: Requires a running VM, resolves the original project and prepares its network namespace/directory, invoking action only after success and cancellation checks.
       * 所属 / Owner: withProjectCommand.run.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       */
      async () => {
        signal?.throwIfAborted();
        if (machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
        const project = await scope.resolvedConfig(id),
          namespace = projectNetworkNamespace(project);
        const setup = await machines.exec(
          id,
          `set -eu\n` +
            (namespace
              ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n`
              : '') +
            ensureProjectNetworkScript(project, machines.get(id).distro || 'alpine') +
            `mkdir -p ${quote(project.directory)}`,
          180000,
          signal,
        );
        if (setup.code !== 0) throw new AppError(setup.stderr || '无法准备项目命令', 409);
        signal?.throwIfAborted();
        return action(project);
      });
    return workspaces ? await run() : await scope.projects.with(id, undefined, run);
  } finally {
    await owned?.close();
  }
}

export const guestExecutionInput = z
  .object({
    command: z.string().min(1).max(65536),
    scope: z.enum(['project', 'instance']).default('project'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(30),
  })
  .strict();

class ProjectExecutionCleanupErrors extends AppError {
  readonly cause: unknown;
  /**
   * 入口 / Entry: ProjectExecutionCleanupErrors.constructor.
   * 功能：建立 ProjectExecutionCleanupErrors 的准备并执行项目命令上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectExecutionCleanupErrors context for this module's responsibility: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: errors: unknown[]; cause: unknown
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.cause`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    readonly errors: unknown[],
    cause: unknown,
  ) {
    const critical = errors.find(
      (error): error is AppError => error instanceof AppError && error.status === 503,
    );
    super(
      critical?.message || '项目命令准备清理未确认，请核查原运行记录',
      503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED',
    );
    this.cause = cause;
  }
}

/** One-shot project commands use the same configuration and guards as terminals. */
export class ProjectExecution {
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  /**
   * 入口 / Entry: ProjectExecution.constructor.
   * 功能：建立 ProjectExecution 的准备并执行项目命令上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectExecution context for this module's responsibility: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; preparation: Pick<ProjectPreparationV1, 'prepareTask' | 'workspaces'>; runProjectTask: typeof projectIdentityTask default=projectIdentityTask
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private preparation: Pick<ProjectPreparationV1, 'prepareTask' | 'workspaces'>,
    private runProjectTask: typeof projectIdentityTask = projectIdentityTask,
  ) {}

  /**
   * 入口 / Entry: ProjectExecution.run.
   * 功能：在准备并执行项目命令中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`ProjectExecution`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectExecution`; this entry produces `operation` for its caller. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
   * 处理：通过 `guestExecutionInput.parse`, `projectIdSchema.parse`, `AbortSignal.any`, `this.execute` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `guestExecutionInput.parse`, `projectIdSchema.parse`, `AbortSignal.any`, `this.execute`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `projectId !== undefined && projectId !== null`.
   * 输入 / Inputs: id: string; input: unknown; projectId: string | null optional; signal: AbortSignal optional
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.execute`; `this.pending.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  run(id: string, input: unknown, projectId?: string | null, signal?: AbortSignal) {
    const value = guestExecutionInput.parse(input);
    if (projectId !== undefined && projectId !== null) projectIdSchema.parse(projectId);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    const operation = this.execute(id, value, projectId, abort);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  /**
   * 入口 / Entry: ProjectExecution.execute.
   * 功能：在实例或项目范围准备输入、凭证和账户运行，执行命令并返回有界脱敏结果。
   * Purpose: Prepares input/credentials/account execution in VM/project scope and returns bounded redacted command results.
   * 设计：项目选择及客户机代次固定，真实任务票据确认后才认可结果；缓存和 Agent 资源按原任务核销，失败保留未确认清理。
   * Design: Project/runtime identity is pinned and real task tickets validate results; original task ownership retires cache/Agent resources and retains pending cleanup.
   * 输入 / Inputs: id: string; input: z.infer<typeof guestExecutionInput>; projectId: string | null | undefined; signal: AbortSignal
   * 输出 / Returns: `this.machines.locked(id, () => ExecutionScope.run( { machines: this.machines, vmId: id, projectId: '@instance', signal, deleg…`; `await ExecutionScope.run( { machines: this.machines, vmId: id, projectId: prepared.projectId, live: originalLive, identity: o…`.
   * 副作用 / Effects: `ExecutionScope.run`; `prepared.release`.
   * 拒绝 / Refusals: 条件 / conditions `input.scope === 'instance'`; `projectId !== null && projectId !== undefined`; `!originalLive || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('实例管理命令不能同时指定项目', 400)`; `new AppError('请先启动或恢复实例', 409)`.
   * 收尾：退出 try 区域时始终执行 `if (!entered) await prepared.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `if (!entered) await prepared.release();`; these steps also apply to exceptional exits.
   */
  private async execute(
    id: string,
    input: z.infer<typeof guestExecutionInput>,
    projectId: string | null | undefined,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (input.scope === 'instance') {
      if (projectId !== null && projectId !== undefined)
        throw new AppError('实例管理命令不能同时指定项目', 400);
      return this.machines.locked(id, () =>
        ExecutionScope.run(
          { machines: this.machines, vmId: id, projectId: '@instance', signal, delegate: true },
          async (scope) => ({
            scope: 'instance' as const,
            ...(await guestTask(
              this.machines,
              id,
              `exec /bin/sh -c ${quote(input.command)}`,
              scope.signal,
              undefined,
              input.timeoutSeconds * 1000,
            )),
          }),
        ),
      );
    }
    const originalLive = this.machines.live.get(id);
    if (!originalLive || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    const originalIdentity = vmLifetime(id, originalLive).capture();
    const prepared = await this.preparation.prepareTask(id, projectId, signal);
    let entered = false;
    try {
      /**
       * 入口 / Entry: ProjectExecution.execute.callback@176.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（ExecutionScope.run）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (ExecutionScope.run).
       * 输入 / Inputs: executionScope
       * 输出 / Returns: `await workspaces.projects.inScope(id, prepared.projectId, async () => { const origin = () => { active.throwIfAborted(); execu…`.
       * 副作用 / Effects: `AbortSignal.any`; `prepared.release`; 更新 / updates `entered`, `failed`, `failure`.
       * 拒绝 / Refusals: 条件 / conditions `!captured || !preparationSignal || captured.live !== originalLive || (captured.project._workspace || 'default') !== prepared.…`; `!failed`; 异常 / errors `changed()`; `error`.
       * 收尾：退出 try 区域时始终执行 `try { await prepared.release(); } catch (error) { if (!failed) throw error; const errors = [failure, error]; const critical =…`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `try { await prepared.release(); } catch (error) { if (!failed) throw error; const errors = [failure, error]; const critical =…`; these steps also apply to exceptional exits.
       * 失败处理：catch 分支执行 `failed = true;`; `failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `failed = true;`; `failure = error;`; these statements determine whether a failure is absorbed or rejected again.
       */
      return await ExecutionScope.run(
        {
          machines: this.machines,
          vmId: id,
          projectId: prepared.projectId,
          live: originalLive,
          identity: originalIdentity,
          configVersion: prepared.captured?.configVersion,
          signal,
          delegate: true,
        },
        async (executionScope) => {
          entered = true;
          let failed = false,
            failure: unknown;
          try {
            const { captured, signal: preparationSignal } = prepared;
            /**
             * 入口 / Entry: ProjectExecution.execute.changed.
             * 功能：从当前输入或状态计算 `new AppError('项目命令原配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
             * Purpose: Computes `new AppError('项目命令原配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `new AppError('项目命令原配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             */
            const changed = () =>
              new AppError('项目命令原配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
            if (
              !captured ||
              !preparationSignal ||
              captured.live !== originalLive ||
              (captured.project._workspace || 'default') !== prepared.projectId ||
              projectVersion(captured.project) !== captured.configVersion ||
              (projectId !== undefined && projectId !== null && prepared.projectId !== projectId)
            )
              throw changed();
            const project = Object.defineProperty(structuredClone(captured.project), '_workspace', {
              value: captured.project._workspace,
              enumerable: false,
            }) as Project;
            const version = captured.configVersion,
              active = AbortSignal.any([executionScope.signal, preparationSignal]);
            const workspaces = this.preparation.workspaces;
            /**
             * 入口 / Entry: ProjectExecution.execute.callback@200.
             * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（workspaces.projects.inScope）。
             * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (workspaces.projects.inScope).
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `(async () => { await assertCurrent(); const result = await this.runProjectTask( this.machines, id, project, execution, active…`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 拒绝 / Refusals: 条件 / conditions `(resolved._workspace || 'default') !== prepared.projectId || resolved.directory !== project.directory || (resolved.networkIso…`; 异常 / errors `changed()`; `new AppError( '项目命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID', )`.
             * 失败处理：catch 分支执行 `throw new AppError( '项目命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID', );`，是否吞掉错误或重新拒绝由这些语句决定。
             * Failure handling: Catch paths execute `throw new AppError( '项目命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID', );`; these statements determine whether a failure is absorbed or rejected again.
             */
            return await workspaces.projects.inScope(id, prepared.projectId, async () => {
              /**
               * 入口 / Entry: ProjectExecution.execute.origin.
               * 功能：在准备并执行项目命令中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectExecution`）。
               * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectExecution`; the calls and state transitions below complete the operation. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
               * 处理：通过 `active.throwIfAborted`, `executionScope.assert`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `active.throwIfAborted`, `executionScope.assert`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: `executionScope.assert`.
               * 拒绝 / Refusals: 条件 / conditions `this.machines.live.get(id) !== originalLive || this.machines.state(id) !== 'running' || workspaces.projects.current(id) !== p…`; 异常 / errors `changed()`.
               */
              const origin = () => {
                active.throwIfAborted();
                executionScope.assert();
                if (
                  this.machines.live.get(id) !== originalLive ||
                  this.machines.state(id) !== 'running' ||
                  workspaces.projects.current(id) !== prepared.projectId
                )
                  throw changed();
              };
              /**
               * 入口 / Entry: ProjectExecution.execute.assertCurrent.
               * 功能：在准备并执行项目命令中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectExecution`）。
               * Purpose: Checks admission, input or resource ownership in `ProjectExecution`; the calls and state transitions below complete the operation. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
               * 处理：通过 `origin`, `workspaces.config`, `projectVersion`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `origin`, `workspaces.config`, `projectVersion`, `changed`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== prepared.projectId || projectVersion(current) !== version || projectVersion(project) !=…`; 异常 / errors `changed()`.
               */
              const assertCurrent = async () => {
                origin();
                const current = await workspaces.config(id);
                origin();
                if (
                  (current._workspace || 'default') !== prepared.projectId ||
                  projectVersion(current) !== version ||
                  projectVersion(project) !== version
                )
                  throw changed();
              };
              await assertCurrent();
              const resolved = await workspaces.resolveProject(id, project);
              await assertCurrent();
              if (
                (resolved._workspace || 'default') !== prepared.projectId ||
                resolved.directory !== project.directory ||
                (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')
              )
                throw changed();
              const execution = { command: input.command, environment: resolved.environment };
              try {
                projectIdentityPayload(execution);
              } catch {
                throw new AppError(
                  '项目命令或环境超过原生受保护输入边界',
                  413,
                  'PROJECT_IDENTITY_PAYLOAD_INVALID',
                );
              }
              /**
               * 入口 / Entry: ProjectExecution.execute.callback@241.
               * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
               * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `{ ...redactProjectOutput(resolved, result), scope: 'project' as const, projectId: prepared.projectId, directory: project.dire…`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              return (async () => {
                await assertCurrent();
                const result = await this.runProjectTask(
                  this.machines,
                  id,
                  project,
                  execution,
                  active,
                  undefined,
                  input.timeoutSeconds * 1000,
                  undefined,
                  undefined,
                  { expectedLive: originalLive },
                );
                await assertCurrent();
                return {
                  ...redactProjectOutput(resolved, result),
                  scope: 'project' as const,
                  projectId: prepared.projectId,
                  directory: project.directory,
                  networkIsolation: project.networkIsolation || 'host',
                };
              })();
            });
          } catch (error) {
            failed = true;
            failure = error;
            throw error;
          } finally {
            try {
              await prepared.release();
            } catch (error) {
              if (!failed) throw error;
              const errors = [failure, error];
              const critical = errors.find((value) => value instanceof AppError && value.status === 503);
              throw new ProjectExecutionCleanupErrors(errors, critical || failure || error);
            }
          }
        },
      );
    } finally {
      if (!entered) await prepared.release();
    }
  }

  /**
   * 入口 / Entry: ProjectExecution.close.
   * 功能：在准备并执行项目命令中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` 供上层消费（`ProjectExecution`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectExecution`; this entry produces `this.closing` for its caller. Module context: Prepares/runs project commands with bounded input, redaction and cancellation tied to captured runtime identity.
   * 处理：通过 `this.controller.abort`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.closing`.
   * 副作用 / Effects: `this.controller.abort`; 更新 / updates `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    if (this.closing) return this.closing;
    this.controller.abort();
    this.closing = (async () => {
      const results = await Promise.allSettled([...this.pending]);
      const errors = results.flatMap((result) =>
        result.status === 'rejected' && result.reason instanceof AppError && result.reason.status === 503
          ? [result.reason]
          : [],
      );
      if (errors.length)
        throw errors.length === 1 ? errors[0] : new ProjectExecutionCleanupErrors(errors, errors[0]);
    })();
    return this.closing;
  }
}

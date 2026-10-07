/**
 * 模块职责：在固定项目配置与客户机身份下执行 Git 任务，封装作用域检查和输出脱敏。
 * Module purpose: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectPrivateValues } from './workspaces.ts';
import { projectVersion, type Project } from './project-config.ts';
import { AppError } from '../shared/errors.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues } from './secrets.ts';

export type GitWorkbenchOptions = {
  /**
   * 签名 / Signature: GitWorkbenchOptions.createPreparation.
   * 功能：为在固定项目配置与客户机身份下执行 Git 任务声明 createPreparation 的输入与结果契约，所属容器为 GitWorkbenchOptions。
   * Purpose: Declares the input/result contract for createPreparation in GitWorkbenchOptions. Module responsibility: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Pick<ProjectTerminals, 'prepare' | 'close'>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Pick<ProjectTerminals, 'prepare' | 'close'>;
  runProjectTask?: typeof projectIdentityTask;
};
export type GitProjectCapture = {
  id: string; projectId: string; key: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>;
};
type Context = GitProjectCapture & { signal: AbortSignal; resolved: Project };

/**
 * 入口 / Entry: copyProject.
 * 功能：从当前输入或状态计算 `value`，供调用方后续验证或使用。
 * Purpose: Computes `value` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: project: Project; projectId: string
 * 输出 / Returns: `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function copyProject(project: Project, projectId: string) {
  const value = structuredClone(project);
  Object.defineProperty(value, '_workspace', { value: projectId === 'default' ? undefined : projectId, enumerable: false });
  return value;
}
/**
 * 入口 / Entry: changed.
 * 功能：从当前输入或状态计算 `new AppError('Git 原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('Git 原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('Git 原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('Git 原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/** Jobs recognizes cleanup errors by AppError/code even after cancellation. */
class GitCleanupErrors extends AppError {
  readonly cause: unknown;
  /**
   * 入口 / Entry: GitCleanupErrors.constructor.
   * 功能：建立 GitCleanupErrors 的在固定项目配置与客户机身份下执行 Git 任务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GitCleanupErrors context for this module's responsibility: Executes Git work in a captured project/guest scope with identity checks and redacted outputs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: errors: unknown[]; cause: unknown
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.cause`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(readonly errors: unknown[], cause: unknown) {
    const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
    super(critical?.message || 'Git 原操作准备清理未确认，请核查原运行记录', 503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED');
    this.cause = cause;
  }
}

/** One preparation lease and resolved environment cover a complete Git API operation. */
export class GitProjectTasks {
  private context = new AsyncLocalStorage<Context>();
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  /**
   * 入口 / Entry: GitProjectTasks.constructor.
   * 功能：建立 GitProjectTasks 的在固定项目配置与客户机身份下执行 Git 任务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GitProjectTasks context for this module's responsibility: Executes Git work in a captured project/guest scope with identity checks and redacted outputs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: GitWorkbenchOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private options: GitWorkbenchOptions = {}) {}

  /**
   * 入口 / Entry: GitProjectTasks.capture.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`, `this.workspaces.projects.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`, `this.workspaces.projects.inScope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; candidate: Project optional
   * 输出 / Returns: Promise<GitProjectCapture>；结果来自 / values from `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`.
   */
  async capture(id: string, candidate?: Project): Promise<GitProjectCapture> {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    /**
     * 入口 / Entry: GitProjectTasks.capture.callback@52.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.workspaces.projects.inScope）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.workspaces.projects.inScope).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ id, projectId, key: projectId === 'default' ? id : id + ':' + projectId, live, project, version: projectVersion(project) }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `(original._workspace || 'default') !== projectId || this.machines.live.get(id) !== live`; `candidate && ((candidate._workspace || 'default') !== projectId || projectVersion(candidate) !== projectVersion(original))`; 异常 / errors `changed()`.
     */
    return this.workspaces.projects.inScope(id, projectId, async () => {
      const original = await this.workspaces.config(id);
      if ((original._workspace || 'default') !== projectId || this.machines.live.get(id) !== live)
        throw changed();
      if (candidate && ((candidate._workspace || 'default') !== projectId || projectVersion(candidate) !== projectVersion(original)))
        throw changed();
      const project = copyProject(candidate || original, projectId);
      return { id, projectId, key: projectId === 'default' ? id : id + ':' + projectId,
        live, project, version: projectVersion(project) };
    });
  }
  /**
   * 入口 / Entry: GitProjectTasks.inScope.
   * 功能：把本层请求转交 `this.workspaces.projects.inScope`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.workspaces.projects.inScope` and propagates the provider result or rejection.
   * 输入 / Inputs: capture: GitProjectCapture; action: () => T
   * 输出 / Returns: `this.workspaces.projects.inScope(capture.id, capture.projectId, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  inScope<T>(capture: GitProjectCapture, action: () => T) {
    return this.workspaces.projects.inScope(capture.id, capture.projectId, action);
  }
  /**
   * 入口 / Entry: GitProjectTasks.require.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，核对调用资格、输入或资源归属；本入口产生 `value` 供上层消费（`GitProjectTasks`）。
   * Purpose: Checks admission, input or resource ownership in `GitProjectTasks`; this entry produces `value` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.context.getStore`, `projectVersion`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context.getStore`, `projectVersion`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; candidate: Project optional
   * 输出 / Returns: `value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!value || value.id !== id`; `candidate && ((candidate._workspace || 'default') !== value.projectId || projectVersion(candidate) !== value.version)`; 异常 / errors `new AppError('Git 命令缺少原项目任务上下文', 409, 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING')`; `changed()`.
   */
  private require(id: string, candidate?: Project) {
    const value = this.context.getStore();
    if (!value || value.id !== id) throw new AppError('Git 命令缺少原项目任务上下文', 409, 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING');
    if (candidate && ((candidate._workspace || 'default') !== value.projectId || projectVersion(candidate) !== value.version))
      throw changed();
    return value;
  }
  /**
   * 入口 / Entry: GitProjectTasks.project.
   * 功能：从当前输入或状态计算 `this.require(id).project`，供调用方后续验证或使用。
   * Purpose: Computes `this.require(id).project` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.require(id).project`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  project(id: string) { return this.require(id).project; }
  /**
   * 入口 / Entry: GitProjectTasks.redact.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `redactValues(value, projectPrivateValues(this.require(id).resolved))` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `redactValues(value, projectPrivateValues(this.require(id).resolved))` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `redactValues`, `projectPrivateValues`, `this.require` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `redactValues`, `projectPrivateValues`, `this.require`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; value: string
   * 输出 / Returns: `redactValues(value, projectPrivateValues(this.require(id).resolved))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  redact(id: string, value: string) {
    return redactValues(value, projectPrivateValues(this.require(id).resolved));
  }
  /**
   * 入口 / Entry: GitProjectTasks.redactFailure.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `error` / `reported` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `error` / `reported` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.redact` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.redact`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!(error instanceof Error)`; `message === error.message`.
   * 输入 / Inputs: id: string; error: unknown
   * 输出 / Returns: `error`; `reported`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `const reported = new AppError(message, error instanceof AppError ? error.status : 500, error instanceof AppError ? error.code…`; `Object.defineProperty(reported, 'cause', { value: error });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const reported = new AppError(message, error instanceof AppError ? error.status : 500, error instanceof AppError ? error.code…`; `Object.defineProperty(reported, 'cause', { value: error });`; these statements determine whether a failure is absorbed or rejected again.
   */
  private redactFailure(id: string, error: unknown) {
    if (!(error instanceof Error)) return error;
    const message = this.redact(id, error.message);
    if (message === error.message) return error;
    try {
      Object.defineProperty(error, 'message', { value: message, writable: true, configurable: true });
      return error;
    } catch {
      const reported = new AppError(message, error instanceof AppError ? error.status : 500,
        error instanceof AppError ? error.code : undefined);
      Object.defineProperty(reported, 'cause', { value: error });
      return reported;
    }
  }
  /**
   * 入口 / Entry: GitProjectTasks.assertCurrent.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`GitProjectTasks`）。
   * Purpose: Checks admission, input or resource ownership in `GitProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.require`, `origin`, `this.workspaces.config`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `origin`, `this.workspaces.config`, `projectVersion`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `(current._workspace || 'default') !== context.projectId || projectVersion(current) !== context.version || projectVersion(cont…`; 异常 / errors `changed()`.
   */
  async assertCurrent(id: string, signal?: AbortSignal) {
    const context = this.require(id);
    /**
     * 入口 / Entry: GitProjectTasks.assertCurrent.origin.
     * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`GitProjectTasks`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
     * 处理：通过 `context.signal.throwIfAborted`, `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `context.signal.throwIfAborted`, `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== context.projectId || this.machines.live.get(id) !== context.live || this.machines.st…`; 异常 / errors `changed()`.
     */
    const origin = () => {
      context.signal.throwIfAborted(); signal?.throwIfAborted();
      if (this.workspaces.projects.current(id) !== context.projectId || this.machines.live.get(id) !== context.live ||
          this.machines.state(id) !== 'running') throw changed();
    };
    origin();
    const current = await this.workspaces.config(id);
    origin();
    if ((current._workspace || 'default') !== context.projectId || projectVersion(current) !== context.version ||
        projectVersion(context.project) !== context.version) throw changed();
  }
  /**
   * 入口 / Entry: GitProjectTasks.exec.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `result` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.require`, `this.assertCurrent`, `projectIdentityPayload`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `this.assertCurrent`, `projectIdentityPayload`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; timeout: default=30000; signal: AbortSignal optional; candidate: Project optional
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'`; `Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2`; 异常 / errors `new AppError('Git 命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`; `new AppError('Git 任务响应缺少原退出码或输出', 502, 'GIT_TASK_RESULT_INVALID')`.
   * 失败处理：catch 分支执行 `throw new AppError('Git 命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('Git 命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async exec(id: string, command: string, timeout = 30000, signal?: AbortSignal, candidate?: Project) {
    const context = this.require(id, candidate);
    await this.assertCurrent(id, signal);
    const execution = { command, environment: context.resolved.environment };
    try { projectIdentityPayload(execution); }
    catch { throw new AppError('Git 命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
    const result = await (this.options.runProjectTask || projectIdentityTask)(this.machines, id, context.project,
      execution, context.signal, undefined, timeout, undefined, undefined, { expectedLive: context.live });
    await this.assertCurrent(id, signal);
    if (!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
      throw new AppError('Git 任务响应缺少原退出码或输出', 502, 'GIT_TASK_RESULT_INVALID');
    // The production SSH transport already has this bound. Do not truncate raw
    // NUL-delimited status/index data or turn a partial response into a result.
    if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2)
      throw new AppError('输出超过 1 MiB，请使用终端', 413, 'GIT_OUTPUT_TOO_LARGE');
    return result;
  }
  /**
   * 入口 / Entry: GitProjectTasks.withProject.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `action()` / `this.runCaptured(await this.capture(id, candidate), signal, action)` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `action()` / `this.runCaptured(await this.capture(id, candidate), signal, action)` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `signal.throwIfAborted`, `this.controller.signal.throwIfAborted`, `this.context.getStore`, `this.require` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.controller.signal.throwIfAborted`, `this.context.getStore`, `this.require`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `prior`.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined; candidate: Project | undefined; action: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `action()`; `this.runCaptured(await this.capture(id, candidate), signal, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async withProject<T>(id: string, signal: AbortSignal | undefined, candidate: Project | undefined, action: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted(); this.controller.signal.throwIfAborted();
    const prior = this.context.getStore();
    if (prior) { this.require(id, candidate); await this.assertCurrent(id, signal); return action(); }
    return this.runCaptured(await this.capture(id, candidate), signal, action);
  }
  /**
   * 入口 / Entry: GitProjectTasks.runCaptured.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`GitProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GitProjectTasks`; this entry produces `operation` for its caller. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `AbortSignal.any`, `this.inScope`, `this.pending.add`, `operation.finally().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `this.inScope`, `this.pending.add`, `operation.finally().catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: capture: GitProjectCapture; external: AbortSignal | undefined; action: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.pending.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  runCaptured<T>(capture: GitProjectCapture, external: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    /**
     * 入口 / Entry: GitProjectTasks.runCaptured.callback@129.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.context.run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.context.run).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `this.options.createPreparation`; `AbortSignal.any`; `lease.release`; `errors.push`; `preparation.close`; 更新 / updates `lease`, `context.signal`, `context.resolved`, `failed`.
     * 拒绝 / Refusals: 条件 / conditions `!captured || !preparedSignal || lease.projectId !== capture.projectId || captured.live !== capture.live || (captured.project.…`; `(resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory || (resolved.net…`; `errors.length`; 异常 / errors `changed()`; `failure`.
     * 收尾：退出 try 区域时始终执行 `const errors: unknown[] = [];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `const errors: unknown[] = [];`; `try { await lease?.release(); } catch (error) { errors.push(error); }`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `failed = true;`; `failure = this.redactFailure(capture.id, error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `failed = true;`; `failure = this.redactFailure(capture.id, error);`; these statements determine whether a failure is absorbed or rejected again.
     */
    const operation = this.inScope(capture, () => this.context.run({ ...capture, signal, resolved: capture.project },
    /**
     * 中文功能：准备捕获的 Git 项目租约，逐次核对 live、版本、目录和网络身份后执行 action；错误脱敏，最终释放租约及准备器。
     * English: Prepares the captured Git project lease, rechecks live/version/directory/network identity before action, redacts errors and finally releases lease/preparer.
     * 所属 / Owner: GitProjectTasks.runCaptured.operation.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 设计：清理失败与原失败合并，503 清理错误优先保留，避免成功动作掩盖未退役资源。
     * Design: Aggregate cleanup and original failures, preserving critical 503 cleanup errors so action success cannot hide unretired resources.
     */
    async () => {
      await this.assertCurrent(capture.id);
      const preparation = this.options.createPreparation?.() || projectTerminalsFor(this.machines, this.workspaces);
      let lease: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
      let failed = false, failure: unknown;
      try {
        lease = await preparation.prepare(capture.id, capture.projectId, null, false, signal, undefined, { mode: 'task' });
        const { captured, signal: preparedSignal } = lease;
        if (!captured || !preparedSignal || lease.projectId !== capture.projectId || captured.live !== capture.live ||
            (captured.project._workspace || 'default') !== capture.projectId || captured.configVersion !== capture.version ||
            projectVersion(captured.project) !== capture.version) throw changed();
        const context = this.require(capture.id); context.signal = AbortSignal.any([signal, preparedSignal]);
        await this.assertCurrent(capture.id);
        const resolved = await this.workspaces.resolveProject(capture.id, copyProject(capture.project, capture.projectId));
        await this.assertCurrent(capture.id);
        if ((resolved._workspace || 'default') !== capture.projectId || resolved.directory !== capture.project.directory ||
            (resolved.networkIsolation || 'host') !== (capture.project.networkIsolation || 'host')) throw changed();
        context.resolved = resolved;
        const result = await action();
        await this.assertCurrent(capture.id);
        return result;
      } catch (error) {
        failed = true; failure = this.redactFailure(capture.id, error);
        throw failure;
      } finally {
        const errors: unknown[] = [];
        try { await lease?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) {
          if (failed) errors.unshift(failure);
          const critical = errors.find((error) => error instanceof AppError && error.status === 503);
          const error = errors.length === 1 && critical ? critical : new GitCleanupErrors(errors, critical || failure || errors[0]);
          throw this.redactFailure(capture.id, error);
        }
      }
    }));
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  /**
   * 入口 / Entry: GitProjectTasks.close.
   * 功能：在在固定项目配置与客户机身份下执行 Git 任务中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`GitProjectTasks`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `GitProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes Git work in a captured project/guest scope with identity checks and redacted outputs.
   * 处理：通过 `this.controller.abort`, `Promise.allSettled`, `results.filter().map().filter`, `results.filter().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `Promise.allSettled`, `results.filter().map().filter`, `results.filter().map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `errors.length === 1 ? errors[0] : new GitCleanupErrors(errors, errors[0])`.
   */
  async close() {
    this.controller.abort();
    const results = await Promise.allSettled([...this.pending]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason).filter((error) => error instanceof AppError && error.status === 503);
    if (errors.length) throw errors.length === 1 ? errors[0] : new GitCleanupErrors(errors, errors[0]);
  }
}

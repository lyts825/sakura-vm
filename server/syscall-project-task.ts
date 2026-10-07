/**
 * 模块职责：在固定项目配置和客户机身份下执行受限任务，统一准备、脱敏及原资源恢复。
 * Module purpose: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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

export type SyscallProjectTaskOptions = {
  /**
   * 签名 / Signature: SyscallProjectTaskOptions.createPreparation.
   * 功能：为在固定项目配置和客户机身份下执行受限任务声明 createPreparation 的输入与结果契约，所属容器为 SyscallProjectTaskOptions。
   * Purpose: Declares the input/result contract for createPreparation in SyscallProjectTaskOptions. Module responsibility: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Pick<ProjectTerminals, 'prepare' | 'close'>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createPreparation?: () => Pick<ProjectTerminals, 'prepare' | 'close'>;
  runProjectTask?: typeof projectIdentityTask;
};
export type SyscallProjectCapture = {
  id: string; projectId: string; key: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>;
};
type Context = SyscallProjectCapture & { signal: AbortSignal; resolved: Project };

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
 * 功能：从当前输入或状态计算 `new AppError('受限命令原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`，供调用方后续验证或使用。
 * Purpose: Computes `new AppError('受限命令原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `new AppError('受限命令原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const changed = () => new AppError('受限命令原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/** Jobs recognizes cleanup errors by AppError/code even after cancellation. */
class SyscallCleanupErrors extends AppError {
  readonly cause: unknown;
  /**
   * 入口 / Entry: SyscallCleanupErrors.constructor.
   * 功能：建立 SyscallCleanupErrors 的在固定项目配置和客户机身份下执行受限任务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SyscallCleanupErrors context for this module's responsibility: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: errors: unknown[]; cause: unknown
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.cause`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(readonly errors: unknown[], cause: unknown) {
    const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
    super(critical?.message || '受限命令原操作准备清理未确认，请核查原运行记录', 503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED');
    this.cause = cause;
  }
}

/** One preparation lease and resolved environment cover a complete finite syscall operation. */
export class SyscallProjectTasks {
  private context = new AsyncLocalStorage<Context>();
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  /**
   * 入口 / Entry: SyscallProjectTasks.constructor.
   * 功能：建立 SyscallProjectTasks 的在固定项目配置和客户机身份下执行受限任务上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SyscallProjectTasks context for this module's responsibility: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: SyscallProjectTaskOptions default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1, private options: SyscallProjectTaskOptions = {}) {}

  /**
   * 入口 / Entry: SyscallProjectTasks.capture.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 处理：通过 `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`, `this.workspaces.projects.inScope` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`, `this.workspaces.projects.inScope`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; candidate: Project optional
   * 输出 / Returns: Promise<SyscallProjectCapture>；结果来自 / values from `this.workspaces.projects.inScope(id, projectId, async () => { const original = await this.workspaces.config(id); if ((origina…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('请先启动或恢复实例', 409)`.
   */
  async capture(id: string, candidate?: Project): Promise<SyscallProjectCapture> {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    /**
     * 入口 / Entry: SyscallProjectTasks.capture.callback@52.
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
   * 入口 / Entry: SyscallProjectTasks.inScope.
   * 功能：把本层请求转交 `this.workspaces.projects.inScope`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.workspaces.projects.inScope` and propagates the provider result or rejection.
   * 输入 / Inputs: capture: SyscallProjectCapture; action: () => T
   * 输出 / Returns: `this.workspaces.projects.inScope(capture.id, capture.projectId, action)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  inScope<T>(capture: SyscallProjectCapture, action: () => T) {
    return this.workspaces.projects.inScope(capture.id, capture.projectId, action);
  }
  /**
   * 入口 / Entry: SyscallProjectTasks.require.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，核对调用资格、输入或资源归属；本入口产生 `value` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Checks admission, input or resource ownership in `SyscallProjectTasks`; this entry produces `value` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 处理：通过 `this.context.getStore`, `projectVersion`, `changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.context.getStore`, `projectVersion`, `changed`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; candidate: Project optional
   * 输出 / Returns: `value`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!value || value.id !== id`; `candidate && ((candidate._workspace || 'default') !== value.projectId || projectVersion(candidate) !== value.version)`; 异常 / errors `new AppError('受限命令命令缺少原项目任务上下文', 409, 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING')`; `changed()`.
   */
  private require(id: string, candidate?: Project) {
    const value = this.context.getStore();
    if (!value || value.id !== id) throw new AppError('受限命令命令缺少原项目任务上下文', 409, 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING');
    if (candidate && ((candidate._workspace || 'default') !== value.projectId || projectVersion(candidate) !== value.version))
      throw changed();
    return value;
  }
  /**
   * 入口 / Entry: SyscallProjectTasks.project.
   * 功能：从当前输入或状态计算 `this.require(id).project`，供调用方后续验证或使用。
   * Purpose: Computes `this.require(id).project` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.require(id).project`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  project(id: string) { return this.require(id).project; }
  /**
   * 入口 / Entry: SyscallProjectTasks.redact.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `redactValues(value, projectPrivateValues(this.require(id).resolved))` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `redactValues(value, projectPrivateValues(this.require(id).resolved))` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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
   * 入口 / Entry: SyscallProjectTasks.redactFailure.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `error` / `reported` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `error` / `reported` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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
   * 入口 / Entry: SyscallProjectTasks.assertCurrent.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SyscallProjectTasks`）。
   * Purpose: Checks admission, input or resource ownership in `SyscallProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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
     * 入口 / Entry: SyscallProjectTasks.assertCurrent.origin.
     * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SyscallProjectTasks`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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
   * 入口 / Entry: SyscallProjectTasks.exec.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `result` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 处理：通过 `this.require`, `this.assertCurrent`, `projectIdentityPayload`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`, `this.assertCurrent`, `projectIdentityPayload`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; command: string; timeout: default=30000; signal: AbortSignal optional; candidate: Project optional
   * 输出 / Returns: `result`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'`; `Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2`; 异常 / errors `new AppError('受限命令命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID')`; `new AppError('受限命令任务响应缺少原退出码或输出', 502, 'SYSCALL_TASK_RESULT_INVALID')`.
   * 失败处理：catch 分支执行 `throw new AppError('受限命令命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('受限命令命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID');`; these statements determine whether a failure is absorbed or rejected again.
   */
  async exec(id: string, command: string, timeout = 30000, signal?: AbortSignal, candidate?: Project) {
    const context = this.require(id, candidate);
    await this.assertCurrent(id, signal);
    const execution = { command, environment: context.resolved.environment };
    try { projectIdentityPayload(execution); }
    catch { throw new AppError('受限命令命令或环境超过原生受保护 payload 边界，请缩小本次操作', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
    const result = await (this.options.runProjectTask || projectIdentityTask)(this.machines, id, context.project,
      execution, context.signal, undefined, timeout, undefined, undefined, { expectedLive: context.live });
    await this.assertCurrent(id, signal);
    if (!Number.isSafeInteger(result.code) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
      throw new AppError('受限命令任务响应缺少原退出码或输出', 502, 'SYSCALL_TASK_RESULT_INVALID');
    // The production SSH transport already has this bound. Do not truncate raw
    // NUL-delimited status/index data or turn a partial response into a result.
    if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > 1024 ** 2)
      throw new AppError('输出超过 1 MiB，请使用终端', 413, 'SYSCALL_OUTPUT_TOO_LARGE');
    return result;
  }
  /**
   * 入口 / Entry: SyscallProjectTasks.withProject.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `action()` / `this.runCaptured(await this.capture(id, candidate), signal, action)` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `action()` / `this.runCaptured(await this.capture(id, candidate), signal, action)` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
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
   * 入口 / Entry: SyscallProjectTasks.runCaptured.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`SyscallProjectTasks`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SyscallProjectTasks`; this entry produces `operation` for its caller. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 处理：通过 `AbortSignal.any`, `this.inScope`, `this.pending.add`, `operation.finally().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `this.inScope`, `this.pending.add`, `operation.finally().catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: capture: SyscallProjectCapture; external: AbortSignal | undefined; action: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.pending.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  runCaptured<T>(capture: SyscallProjectCapture, external: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    /**
     * 入口 / Entry: SyscallProjectTasks.runCaptured.callback@129.
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
     * 中文功能：准备捕获 syscall 项目租约并逐次核对 live、版本、目录和网络后执行 action，异常脱敏且 finally 释放全部准备资源。
     * English: Prepares the captured syscall project lease, rechecks live/version/directory/network before action, redacts failures and releases all preparation resources in finally.
     * 所属 / Owner: SyscallProjectTasks.runCaptured.operation.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 设计：保留原错误并合并释放失败，优先传递关键 503，避免成功结果掩盖未确认清理。
     * Design: Retain original errors and aggregate release failures, prioritizing critical 503 errors so successful results cannot hide unconfirmed cleanup.
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
          const error = errors.length === 1 && critical ? critical : new SyscallCleanupErrors(errors, critical || failure || errors[0]);
          throw this.redactFailure(capture.id, error);
        }
      }
    }));
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  /**
   * 入口 / Entry: SyscallProjectTasks.close.
   * 功能：在在固定项目配置和客户机身份下执行受限任务中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`SyscallProjectTasks`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SyscallProjectTasks`; the calls and state transitions below complete the operation. Module context: Executes restricted tasks in captured project/guest scopes with preparation, redaction and original-resource recovery.
   * 处理：通过 `this.controller.abort`, `Promise.allSettled`, `results.filter().map().filter`, `results.filter().map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `Promise.allSettled`, `results.filter().map().filter`, `results.filter().map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `errors.length === 1 ? errors[0] : new SyscallCleanupErrors(errors, errors[0])`.
   */
  async close() {
    this.controller.abort();
    const results = await Promise.allSettled([...this.pending]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason).filter((error) => error instanceof AppError && error.status === 503);
    if (errors.length) throw errors.length === 1 ? errors[0] : new SyscallCleanupErrors(errors, errors[0]);
  }
}

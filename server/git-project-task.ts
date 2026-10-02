import { AsyncLocalStorage } from 'node:async_hooks';
import type { Machines } from './machines.ts';
import { projectPrivateValues, projectVersion, type Project, type Workspaces } from './workspaces.ts';
import { AppError } from './model.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityPayload } from './project-identity.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactValues } from './secrets.ts';

export type GitWorkbenchOptions = {
  createPreparation?: () => Pick<ProjectTerminals, 'prepare' | 'close'>;
  runProjectTask?: typeof projectIdentityTask;
};
export type GitProjectCapture = {
  id: string; projectId: string; key: string; project: Project; version: string;
  live: NonNullable<ReturnType<Machines['live']['get']>>;
};
type Context = GitProjectCapture & { signal: AbortSignal; resolved: Project };

function copyProject(project: Project, projectId: string) {
  const value = structuredClone(project);
  Object.defineProperty(value, '_workspace', { value: projectId === 'default' ? undefined : projectId, enumerable: false });
  return value;
}
const changed = () => new AppError('Git 原项目配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
/** Jobs recognizes cleanup errors by AppError/code even after cancellation. */
class GitCleanupErrors extends AppError {
  readonly cause: unknown;
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
  constructor(private machines: Machines, private workspaces: Workspaces, private options: GitWorkbenchOptions = {}) {}

  async capture(id: string, candidate?: Project): Promise<GitProjectCapture> {
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
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
  inScope<T>(capture: GitProjectCapture, action: () => T) {
    return this.workspaces.projects.inScope(capture.id, capture.projectId, action);
  }
  private require(id: string, candidate?: Project) {
    const value = this.context.getStore();
    if (!value || value.id !== id) throw new AppError('Git 命令缺少原项目任务上下文', 409, 'PROJECT_IDENTITY_TASK_CONTEXT_MISSING');
    if (candidate && ((candidate._workspace || 'default') !== value.projectId || projectVersion(candidate) !== value.version))
      throw changed();
    return value;
  }
  project(id: string) { return this.require(id).project; }
  redact(id: string, value: string) {
    return redactValues(value, projectPrivateValues(this.require(id).resolved));
  }
  async assertCurrent(id: string, signal?: AbortSignal) {
    const context = this.require(id);
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
  async withProject<T>(id: string, signal: AbortSignal | undefined, candidate: Project | undefined, action: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted(); this.controller.signal.throwIfAborted();
    const prior = this.context.getStore();
    if (prior) { this.require(id, candidate); await this.assertCurrent(id, signal); return action(); }
    return this.runCaptured(await this.capture(id, candidate), signal, action);
  }
  runCaptured<T>(capture: GitProjectCapture, external: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
    const signal = AbortSignal.any([this.controller.signal, ...(external ? [external] : [])]);
    const operation = this.inScope(capture, () => this.context.run({ ...capture, signal, resolved: capture.project }, async () => {
      await this.assertCurrent(capture.id);
      const preparation = this.options.createPreparation?.() || new ProjectTerminals(this.machines, this.workspaces);
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
        failed = true; failure = error;
        if (error instanceof Error) error.message = this.redact(capture.id, error.message);
        throw error;
      } finally {
        const errors: unknown[] = [];
        try { await lease?.release(); } catch (error) { errors.push(error); }
        try { await preparation.close(); } catch (error) { errors.push(error); }
        if (errors.length) {
          if (failed) errors.unshift(failure);
          const critical = errors.find((error) => error instanceof AppError && error.status === 503);
          const error = errors.length === 1 && critical ? critical : new GitCleanupErrors(errors, critical || failure || errors[0]);
          if (error instanceof Error) error.message = this.redact(capture.id, error.message);
          throw error;
        }
      }
    }));
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }
  async close() {
    this.controller.abort();
    const results = await Promise.allSettled([...this.pending]);
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason).filter((error) => error instanceof AppError && error.status === 503);
    if (errors.length) throw errors.length === 1 ? errors[0] : new GitCleanupErrors(errors, errors[0]);
  }
}

import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { ProjectTerminals } from './project-terminals.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { envPrefix } from './project-services.ts';
import { projectNetworkCommand, ensureProjectNetworkScript, projectNetworkNamespace,
  projectNetworkCheckScript } from './project-network-isolation.ts';
import { Workspaces, projectPrivateValues, projectVersion, type Project } from './workspaces.ts';
import { redactValues } from './secrets.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { projectIdentityPayload } from './project-identity.ts';

export function projectExecutionCommand(project: Project, command: string) {
  return projectNetworkCommand(project,
    `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` +
    `exec /bin/sh -c ${quote(command)}`);
}

export function redactProjectOutput<T extends { stdout: string; stderr: string }>(project: Project, result: T) {
  const values = projectPrivateValues(project);
  return { ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values) };
}

/** Project commands hold the VM lock through setup, execution and cleanup. */
export async function withProjectCommand<T>(machines: Machines, id: string, signal: AbortSignal | undefined,
  workspaces: Workspaces | undefined, action: (project: Project) => Promise<T>) {
  const scope = workspaces || new Workspaces(machines);
  try {
    const run = () => machines.locked(id, async () => {
      signal?.throwIfAborted();
      if (machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
      const project = await scope.resolvedConfig(id), namespace = projectNetworkNamespace(project);
      const setup = await machines.exec(id, `set -eu\n` +
        (namespace ? `if ip netns exec ${namespace} true >/dev/null 2>&1; then\n${projectNetworkCheckScript(namespace)}\nfi\n` : '') +
        ensureProjectNetworkScript(project, machines.get(id).distro || 'alpine') +
        `mkdir -p ${quote(project.directory)}`, 180000, signal);
      if (setup.code !== 0) throw new AppError(setup.stderr || '无法准备项目命令', 409);
      signal?.throwIfAborted();
      return action(project);
    });
    return workspaces ? await run() : await scope.projects.with(id, undefined, run);
  } finally { if (!workspaces) await scope.close(); }
}

export const guestExecutionInput = z.object({
  command: z.string().min(1).max(65536),
  scope: z.enum(['project', 'instance']).default('project'),
  timeoutSeconds: z.number().int().min(1).max(3600).default(30),
}).strict();

class ProjectExecutionCleanupErrors extends AppError {
  readonly cause: unknown;
  constructor(readonly errors: unknown[], cause: unknown) {
    const critical = errors.find((error): error is AppError => error instanceof AppError && error.status === 503);
    super(critical?.message || '项目命令准备清理未确认，请核查原运行记录', 503,
      critical?.code || 'PROJECT_IDENTITY_CLEANUP_FAILED');
    this.cause = cause;
  }
}

/** One-shot project commands use the same configuration and guards as terminals. */
export class ProjectExecution {
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  private closing?: Promise<void>;
  constructor(private machines: Machines, private terminals: ProjectTerminals,
    private runProjectTask: typeof projectIdentityTask = projectIdentityTask) {}

  run(id: string, input: unknown, projectId?: string | null, signal?: AbortSignal) {
    const value = guestExecutionInput.parse(input);
    if (projectId !== undefined && projectId !== null) projectIdSchema.parse(projectId);
    const abort = AbortSignal.any([this.controller.signal, ...(signal ? [signal] : [])]);
    const operation = this.execute(id, value, projectId, abort);
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  private async execute(id: string, input: z.infer<typeof guestExecutionInput>,
    projectId: string | null | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    if (input.scope === 'instance') {
      if (projectId !== null && projectId !== undefined)
        throw new AppError('实例管理命令不能同时指定项目', 400);
      return this.machines.locked(id, async () => ({ scope: 'instance' as const,
        ...await guestTask(this.machines, id, `exec /bin/sh -c ${quote(input.command)}`,
          signal, undefined, input.timeoutSeconds * 1000) }));
    }
    const originalLive = this.machines.live.get(id);
    if (!originalLive || this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
    const prepared = await this.terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
    let failed = false, failure: unknown;
    try {
      const { captured, signal: preparationSignal } = prepared;
      const changed = () => new AppError('项目命令原配置或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      if (!captured || !preparationSignal || captured.live !== originalLive ||
          (captured.project._workspace || 'default') !== prepared.projectId ||
          projectVersion(captured.project) !== captured.configVersion ||
          (projectId !== undefined && projectId !== null && prepared.projectId !== projectId)) throw changed();
      const project = Object.defineProperty(structuredClone(captured.project), '_workspace',
        { value: captured.project._workspace, enumerable: false }) as Project;
      const version = captured.configVersion, active = AbortSignal.any([signal, preparationSignal]);
      const workspaces = this.terminals.workspaces;
      return await workspaces.projects.inScope(id, prepared.projectId, async () => {
        const origin = () => {
          active.throwIfAborted();
          if (this.machines.live.get(id) !== originalLive || this.machines.state(id) !== 'running' ||
              workspaces.projects.current(id) !== prepared.projectId) throw changed();
        };
        const assertCurrent = async () => {
          origin(); const current = await workspaces.config(id); origin();
          if ((current._workspace || 'default') !== prepared.projectId || projectVersion(current) !== version ||
              projectVersion(project) !== version) throw changed();
        };
        await assertCurrent();
        const resolved = await workspaces.resolveProject(id, project);
        await assertCurrent();
        if ((resolved._workspace || 'default') !== prepared.projectId || resolved.directory !== project.directory ||
            (resolved.networkIsolation || 'host') !== (project.networkIsolation || 'host')) throw changed();
        const execution = { command: input.command, environment: resolved.environment };
        try { projectIdentityPayload(execution); }
        catch { throw new AppError('项目命令或环境超过原生受保护输入边界', 413, 'PROJECT_IDENTITY_PAYLOAD_INVALID'); }
        return this.machines.locked(id, async () => {
          await assertCurrent();
          const result = await this.runProjectTask(this.machines, id, project, execution,
            active, undefined, input.timeoutSeconds * 1000, undefined, undefined, { expectedLive: originalLive });
          await assertCurrent();
          return { ...redactProjectOutput(resolved, result), scope: 'project' as const,
            projectId: prepared.projectId, directory: project.directory,
            networkIsolation: project.networkIsolation || 'host' };
        });
      });
    } catch (error) { failed = true; failure = error; throw error; }
    finally {
      try { await prepared.release(); }
      catch (error) {
        if (!failed) throw error;
        const errors = [failure, error];
        const critical = errors.find((value) => value instanceof AppError && value.status === 503);
        throw new ProjectExecutionCleanupErrors(errors, critical || failure || error);
      }
    }
  }

  close() {
    if (this.closing) return this.closing;
    this.controller.abort();
    this.closing = (async () => {
      const results = await Promise.allSettled([...this.pending]);
      const errors = results.flatMap(result => result.status === 'rejected' && result.reason instanceof AppError &&
        result.reason.status === 503 ? [result.reason] : []);
      if (errors.length) throw errors.length === 1 ? errors[0] : new ProjectExecutionCleanupErrors(errors, errors[0]);
    })();
    return this.closing;
  }
}

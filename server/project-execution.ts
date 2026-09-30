import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { ProjectTerminals } from './project-terminals.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { envPrefix } from './project-services.ts';
import { projectNetworkCommand, ensureProjectNetworkScript, projectNetworkNamespace,
  projectNetworkCheckScript } from './project-network-isolation.ts';
import { Workspaces, projectPrivateValues, type Project } from './workspaces.ts';
import { redactValues } from './secrets.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';

export function projectExecutionCommand(project: Project, command: string) {
  return projectNetworkCommand(project,
    `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` +
    `exec /bin/sh -c ${quote(command)}`);
}

export function redactProjectOutput<T extends { stdout: string; stderr: string }>(project: Project, result: T) {
  const values = projectPrivateValues(project);
  return { ...result, stdout: redactValues(result.stdout, values), stderr: redactValues(result.stderr, values) };
}

/** Agent operations hold the VM lock through setup, execution and cleanup. */
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

/** One-shot project commands use the same configuration and guards as terminals. */
export class ProjectExecution {
  private controller = new AbortController();
  private pending = new Set<Promise<unknown>>();
  constructor(private machines: Machines, private terminals: ProjectTerminals) {}

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
    const prepared = await this.terminals.prepare(id, projectId, null, false, signal);
    try {
      // The preparation lease keeps the captured directory and network mode
      // stable. Environment changes may apply to this next command, but are
      // loaded and exported only inside the project's network namespace.
      const project = await this.terminals.workspaces.projects.inScope(id, prepared.projectId,
        () => this.terminals.workspaces.resolvedConfig(id));
      signal.throwIfAborted();
      return await this.machines.locked(id, async () => {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动或恢复实例', 409);
        const result = await guestTask(this.machines, id, projectExecutionCommand(project, input.command),
          signal, undefined, input.timeoutSeconds * 1000);
        return { ...redactProjectOutput(project, result), scope: 'project' as const,
          projectId: prepared.projectId, directory: project.directory,
          networkIsolation: project.networkIsolation || 'host' };
      });
    } finally { prepared.release(); }
  }

  async close() {
    this.controller.abort();
    await Promise.allSettled([...this.pending]);
  }
}

import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { ProjectTerminals } from './project-terminals.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { envPrefix } from './project-services.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import { projectPrivateValues } from './workspaces.ts';
import { redactValues } from './secrets.ts';
import { guestTask } from './guest-task.ts';
import { projectIdSchema } from './project-catalog.ts';

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
        const result = await guestTask(this.machines, id, projectNetworkCommand(project,
          `set -eu\n${envPrefix(project.environment)}\ncd ${quote(project.directory)}\n` +
          `exec /bin/sh -c ${quote(input.command)}`), signal, undefined, input.timeoutSeconds * 1000);
        const privateValues = projectPrivateValues(project);
        return { ...result, stdout: redactValues(result.stdout, privateValues),
          stderr: redactValues(result.stderr, privateValues), scope: 'project' as const,
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

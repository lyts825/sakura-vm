import { connect } from 'node:net';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { projectPrivateValues } from './workspaces.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactProjectOutput } from './project-execution.ts';
import { redactValues } from './secrets.ts';
import { OwnedForwardAgent, SshAgentScopes } from './ssh-agent-scope.ts';

export const sshAgentForwardInput = z.object({
  command: z.string().min(1).max(8192),
  confirmed: z.literal(true),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

export function hostAgentSocket() {
  return process.env.SSH_AUTH_SOCK ||
    (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
}

export async function agentReachable(path: string, signal?: AbortSignal) {
  if (!path) return false;
  signal?.throwIfAborted();
  return new Promise<boolean>((resolve) => {
    let socket;
    try { socket = connect(path); }
    catch { resolve(false); return; }
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      resolve(ready);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function checkSshAgentForward(machines: Machines, id: string,
  signal?: AbortSignal) {
  const socket = hostAgentSocket();
  const hostReady = await agentReachable(socket, signal);
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, hostReady,
      reason: '请先启动实例。' };
  const guest = await machines.exec(id,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/sh -c "command -v ssh-add >/dev/null && test -x /usr/bin/python3"', 10000, signal);
  return { ready: hostReady && guest.code === 0, executed: false, hostReady,
    guestReady: guest.code === 0,
    reason: !hostReady ? '宿主机 SSH Agent 未运行。' :
      guest.code !== 0 ? '客户机需要安装 OpenSSH 客户端与系统 Python。' :
        '提交明确命令并设置 confirmed=true 后，仅在该命令运行期间转发 Agent。' };
}

export class SshAgentForwarder {
  private terminals: ProjectTerminals;
  private ownTerminals: boolean;
  private runTask: typeof projectIdentityTask;
  private scopes: SshAgentScopes;
  constructor(private machines: Machines, options: { workspaces?: Workspaces; terminals?: ProjectTerminals;
    runTask?: typeof projectIdentityTask; sourceDirectory?: string } = {}) {
    this.ownTerminals = !options.terminals;
    this.terminals = options.terminals || new ProjectTerminals(machines, options.workspaces);
    this.runTask = options.runTask || projectIdentityTask;
    this.scopes = new SshAgentScopes(machines, { sourceDirectory: options.sourceDirectory });
  }
  async run(id: string, input: unknown, signal?: AbortSignal) {
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let agent: OwnedForwardAgent | undefined, values: string[] = [], completed, failure: unknown;
    try {
      const options = sshAgentForwardInput.parse(input);
      // Capture the caller's exact catalog context before any asynchronous
      // Agent probe; a later change cannot reinterpret this submission.
      const projectId = this.terminals.workspaces.projects.current(id);
      this.machines.requireUnlocked(id);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
      signal?.throwIfAborted();
      const socket = hostAgentSocket();
      if (!await agentReachable(socket, signal)) {
        signal?.throwIfAborted();
        throw new AppError('宿主机 SSH Agent 未运行', 409);
      }
      prepared = await this.terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: executionSignal } = prepared;
      if (!captured || !executionSignal || this.machines.live.get(id) !== captured.live)
        throw new AppError('Agent 命令准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      values = projectPrivateValues(captured.project);
      const project = await this.terminals.workspaces.resolveProject(id, captured.project);
      values = projectPrivateValues(project);
      executionSignal.throwIfAborted();
      const { SSH_AUTH_SOCK: _ignored, ...environment } = project.environment || {};
      agent = new OwnedForwardAgent(socket, executionSignal);
      const resource = await this.scopes.resource(options.timeoutSeconds);
      const result = await this.runTask(this.machines, id, project,
        { command: options.command, environment }, executionSignal, undefined, options.timeoutSeconds * 1000,
        undefined, undefined, { expectedLive: captured.live, sshAgent: { resource, agent, scopes: this.scopes } });
      completed = { ...redactProjectOutput(project, result), ready: result.code === 0, executed: true,
        projectId: prepared.projectId, directory: project.directory, configVersion: captured.configVersion,
        networkIsolation: project.networkIsolation || 'host', message: '本任务 Agent 资源与账号票据已确认关闭。' };
    } catch (error) { failure = error; }
    finally {
      try { await agent?.close(); }
      catch (error) { if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))) failure = error; }
      prepared?.release();
      if (this.ownTerminals) {
        try { await this.terminals.close(); }
        catch (error) { if (!failure) failure = error; }
      }
    }
    if (failure !== undefined) throw new AppError(redactValues(String((failure as Error)?.message || failure), values),
      failure instanceof AppError ? failure.status : 409, failure instanceof AppError ? failure.code : undefined);
    return completed!;
  }
}

export async function runSshAgentForward(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal, workspaces?: Workspaces, terminals?: ProjectTerminals) {
  return new SshAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal);
}

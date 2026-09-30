import { connect } from 'node:net';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { guestTask } from './guest-task.ts';
import { withProjectCommand, projectExecutionCommand, redactProjectOutput } from './project-execution.ts';

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
  const guest = await machines.exec(id, 'command -v ssh-add >/dev/null', 10000, signal);
  return { ready: hostReady && guest.code === 0, executed: false, hostReady,
    guestReady: guest.code === 0,
    reason: !hostReady ? '宿主机 SSH Agent 未运行。' :
      guest.code !== 0 ? '客户机需要安装 OpenSSH 客户端。' :
        '提交明确命令并设置 confirmed=true 后，仅在该命令运行期间转发 Agent。' };
}

export async function runSshAgentForward(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal, workspaces?: Workspaces) {
  const options = sshAgentForwardInput.parse(input);
  machines.requireUnlocked(id);
  if (machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
  const socket = hostAgentSocket();
  if (!await agentReachable(socket, signal)) throw new AppError('宿主机 SSH Agent 未运行', 409);
  signal?.throwIfAborted();
  return withProjectCommand(machines, id, signal, workspaces, async (project) => {
    // sshd supplies the socket for this connection; project configuration must
    // not replace it with a different agent path.
    const { SSH_AUTH_SOCK: _ignored, ...environment } = project.environment || {};
    const result = await guestTask(machines, id,
      projectExecutionCommand({ ...project, environment }, options.command),
      signal || new AbortController().signal, undefined, options.timeoutSeconds * 1000, socket);
    return { ...redactProjectOutput(project, result), ready: result.code === 0, executed: true,
      projectId: project._workspace || 'default', directory: project.directory,
      networkIsolation: project.networkIsolation || 'host',
      message: 'Agent 转发连接已随命令结束关闭。' };
  });
}

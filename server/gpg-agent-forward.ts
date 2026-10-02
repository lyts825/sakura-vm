import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, win32 } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { projectPrivateValues } from './workspaces.ts';
import { ProjectTerminals } from './project-terminals.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactProjectOutput } from './project-execution.ts';
import { redactValues } from './secrets.ts';
import { GpgAgentScopes } from './gpg-agent-scope.ts';
import { captureHostGpgSource, OwnedGpgForward, type GpgHostSnapshot } from './gpg-agent-host.ts';

const execFileAsync = promisify(execFile);

export const gpgAgentForwardInput = z.object({
  command: z.string().min(1).max(8192),
  confirmed: z.literal(true),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

function normalizeSocket(value: string) {
  const path = value.trim();
  const msys = process.platform === 'win32' ? /^\/([a-z])\/(.+)$/i.exec(path) : null;
  const resolved = msys ? `${msys[1].toUpperCase()}:\\${msys[2].replaceAll('/', '\\')}` : path;
  if (!resolved || resolved.length > 4096 || /[\x00-\x1f]/.test(resolved) ||
      !(isAbsolute(resolved) || win32.isAbsolute(resolved)))
    throw new AppError('GPG Agent extra socket 路径无效', 409);
  return resolved;
}

export async function hostGpgExtraSocket() {
  if (process.env.SAKURA_GPG_EXTRA_SOCKET)
    return normalizeSocket(process.env.SAKURA_GPG_EXTRA_SOCKET);
  const candidates: string[] = [];
  if (process.platform === 'win32') {
    for (const directory of [process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']) {
      const native = join(directory, 'GnuPG', 'bin', 'gpgconf.exe');
      if (existsSync(native)) candidates.push(native);
    }
  }
  candidates.push('gpgconf');
  for (const candidate of candidates) {
    try {
      const { stdout } = await execFileAsync(candidate, ['--list-dirs', 'agent-extra-socket'],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true });
      if (stdout.trim()) return normalizeSocket(stdout);
    } catch { /* Query another installed client; never autostart an Agent. */ }
  }
  return '';
}

/** Readiness includes the source identity and a real restricted-extra probe. */
export async function gpgSocketReachable(path: string, signal?: AbortSignal) {
  if (!path) return false;
  signal?.throwIfAborted();
  try { await captureHostGpgSource(path, signal); return true; }
  catch { signal?.throwIfAborted(); return false; }
}

export async function guestGpgForwardingReady(machines: Machines, id: string, signal?: AbortSignal) {
  const config = await machines.exec(id,
    'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /usr/sbin/sshd -T', 10000, signal);
  if (config.code !== 0) return false;
  const settings = new Map(config.stdout.split(/\r?\n/)
    .map(line => line.trim().split(/\s+/, 2) as [string, string]));
  return settings.get('disableforwarding') === 'no' &&
    ['yes', 'remote'].includes(settings.get('allowtcpforwarding') || '') &&
    ['yes', 'remote'].includes(settings.get('allowstreamlocalforwarding') || '');
}

const guestRequirements = 'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C ' +
  '/bin/sh -c "command -v gpg >/dev/null && command -v gpgconf >/dev/null && test -x /usr/bin/python3"';

export async function checkGpgAgentForward(machines: Machines, id: string, signal?: AbortSignal) {
  const socket = await hostGpgExtraSocket();
  const hostReady = await gpgSocketReachable(socket, signal);
  signal?.throwIfAborted();
  if (machines.state(id) !== 'running')
    return { ready: false, executed: false, hostReady, reason: '请先启动实例。' };
  const guest = await machines.exec(id, guestRequirements, 10000, signal);
  const forwardingReady = guest.code === 0 && await guestGpgForwardingReady(machines, id, signal);
  return { ready: hostReady && guest.code === 0 && forwardingReady, executed: false, hostReady, forwardingReady,
    guestReady: guest.code === 0,
    reason: !hostReady ? '宿主 GPG 原生 extra socket 或来源身份校验未就绪。' :
      guest.code !== 0 ? '客户机需要安装 GnuPG 与系统 Python。' :
        !forwardingReady ? '客户机 SSH 服务需要 AllowTcpForwarding remote 和 AllowStreamLocalForwarding remote（或 yes）；修改后重启 sshd。' :
          '单次命令以项目账号访问受限制的 extra socket；客户机仍需导入对应公钥。' };
}

export class GpgAgentForwarder {
  private terminals: ProjectTerminals;
  private ownTerminals: boolean;
  private runTask: typeof projectIdentityTask;
  private scopes: GpgAgentScopes;
  private captureHost: (signal?: AbortSignal) => Promise<GpgHostSnapshot>;
  constructor(private machines: Machines, options: { workspaces?: Workspaces; terminals?: ProjectTerminals;
    runTask?: typeof projectIdentityTask; sourceDirectory?: string;
    captureHost?: (signal?: AbortSignal) => Promise<GpgHostSnapshot> } = {}) {
    this.ownTerminals = !options.terminals;
    this.terminals = options.terminals || new ProjectTerminals(machines, options.workspaces);
    this.runTask = options.runTask || projectIdentityTask;
    this.scopes = new GpgAgentScopes(machines, { sourceDirectory: options.sourceDirectory });
    this.captureHost = options.captureHost || (async signal => captureHostGpgSource(await hostGpgExtraSocket(), signal));
  }
  async run(id: string, input: unknown, signal?: AbortSignal) {
    let prepared: Awaited<ReturnType<ProjectTerminals['prepare']>> | undefined;
    let bridge: OwnedGpgForward | undefined, values: string[] = [], completed, failure: unknown;
    try {
      const options = gpgAgentForwardInput.parse(input);
      const projectId = this.terminals.workspaces.projects.current(id);
      this.machines.requireUnlocked(id);
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
      signal?.throwIfAborted();
      const source = await this.captureHost(signal);
      signal?.throwIfAborted();
      prepared = await this.terminals.prepare(id, projectId, null, false, signal, undefined, { mode: 'task' });
      const { captured, signal: executionSignal } = prepared;
      if (!captured || !executionSignal || this.machines.live.get(id) !== captured.live)
        throw new AppError('GPG 命令准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      values = projectPrivateValues(captured.project);
      const project = await this.terminals.workspaces.resolveProject(id, captured.project);
      values = projectPrivateValues(project);
      executionSignal.throwIfAborted();
      if (this.machines.live.get(id) !== captured.live)
        throw new AppError('GPG 项目解析期间客户机身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const installed = await this.machines.exec(id, guestRequirements, 10000, executionSignal);
      if (installed.code !== 0) throw new AppError('客户机需要安装 GnuPG 与系统 Python', 409);
      if (!await guestGpgForwardingReady(this.machines, id, executionSignal))
        throw new AppError('客户机 SSH 服务未允许远端 Unix 套接字转发；请启用 AllowTcpForwarding remote 和 AllowStreamLocalForwarding remote', 409);
      executionSignal.throwIfAborted();
      if (this.machines.live.get(id) !== captured.live)
        throw new AppError('GPG 客户机检查期间运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      const { GNUPGHOME: _ignoredHome, GPG_AGENT_INFO: _ignoredAgent, ...environment } = project.environment || {};
      bridge = new OwnedGpgForward(source, executionSignal);
      const resource = await this.scopes.resource(options.timeoutSeconds,
        { hostSourceSha256: bridge.hostSourceSha256, hostHelperSha256: bridge.hostHelperSha256 });
      const result = await this.runTask(this.machines, id, project,
        { command: options.command, environment }, executionSignal, undefined, options.timeoutSeconds * 1000,
        undefined, undefined, { expectedLive: captured.live, gpgAgent: { resource, bridge, scopes: this.scopes } });
      completed = { ...redactProjectOutput(project, result), ready: result.code === 0, executed: true,
        projectId: prepared.projectId, directory: project.directory, configVersion: captured.configVersion,
        networkIsolation: project.networkIsolation || 'host', message: '本任务 GPG 资源与账号票据已确认关闭。' };
    } catch (error) { failure = error; }
    finally {
      try { await bridge?.close(); }
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

export async function runGpgAgentForward(machines: Machines, id: string, input: unknown,
  signal?: AbortSignal, workspaces?: Workspaces, terminals?: ProjectTerminals) {
  return new GpgAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal);
}

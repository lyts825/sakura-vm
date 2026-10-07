/**
 * 模块职责：检查宿主 GPG extra socket 并启动项目转发，将权限限制在受限 Agent 接口。
 * Module purpose: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 */
import type { ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { hostExecFile } from './host-process.ts';
import { existsSync } from 'node:fs';
import { isAbsolute, join, win32 } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { projectPrivateValues } from './workspaces.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactProjectOutput } from './project-execution.ts';
import { redactValues } from './secrets.ts';
import { GpgAgentScopes } from './gpg-agent-scope.ts';
import { captureHostGpgSource, OwnedGpgForward, type GpgHostSnapshot } from './gpg-agent-host.ts';

export const gpgAgentForwardInput = z.object({
  command: z.string().min(1).max(8192),
  confirmed: z.literal(true),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

/**
 * 入口 / Entry: normalizeSocket.
 * 功能：在检查宿主 GPG extra socket 并启动项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `resolved` 供上层消费（`gpg-agent-forward.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpg-agent-forward.ts`; this entry produces `resolved` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 * 处理：通过 `value.trim`, `inline.exec`, `msys[...].toUpperCase`, `msys[...].replaceAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.trim`, `inline.exec`, `msys[...].toUpperCase`, `msys[...].replaceAll`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `resolved`.
 * 副作用 / Effects: `inline.exec`; `msys[...].replaceAll`.
 * 拒绝 / Refusals: 条件 / conditions `!resolved || resolved.length > 4096 || /[\x00-\x1f]/.test(resolved) || !(isAbsolute(resolved) || win32.isAbsolute(resolved))`; 异常 / errors `new AppError('GPG Agent extra socket 路径无效', 409)`.
 */
function normalizeSocket(value: string) {
  const path = value.trim();
  const msys = process.platform === 'win32' ? /^\/([a-z])\/(.+)$/i.exec(path) : null;
  const resolved = msys ? `${msys[1].toUpperCase()}:\\${msys[2].replaceAll('/', '\\')}` : path;
  if (!resolved || resolved.length > 4096 || /[\x00-\x1f]/.test(resolved) ||
      !(isAbsolute(resolved) || win32.isAbsolute(resolved)))
    throw new AppError('GPG Agent extra socket 路径无效', 409);
  return resolved;
}

/**
 * 入口 / Entry: hostGpgExtraSocket.
 * 功能：在检查宿主 GPG extra socket 并启动项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `normalizeSocket(process.env.SAKURA_GPG_EXTRA_SOCKET)` / `normalizeSocket(stdout)` 供上层消费（`gpg-agent-forward.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpg-agent-forward.ts`; this entry produces `normalizeSocket(process.env.SAKURA_GPG_EXTRA_SOCKET)` / `normalizeSocket(stdout)` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 * 处理：通过 `normalizeSocket`, `join`, `existsSync`, `candidates.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `normalizeSocket`, `join`, `existsSync`, `candidates.push`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `process.env.SAKURA_GPG_EXTRA_SOCKET`; `process.platform === 'win32'`; `existsSync(native)`.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `normalizeSocket(process.env.SAKURA_GPG_EXTRA_SOCKET)`; `normalizeSocket(stdout)`; `''`.
 * 副作用 / Effects: `candidates.push`.
 * 拒绝 / Refusals: 条件 / conditions `error instanceof AppError && error.status === 503`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (error instanceof AppError && error.status === 503) throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error instanceof AppError && error.status === 503) throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
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
      const { stdout } = await hostExecFile('gpg-discovery', candidate, ['--list-dirs', 'agent-extra-socket'],
        { timeout: 5000, maxBuffer: 4096 });
      if (stdout.trim()) return normalizeSocket(stdout);
    } catch (error) {
      if (error instanceof AppError && error.status === 503) throw error;
      /* Query another installed client; never autostart an Agent. */
    }
  }
  return '';
}

/** Readiness includes the source identity and a real restricted-extra probe. */
/**
 * 入口 / Entry: gpgSocketReachable.
 * 功能：在检查宿主 GPG extra socket 并启动项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `true` 供上层消费（`gpg-agent-forward.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpg-agent-forward.ts`; this entry produces `false` / `true` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 * 处理：通过 `signal.throwIfAborted`, `captureHostGpgSource` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `captureHostGpgSource`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!path`.
 * 输入 / Inputs: path: string; signal: AbortSignal optional
 * 输出 / Returns: `false`; `true`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return false;`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function gpgSocketReachable(path: string, signal?: AbortSignal) {
  if (!path) return false;
  signal?.throwIfAborted();
  try { await captureHostGpgSource(path, signal); return true; }
  catch { signal?.throwIfAborted(); return false; }
}

/**
 * 入口 / Entry: guestGpgForwardingReady.
 * 功能：在检查宿主 GPG extra socket 并启动项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `settings.get('disableforwarding') === 'no' && ['yes', 'remote'].includes(settings.get('allowtcpforwarding') || '') && ['yes',…` 供上层消费（`gpg-agent-forward.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `gpg-agent-forward.ts`; this entry produces `false` / `settings.get('disableforwarding') === 'no' && ['yes', 'remote'].includes(settings.get('allowtcpforwarding') || '') && ['yes',…` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 * 处理：通过 `machines.exec`, `config.stdout.split().map`, `config.stdout.split`, `settings.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.exec`, `config.stdout.split().map`, `config.stdout.split`, `settings.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `config.code !== 0`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `false`; `settings.get('disableforwarding') === 'no' && ['yes', 'remote'].includes(settings.get('allowtcpforwarding') || '') && ['yes',…`.
 * 副作用 / Effects: `machines.exec`; `settings.get`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/**
 * 入口 / Entry: checkGpgAgentForward.
 * 功能：在检查宿主 GPG extra socket 并启动项目转发中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }` / `{ ready: hostReady && guest.code === 0 && forwardingReady, executed: false, hostReady, forwardingReady, guestReady: guest.cod…` 供上层消费（`gpg-agent-forward.ts`）。
 * Purpose: Checks admission, input or resource ownership in `gpg-agent-forward.ts`; this entry produces `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }` / `{ ready: hostReady && guest.code === 0 && forwardingReady, executed: false, hostReady, forwardingReady, guestReady: guest.cod…` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
 * 处理：通过 `hostGpgExtraSocket`, `gpgSocketReachable`, `signal.throwIfAborted`, `machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostGpgExtraSocket`, `gpgSocketReachable`, `signal.throwIfAborted`, `machines.state`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }`; `{ ready: hostReady && guest.code === 0 && forwardingReady, executed: false, hostReady, forwardingReady, guestReady: guest.cod…`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 签名 / Signature: GpgAgentForwarder.captureHost.
   * 功能：为检查宿主 GPG extra socket 并启动项目转发声明 captureHost 的输入与结果契约，所属容器为 GpgAgentForwarder。
   * Purpose: Declares the input/result contract for captureHost in GpgAgentForwarder. Module responsibility: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: Promise<GpgHostSnapshot>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private captureHost: (signal?: AbortSignal) => Promise<GpgHostSnapshot>;
  /**
   * 入口 / Entry: GpgAgentForwarder.constructor.
   * 功能：建立 GpgAgentForwarder 的检查宿主 GPG extra socket 并启动项目转发上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the GpgAgentForwarder context for this module's responsibility: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: { workspaces?: WorkspacesV1; terminals?: ProjectTerminalsV1; runTask?: typeof project… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.ownTerminals`, `this.terminals`, `this.runTask`, `this.scopes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, options: { workspaces?: WorkspacesV1; terminals?: ProjectTerminalsV1;
    runTask?: typeof projectIdentityTask; sourceDirectory?: string;
    /**
     * 签名 / Signature: GpgAgentForwarder.constructor.captureHost.
     * 功能：为检查宿主 GPG extra socket 并启动项目转发声明 captureHost 的输入与结果契约，所属容器为 GpgAgentForwarder.constructor。
     * Purpose: Declares the input/result contract for captureHost in GpgAgentForwarder.constructor. Module responsibility: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
     * 输入 / Inputs: signal: AbortSignal optional
     * 输出 / Returns: Promise<GpgHostSnapshot>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    captureHost?: (signal?: AbortSignal) => Promise<GpgHostSnapshot> } = {}) {
    this.ownTerminals = !options.terminals;
    this.terminals = options.terminals || projectTerminalsFor(machines, options.workspaces);
    this.runTask = options.runTask || projectIdentityTask;
    this.scopes = new GpgAgentScopes(machines, { sourceDirectory: options.sourceDirectory });
    this.captureHost = options.captureHost || (async signal => captureHostGpgSource(await hostGpgExtraSocket(), signal));
  }
  /**
   * 入口 / Entry: GpgAgentForwarder.run.
   * 功能：在检查宿主 GPG extra socket 并启动项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `completed!` 供上层消费（`GpgAgentForwarder`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `GpgAgentForwarder`; this entry produces `completed!` for its caller. Module context: Checks the host GPG extra socket and starts project forwarding through its restricted Agent interface.
   * 处理：通过 `gpgAgentForwardInput.parse`, `this.terminals.workspaces.projects.current`, `this.machines.requireUnlocked`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `gpgAgentForwardInput.parse`, `this.terminals.workspaces.projects.current`, `this.machines.requireUnlocked`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))`; `this.ownTerminals`; `!failure`.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `completed!`.
   * 副作用 / Effects: `executionSignal.throwIfAborted`; `this.machines.exec`; `bridge.close`; `prepared.release`; `this.terminals.close`; 更新 / updates `prepared`, `values`, `bridge`, `completed`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!captured || !executionSignal || this.machines.live.get(id) !== captured.live`; `this.machines.live.get(id) !== captured.live`; 异常 / errors `new AppError('请先启动实例', 409)`; `new AppError('GPG 命令准备的客户机身份未确认', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 收尾：退出 try 区域时始终执行 `try { await bridge?.close(); } catch (error) { if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED')…`; `prepared?.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await bridge?.close(); } catch (error) { if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED')…`; `prepared?.release();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failure = error;`; `if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))) failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; `if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))) failure = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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

/**
 * 入口 / Entry: runGpgAgentForward.
 * 功能：把本层请求转交 `GpgAgentForwarder.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `GpgAgentForwarder.run` and propagates the provider result or rejection.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; signal: AbortSignal optional; workspaces: WorkspacesV1 optional; terminals: ProjectTerminalsV1 optional
 * 输出 / Returns: `new GpgAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function runGpgAgentForward(machines: Machines, id: string, input: unknown,
  signal?: AbortSignal, workspaces?: WorkspacesV1, terminals?: ProjectTerminalsV1) {
  return new GpgAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal);
}

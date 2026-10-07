/**
 * 模块职责：检查宿主 SSH Agent 并建立项目转发，转发执行关联客户机运行及任务资源。
 * Module purpose: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources.
 */
import type { ProjectTerminalsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { networkFor } from './network/index.ts';

import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { projectPrivateValues } from './workspaces.ts';
import { projectTerminalsFor, type TerminalService as ProjectTerminals } from './terminal-backend.ts';
import { projectIdentityTask } from './project-run-scope.ts';
import { redactProjectOutput } from './project-execution.ts';
import { redactValues } from './secrets.ts';
import { OwnedForwardAgent, SshAgentScopes } from './ssh-agent-scope.ts';

const { connectLocal: connect } = networkFor('core:ssh-agent-forward');

export const sshAgentForwardInput = z.object({
  command: z.string().min(1).max(8192),
  confirmed: z.literal(true),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();

/**
 * 入口 / Entry: hostAgentSocket.
 * 功能：从当前输入或状态计算 `process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '')`，供调用方后续验证或使用。
 * Purpose: Computes `process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '')` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function hostAgentSocket() {
  return process.env.SSH_AUTH_SOCK ||
    (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '');
}

/**
 * 入口 / Entry: agentReachable.
 * 功能：在检查宿主 SSH Agent 并建立项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `new Promise<boolean>((resolve) => { let socket; try { socket = connect(path); } catch { resolve(false); return; } let settled…` 供上层消费（`ssh-agent-forward.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-agent-forward.ts`; this entry produces `false` / `new Promise<boolean>((resolve) => { let socket; try { socket = connect(path); } catch { resolve(false); return; } let settled…` for its caller. Module context: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources.
 * 处理：通过 `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!path`.
 * 输入 / Inputs: path: string; signal: AbortSignal optional
 * 输出 / Returns: `false`; `new Promise<boolean>((resolve) => { let socket; try { socket = connect(path); } catch { resolve(false); return; } let settled…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function agentReachable(path: string, signal?: AbortSignal) {
  if (!path) return false;
  signal?.throwIfAborted();
  /**
   * 入口 / Entry: agentReachable.callback@34.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve
   * 输出 / Returns: `void`; `abort()`.
   * 副作用 / Effects: `connect`; `setTimeout`; `signal.addEventListener`; `abort`; 更新 / updates `socket`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `resolve(false);`; `return;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `resolve(false);`; `return;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return new Promise<boolean>((resolve) => {
    let socket;
    try { socket = connect(path); }
    catch { resolve(false); return; }
    let settled = false;
    /**
     * 入口 / Entry: agentReachable.finish.
     * 功能：在检查宿主 SSH Agent 并建立项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ssh-agent-forward.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `ssh-agent-forward.ts`; this entry produces `void` for its caller. Module context: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources.
     * 处理：通过 `clearTimeout`, `signal.removeEventListener`, `socket.destroy`, `resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `clearTimeout`, `signal.removeEventListener`, `socket.destroy`, `resolve`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `settled`.
     * 输入 / Inputs: ready: boolean
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `clearTimeout`; `socket.destroy`; 更新 / updates `settled`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      resolve(ready);
    };
    /**
     * 入口 / Entry: agentReachable.abort.
     * 功能：把本层请求转交 `finish`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `finish` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `finish(false)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(false), 3000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * 入口 / Entry: checkSshAgentForward.
 * 功能：在检查宿主 SSH Agent 并建立项目转发中，核对调用资格、输入或资源归属；本入口产生 `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }` / `{ ready: hostReady && guest.code === 0, executed: false, hostReady, guestReady: guest.code === 0, reason: !hostReady ? '宿主机 S…` 供上层消费（`ssh-agent-forward.ts`）。
 * Purpose: Checks admission, input or resource ownership in `ssh-agent-forward.ts`; this entry produces `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }` / `{ ready: hostReady && guest.code === 0, executed: false, hostReady, guestReady: guest.code === 0, reason: !hostReady ? '宿主机 S…` for its caller. Module context: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources.
 * 处理：通过 `hostAgentSocket`, `agentReachable`, `machines.state`, `machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `hostAgentSocket`, `agentReachable`, `machines.state`, `machines.exec`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `machines.state(id) !== 'running'`.
 * 输入 / Inputs: machines: Machines; id: string; signal: AbortSignal optional
 * 输出 / Returns: `{ ready: false, executed: false, hostReady, reason: '请先启动实例。' }`; `{ ready: hostReady && guest.code === 0, executed: false, hostReady, guestReady: guest.code === 0, reason: !hostReady ? '宿主机 S…`.
 * 副作用 / Effects: `machines.exec`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  /**
   * 入口 / Entry: SshAgentForwarder.constructor.
   * 功能：建立 SshAgentForwarder 的检查宿主 SSH Agent 并建立项目转发上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SshAgentForwarder context for this module's responsibility: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: { workspaces?: WorkspacesV1; terminals?: ProjectTerminalsV1; runTask?: typeof project… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.ownTerminals`, `this.terminals`, `this.runTask`, `this.scopes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, options: { workspaces?: WorkspacesV1; terminals?: ProjectTerminalsV1;
    runTask?: typeof projectIdentityTask; sourceDirectory?: string } = {}) {
    this.ownTerminals = !options.terminals;
    this.terminals = options.terminals || projectTerminalsFor(machines, options.workspaces);
    this.runTask = options.runTask || projectIdentityTask;
    this.scopes = new SshAgentScopes(machines, { sourceDirectory: options.sourceDirectory });
  }
  /**
   * 入口 / Entry: SshAgentForwarder.run.
   * 功能：在检查宿主 SSH Agent 并建立项目转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `completed!` 供上层消费（`SshAgentForwarder`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SshAgentForwarder`; this entry produces `completed!` for its caller. Module context: Checks host SSH Agent availability and opens project forwarding bound to guest/task resources.
   * 处理：通过 `sshAgentForwardInput.parse`, `this.terminals.workspaces.projects.current`, `this.machines.requireUnlocked`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sshAgentForwardInput.parse`, `this.terminals.workspaces.projects.current`, `this.machines.requireUnlocked`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))`; `this.ownTerminals`; `!failure`.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `completed!`.
   * 副作用 / Effects: `executionSignal.throwIfAborted`; `agent.close`; `prepared.release`; `this.terminals.close`; 更新 / updates `prepared`, `values`, `agent`, `completed`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `!await agentReachable(socket, signal)`; `!captured || !executionSignal || this.machines.live.get(id) !== captured.live`; 异常 / errors `new AppError('请先启动实例', 409)`; `new AppError('宿主机 SSH Agent 未运行', 409)`.
   * 收尾：退出 try 区域时始终执行 `try { await agent?.close(); } catch (error) { if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))…`; `prepared?.release();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `try { await agent?.close(); } catch (error) { if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))…`; `prepared?.release();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failure = error;`; `if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))) failure = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failure = error;`; `if (!(failure instanceof AppError && failure.code?.endsWith('_CLEANUP_FAILED'))) failure = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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

/**
 * 入口 / Entry: runSshAgentForward.
 * 功能：把本层请求转交 `SshAgentForwarder.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `SshAgentForwarder.run` and propagates the provider result or rejection.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown; signal: AbortSignal optional; workspaces: WorkspacesV1 optional; terminals: ProjectTerminalsV1 optional
 * 输出 / Returns: `new SshAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function runSshAgentForward(machines: Machines, id: string,
  input: unknown, signal?: AbortSignal, workspaces?: WorkspacesV1, terminals?: ProjectTerminalsV1) {
  return new SshAgentForwarder(machines, { workspaces, terminals }).run(id, input, signal);
}

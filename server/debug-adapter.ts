/**
 * 模块职责：管理项目 Python 调试适配器及断点、检查请求；停止依赖原协议运行票据。
 * Module purpose: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { posix } from 'node:path';
import type { VmAccess as Machines } from './vm-access.ts';

import { AppError } from '../shared/errors.ts';
import { guestPath } from '../shared/paths.ts';
import { quote } from './shell.ts';
import { repositoryPath } from './git-workbench.ts';
import { DapTransport } from './dap-transport.ts';
import { ProjectProtocolStreams, type OwnedProjectProtocolStream } from './project-protocol-stream.ts';
import {
  projectDapPython,
  projectProtocolInstallScript,
  projectProtocolInstalledCommand,
} from './project-protocol-assets.ts';
import { guestTask } from './guest-task.ts';
import { projectVersion } from './project-config.ts';

const python = projectDapPython;
const maxOutput = 64 * 1024;
type Frame = { id: number; name: string; path: string; line: number; column: number };
type Variable = { name: string; value: string; type: string; variablesReference: number };
type Session = {
  id: string; vm: string; directory: string; program: string;
  owner: OwnedProjectProtocolStream; transport: DapTransport;
  state: 'starting' | 'running' | 'stopped' | 'terminated' | 'error';
  reason: string; threadId: number; output: string; breakpoints: { line: number; verified: boolean; message?: string }[];
  revision: number; cachedRevision: number; frames: Frame[]; variables: Variable[]; error: string;
  selectedFrame: number;
  startedAt: string;
  cleanupError?: unknown;
};
/**
 * 入口 / Entry: projectFile.
 * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `path` 供上层消费（`debug-adapter.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `debug-adapter.ts`; this entry produces `path` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
 * 处理：通过 `guestPath`, `posix.relative`, `relative.startsWith`, `posix.isAbsolute` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `guestPath`, `posix.relative`, `relative.startsWith`, `posix.isAbsolute`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: directory: string; input: string
 * 输出 / Returns: `path`.
 * 副作用 / Effects: `relative.startsWith`.
 * 拒绝 / Refusals: 条件 / conditions `relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative)`; `!repositoryPath.safeParse(relative).success`; `!path.endsWith('.py')`; 异常 / errors `new AppError('调试文件必须位于当前项目目录', 400)`; `new AppError('调试文件路径无效', 400)`.
 */
function projectFile(directory: string, input: string) {
  const path = guestPath(input);
  const relative = posix.relative(directory, path);
  if (relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative))
    throw new AppError('调试文件必须位于当前项目目录', 400);
  if (!repositoryPath.safeParse(relative).success) throw new AppError('调试文件路径无效', 400);
  if (!path.endsWith('.py')) throw new AppError('当前 DAP 调试器支持 Python 文件');
  return path;
}
/**
 * 入口 / Entry: lines.
 * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...new Set(input)].sort((a, b) => a - b)` 供上层消费（`debug-adapter.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `debug-adapter.ts`; this entry produces `[...new Set(input)].sort((a, b) => a - b)` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
 * 处理：通过 `input.some`, `inline.sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `input.some`, `inline.sort`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: input: number[]
 * 输出 / Returns: `[...new Set(input)].sort((a, b) => a - b)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(input) || input.length > 100 || input.some((line) => !Number.isInteger(line) || line < 1 || line > 100000)`; 异常 / errors `new AppError('断点行号无效')`.
 */
function lines(input: number[]) {
  if (!Array.isArray(input) || input.length > 100 || input.some((line) =>
    !Number.isInteger(line) || line < 1 || line > 100000)) throw new AppError('断点行号无效');
  return [...new Set(input)].sort((a, b) => a - b);
}

export class DebugAdapter {
  private sessions = new Map<string, Session>();
  private starting = new Set<string>();
  private streams: Pick<ProjectProtocolStreams, 'open' | 'recordsAll' | 'readonly' | 'stop' | 'close'>;
  /**
   * 入口 / Entry: DebugAdapter.constructor.
   * 功能：建立 DebugAdapter 的管理项目 Python 调试适配器及断点、检查请求上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the DebugAdapter context for this module's responsibility: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: { streams?: DebugAdapter['streams']; adminTask?: typeof guestTask } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.streams`.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1,
    private options: { streams?: DebugAdapter['streams']; adminTask?: typeof guestTask } = {}) {
    this.streams = options.streams || new ProjectProtocolStreams(machines, workspaces);
  }
  /**
   * 入口 / Entry: DebugAdapter.status.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ installed: true, ...await this.snapshot(session, false), active: false, needsReview: true, error: (error as Error).message …` / `{ installed: true, ...await this.snapshot(session) }` 供上层消费（`DebugAdapter`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DebugAdapter`; this entry produces `{ installed: true, ...await this.snapshot(session, false), active: false, needsReview: true, error: (error as Error).message …` / `{ installed: true, ...await this.snapshot(session) }` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.sessions.get`, `inline.includes`, `this.selected`, `this.snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.get`, `inline.includes`, `this.selected`, `this.snapshot`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session`; `!['terminated', 'error'].includes(session.state)`; `records.length`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ installed: true, ...await this.snapshot(session, false), active: false, needsReview: true, error: (error as Error).message …`; `{ installed: true, ...await this.snapshot(session) }`; `{ installed: true, active: false, token: record.runId, state: 'error' as const, needsReview: true, error, pending: records.ma…`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `error`, `installed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return { installed: true, ...await this.snapshot(session, false), active: false, needsReview: true, error: (error as Error).m…`; `error += '：' + (failure as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return { installed: true, ...await this.snapshot(session, false), active: false, needsReview: true, error: (error as Error).m…`; `error += '：' + (failure as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async status(id: string, signal?: AbortSignal) {
    const session = this.sessions.get(id);
    if (session) {
      if (!['terminated', 'error'].includes(session.state)) {
        try { await this.selected(id, session.id); }
        catch (error) { return { installed: true, ...await this.snapshot(session, false), active: false,
          needsReview: true, error: (error as Error).message }; }
      }
      return { installed: true, ...await this.snapshot(session) };
    }
    const records = (await this.streams.recordsAll(id)).filter(record => record.kind === 'dap');
    if (records.length) {
      const record = records[0]; let error = '原调试协议连接已丢失，请按原 token 停止完整运行域';
      try { await this.streams.readonly(record, signal); } catch (failure) { error += '：' + (failure as Error).message; }
      return { installed: true, active: false, token: record.runId, state: 'error' as const, needsReview: true, error,
        pending: records.map(item => ({ token: item.runId, projectId: item.projectId, phase: item.phase })) };
    }
    const result = await this.machines.exec(id, projectProtocolInstalledCommand('dap'), 10000, signal);
    let installed = false; if (result.code === 0) { try { installed = JSON.parse(result.stdout).installed === true; } catch {} }
    return { installed, active: false };
  }
  /**
   * 入口 / Entry: DebugAdapter.install.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ installed: true }` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `{ installed: true }` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `projectProtocolInstallScript`, `this.machines.get`, `inline`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectProtocolInstallScript`, `this.machines.get`, `inline`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ installed: true }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(`Python 调试器安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502)`.
   */
  async install(id: string, signal?: AbortSignal) {
    const command = projectProtocolInstallScript('dap', this.machines.get(id).distro || 'alpine');
    const result = await (this.options.adminTask || guestTask)(this.machines, id, command,
      signal || new AbortController().signal, () => {}, 360000);
    if (result.code !== 0) throw new AppError(`Python 调试器安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    return { installed: true };
  }
  /**
   * 入口 / Entry: DebugAdapter.start.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await this.workspaces.projects.inScope(id, projectId, () => this.startSession(id, copied, signal, projectId, live))` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `await this.workspaces.projects.inScope(id, projectId, () => this.startSession(id, copied, signal, projectId, live))` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.starting.has`, `this.workspaces.projects.current`, `this.machines.live.get`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.starting.has`, `this.workspaces.projects.current`, `this.machines.live.get`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] }; signal: AbortSignal optional
   * 输出 / Returns: `await this.workspaces.projects.inScope(id, projectId, () => this.startSession(id, copied, signal, projectId, live))`.
   * 副作用 / Effects: `this.starting.has`; `this.starting.add`; `this.starting.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.starting.has(id)`; `!live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('调试会话正在启动', 409)`; `new AppError('原客户机运行身份不可用', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 收尾：退出 try 区域时始终执行 `this.starting.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.starting.delete(id);`; these steps also apply to exceptional exits.
   */
  async start(id: string, input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] }, signal?: AbortSignal) {
    if (this.starting.has(id)) throw new AppError('调试会话正在启动', 409);
    const projectId = this.workspaces.projects.current(id), live = this.machines.live.get(id), copied = structuredClone(input);
    if (!live || this.machines.state(id) !== 'running') throw new AppError('原客户机运行身份不可用', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    this.starting.add(id);
    try {
      return await this.workspaces.projects.inScope(id, projectId, () => this.startSession(id, copied, signal, projectId, live));
    } finally {
      this.starting.delete(id);
    }
  }
  /**
   * 入口 / Entry: DebugAdapter.startSession.
   * 功能：在项目协议作用域启动 Python 调试，配置启动请求和断点后返回会话快照。
   * Purpose: Starts project-scoped Python debugging, sets launch/breakpoints and returns a session snapshot.
   * 设计：早期 launch 失败始终被观察；准备后检查原配置和完整运行票据，异常关闭协议拥有者而不是未知同名会话。
   * Design: Early launch rejection is observed; original configuration/tickets are checked and failure closes the protocol owner, not a same-name unknown session.
   * 输入 / Inputs: id: string; input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] }; signal: AbortSignal | undefined; projectId: string; live: object
   * 输出 / Returns: `this.snapshot(session, false)`; `snapshot`.
   * 副作用 / Effects: `this.stop`; `this.machines.exec`; `this.sessions.set`; `transport.request`; `closeTerminated`; 更新 / updates `installed`, `owner`, `transport`, `session.breakpoints`.
   * 拒绝 / Refusals: 条件 / conditions `(raw._workspace || 'default') !== projectId`; `args.length > 20 || args.some((item) => typeof item !== 'string' || item.length > 1024 || /[\x00-\x1f]/.test(item))`; `existing && !['terminated', 'error'].includes(existing.state)`; 异常 / errors `new AppError('原项目配置归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`; `new AppError('调试参数无效')`.
   * 失败处理：catch 分支执行 `transport?.close();`; `try { await owner?.close(); } catch (cleanupError) { const session = this.sessions.get(id); if (session) { session.state = 'e…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `transport?.close();`; `try { await owner?.close(); } catch (cleanupError) { const session = this.sessions.get(id); if (session) { session.state = 'e…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async startSession(id: string, input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] },
    signal: AbortSignal | undefined, projectId: string, live: object) {
    /**
     * 入口 / Entry: DebugAdapter.startSession.current.
     * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`DebugAdapter`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; the calls and state transitions below complete the operation. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
     * 处理：通过 `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.throwIfAborted`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'run…`; 异常 / errors `new AppError('原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
     */
    const current = () => { signal?.throwIfAborted();
      if (this.workspaces.projects.current(id) !== projectId || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
        throw new AppError('原项目或客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED'); };
    current();
    const raw = await this.workspaces.config(id);
    current(); if ((raw._workspace || 'default') !== projectId) throw new AppError('原项目配置归属不符', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    const project = Object.defineProperty(structuredClone(raw), '_workspace', { value: raw._workspace, enumerable: false });
    const program = projectFile(project.directory, input.path);
    const breakpoints = lines(input.breakpoints);
    const args = input.args || [];
    if (args.length > 20 || args.some((item) => typeof item !== 'string' || item.length > 1024 || /[\x00-\x1f]/.test(item)))
      throw new AppError('调试参数无效');
    const existing = this.sessions.get(id);
    if (existing && !['terminated', 'error'].includes(existing.state)) throw new AppError('当前实例已有调试会话，请先停止', 409);
    if (this.sessions.size >= 4 && !existing) throw new AppError('同时最多运行四个调试会话', 409);
    if (existing) { await this.stop(id, existing.id); current(); }
    if ((await this.streams.recordsAll(id)).some(record => record.kind === 'dap'))
      throw new AppError('原调试运行票据尚未核销，请先按原 token 停止', 409, 'PROJECT_IDENTITY_RUN_STALE');
    current();
    const checked = await this.machines.exec(id, projectProtocolInstalledCommand('dap'), 10000, signal);
    current();
    let installed = false; if (checked.code === 0) { try { installed = JSON.parse(checked.stdout).installed === true; } catch {} }
    if (!installed) throw new AppError('请先安装 Python 调试器', 409);
    let owner: OwnedProjectProtocolStream | undefined;
    let transport: DapTransport | undefined;
    try {
      owner = await this.streams.open(id, 'dap', project, () => ({ command:
        'test -f ' + quote(program) + ' && exec ' + quote(python) + ' -I -m debugpy.adapter' }), signal, undefined, live);
      current();
      await owner.assertCurrent(); await owner.assertNative();
      transport = new DapTransport(owner.stream);
      const session: Session = {
        id: owner.record().runId, vm: id, directory: project.directory, program, owner, transport,
        state: 'starting', reason: '', threadId: 0, output: '', breakpoints: [], revision: 0,
        cachedRevision: -1, frames: [], variables: [], selectedFrame: 0,
        error: '', startedAt: new Date().toISOString(),
      };
      this.sessions.set(id, session);
      let handshakeComplete = false;
      /**
       * 入口 / Entry: DebugAdapter.startSession.callback@139.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（session.owner.close().catch）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (session.owner.close().catch).
       * 输入 / Inputs: error
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `session.cleanupError`, `session.state`, `session.error`.
       * 拒绝 / Refusals: 异常 / errors `error`.
       */
      /**
       * 入口 / Entry: DebugAdapter.startSession.closeTerminated.
       * 功能：在管理项目 Python 调试适配器及断点、检查请求中，结束、撤销或清理本次拥有的领域资源；本入口产生 `session.owner.close().catch(error => { session.cleanupError = error; session.state = 'error'; session.error = (error as Error…` 供上层消费（`DebugAdapter`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `DebugAdapter`; this entry produces `session.owner.close().catch(error => { session.cleanupError = error; session.state = 'error'; session.error = (error as Error…` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
       * 处理：通过 `session.owner.close().catch`, `session.owner.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `session.owner.close().catch`, `session.owner.close`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `session.owner.close().catch(error => { session.cleanupError = error; session.state = 'error'; session.error = (error as Error…`.
       * 副作用 / Effects: `session.owner.close().catch`; `session.owner.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const closeTerminated = () => session.owner.close().catch(error => {
        session.cleanupError = error; session.state = 'error'; session.error = (error as Error).message;
        throw error;
      });
      /**
       * 入口 / Entry: DebugAdapter.startSession.callback@143.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（transport.onEvent）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (transport.onEvent).
       * 输入 / Inputs: event; body
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `closeTerminated().catch`; `closeTerminated`; 更新 / updates `session.output`, `session.state`, `session.reason`, `session.threadId`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      transport.onEvent((event, body) => {
        if (event === 'output') {
          session.output = (session.output + String(body.output || '')).slice(-maxOutput);
        } else if (event === 'stopped') {
          session.state = 'stopped'; session.reason = String(body.reason || '暂停');
          session.threadId = Number(body.threadId || 0); session.revision++;
        } else if (event === 'continued') {
          session.state = 'running'; session.frames = []; session.variables = []; session.selectedFrame = 0; session.revision++;
        } else if (event === 'terminated' || event === 'exited') {
          session.state = 'terminated'; session.revision++;
          if (handshakeComplete) void closeTerminated().catch(() => {});
        }
      });
      /**
       * 入口 / Entry: DebugAdapter.startSession.callback@156.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（owner.done.then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (owner.done.then).
       * 输入 / Inputs: error
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `transport.close`; 更新 / updates `session.state`, `session.cleanupError`, `session.error`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      void owner.done.then(() => { session.state = 'terminated'; session.cleanupError = undefined; transport?.close(); }, error => {
        session.state = 'error'; session.cleanupError = error; session.error = (error as Error).message; transport?.close();
      });
      await transport.request('initialize', {
        clientID: 'sakura', clientName: 'Sakura', adapterID: 'python', locale: 'zh-CN',
        linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
        supportsVariableType: true, supportsVariablePaging: false, supportsRunInTerminalRequest: false,
      });
      const launch = transport.request('launch', {
        name: 'Python', type: 'python', request: 'launch', program, cwd: project.directory,
        python: [python], console: 'internalConsole', justMyCode: true,
        subProcess: false, redirectOutput: true, stopOnEntry: !!input.stopOnEntry, args,
      }, 30000);
      // Keep early launch failures observed while waiting for the initialized event.
      void launch.catch(() => {});
      await transport.waitFor('initialized', 15000);
      const applied = await transport.request('setBreakpoints', {
        source: { name: posix.basename(program), path: program },
        breakpoints: breakpoints.map((line) => ({ line })),
        lines: breakpoints,
      });
      session.breakpoints = (applied.breakpoints || []).map((item: any) => ({
        line: Number(item.line), verified: !!item.verified, message: item.message ? String(item.message) : undefined,
      }));
      await transport.request('setExceptionBreakpoints', { filters: [] });
      await transport.request('configurationDone');
      await launch;
      handshakeComplete = true;
      current();
      if (session.state === 'terminated') {
        await closeTerminated(); current();
        return this.snapshot(session, false);
      }
      if (session.state === 'starting') session.state = 'running';
      await owner.assertCurrent(); current(); await owner.assertNative(); current(); owner.detachRequest();
      const snapshot = await this.snapshot(session);
      current();
      return snapshot;
    } catch (error) {
      transport?.close();
      try { await owner?.close(); }
      catch (cleanupError) {
        const session = this.sessions.get(id);
        if (session) { session.state = 'error'; session.cleanupError = cleanupError; session.error = (cleanupError as Error).message; }
        throw cleanupError;
      }
      this.sessions.delete(id);
      throw error;
    }
  }
  /**
   * 入口 / Entry: DebugAdapter.refresh.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `void` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `session.transport.request`, `inline.slice().map`, `inline.slice`, `this.loadFrame` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.transport.request`, `inline.slice().map`, `inline.slice`, `this.loadFrame`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.state !== 'stopped' || session.cachedRevision === session.revision`; `!threadId`; `session.frames.length`.
   * 输入 / Inputs: session: Session
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `session.transport.request`; 更新 / updates `threadId`, `session.threadId`, `session.frames`, `session.variables`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async refresh(session: Session) {
    if (session.state !== 'stopped' || session.cachedRevision === session.revision) return;
    let threadId = session.threadId;
    if (!threadId) {
      const threads = await session.transport.request('threads');
      threadId = Number(threads.threads?.[0]?.id || 0);
    }
    if (!threadId) return;
    session.threadId = threadId;
    const stack = await session.transport.request('stackTrace', { threadId, startFrame: 0, levels: 30 });
    session.frames = (stack.stackFrames || []).slice(0, 30).map((item: any) => ({
      id: Number(item.id), name: String(item.name || '').slice(0, 200),
      path: String(item.source?.path || ''), line: Number(item.line || 0), column: Number(item.column || 0),
    }));
    session.variables = [];
    if (session.frames.length) await this.loadFrame(session, session.frames[0].id);
    session.cachedRevision = session.revision;
  }
  /**
   * 入口 / Entry: DebugAdapter.loadVariables.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(result.variables || []).slice(0, 50).map((item: any): Variable => ({ name: String(item.name || '').slice(0, 200), value: Str…` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `(result.variables || []).slice(0, 50).map((item: any): Variable => ({ name: String(item.name || '').slice(0, 200), value: Str…` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `session.transport.request`, `inline.slice().map`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.transport.request`, `inline.slice().map`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: session: Session; reference: number
   * 输出 / Returns: `(result.variables || []).slice(0, 50).map((item: any): Variable => ({ name: String(item.name || '').slice(0, 200), value: Str…`.
   * 副作用 / Effects: `session.transport.request`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async loadVariables(session: Session, reference: number) {
    const result = await session.transport.request('variables', { variablesReference: reference, start: 0, count: 50 });
    return (result.variables || []).slice(0, 50).map((item: any): Variable => ({
      name: String(item.name || '').slice(0, 200), value: String(item.value || '').slice(0, 500),
      type: String(item.type || '').slice(0, 100), variablesReference: Number(item.variablesReference || 0),
    }));
  }
  /**
   * 入口 / Entry: DebugAdapter.loadFrame.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `session.selectedFrame`, `session.variables`（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; the outcome is recorded in `session.selectedFrame`, `session.variables`. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `session.transport.request`, `inline.slice`, `variables.push`, `this.loadVariables` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.transport.request`, `inline.slice`, `variables.push`, `this.loadVariables`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!Number.isInteger(scope.variablesReference) || scope.variablesReference <= 0`.
   * 输入 / Inputs: session: Session; frameId: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `session.transport.request`; `variables.push`; 更新 / updates `session.selectedFrame`, `session.variables`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async loadFrame(session: Session, frameId: number) {
    const scopes = await session.transport.request('scopes', { frameId });
    const variables: Variable[] = [];
    for (const scope of (scopes.scopes || []).slice(0, 2)) {
      if (!Number.isInteger(scope.variablesReference) || scope.variablesReference <= 0) continue;
      variables.push(...await this.loadVariables(session, scope.variablesReference));
    }
    session.selectedFrame = frameId;
    session.variables = variables;
  }
  /**
   * 入口 / Entry: DebugAdapter.snapshot.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ active: !['terminated', 'error'].includes(session.state), token: session.id, state: session.state, path: session.program, d…` 供上层消费（`DebugAdapter`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DebugAdapter`; this entry produces `{ active: !['terminated', 'error'].includes(session.state), token: session.id, state: session.state, path: session.program, d…` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.refresh().catch`, `this.refresh`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.refresh().catch`, `this.refresh`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `refresh && session.state === 'stopped'`.
   * 输入 / Inputs: session: Session; refresh: default=true
   * 输出 / Returns: `{ active: !['terminated', 'error'].includes(session.state), token: session.id, state: session.state, path: session.program, d…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async snapshot(session: Session, refresh = true) {
    if (refresh && session.state === 'stopped') await this.refresh(session).catch((error) => { session.error = (error as Error).message; });
    return {
      active: !['terminated', 'error'].includes(session.state), token: session.id,
      state: session.state, path: session.program, directory: session.directory,
      reason: session.reason, threadId: session.threadId, selectedFrame: session.selectedFrame,
      output: session.output, breakpoints: session.breakpoints, frames: session.frames,
      variables: session.variables, error: session.error, startedAt: session.startedAt,
      needsReview: !!session.cleanupError,
    };
  }
  /**
   * 入口 / Entry: DebugAdapter.selected.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `session` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `session` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.sessions.get`, `this.workspaces.projects.current`, `this.workspaces.config`, `projectVersion` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.get`, `this.workspaces.projects.current`, `this.workspaces.config`, `projectVersion`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string
   * 输出 / Returns: `session`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!session || session.id !== token`; `current !== session.owner.capture.projectId || this.workspaces.projects.current(id) !== current || (project._workspace || 'de…`; 异常 / errors `new AppError('调试会话已结束或不属于此实例', 409)`; `new AppError('当前项目已切换或配置改变，请返回原项目或停止调试', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private async selected(id: string, token: string) {
    const session = this.sessions.get(id);
    if (!session || session.id !== token) throw new AppError('调试会话已结束或不属于此实例', 409);
    const current = this.workspaces.projects.current(id), project = await this.workspaces.config(id);
    if (current !== session.owner.capture.projectId || this.workspaces.projects.current(id) !== current ||
        (project._workspace || 'default') !== current || projectVersion(project) !== session.owner.capture.configSha256)
      throw new AppError('当前项目已切换或配置改变，请返回原项目或停止调试', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
    await session.owner.assertCurrent(); await session.owner.assertNative();
    return session;
  }
  /**
   * 入口 / Entry: DebugAdapter.command.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.snapshot(session)` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `this.snapshot(session)` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.selected`, `signal.throwIfAborted`, `session.transport.request`, `this.snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.selected`, `signal.throwIfAborted`, `session.transport.request`, `this.snapshot`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!session.threadId`.
   * 输入 / Inputs: id: string; token: string; action: 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause'; signal: AbortSignal optional
   * 输出 / Returns: `this.snapshot(session)`.
   * 副作用 / Effects: `session.transport.request`; 更新 / updates `session.threadId`, `session.state`, `session.frames`, `session.variables`.
   * 拒绝 / Refusals: 条件 / conditions `action === 'pause'`; `session.state !== 'running'`; `!session.threadId`; 异常 / errors `new AppError('程序未在运行', 409)`; `new AppError('尚未取得可暂停的调试线程', 409)`.
   */
  async command(id: string, token: string, action: 'continue' | 'next' | 'stepIn' | 'stepOut' | 'pause', signal?: AbortSignal) {
    const session = await this.selected(id, token);
    signal?.throwIfAborted();
    if (action === 'pause') {
      if (session.state !== 'running') throw new AppError('程序未在运行', 409);
      if (!session.threadId) {
        const threads = await session.transport.request('threads');
        session.threadId = Number(threads.threads?.[0]?.id || 0);
      }
      if (!session.threadId) throw new AppError('尚未取得可暂停的调试线程', 409);
      await session.transport.request('pause', { threadId: session.threadId });
    } else {
      if (session.state !== 'stopped') throw new AppError('程序尚未暂停', 409);
      await session.transport.request(action, { threadId: session.threadId, singleThread: true });
      session.state = 'running'; session.frames = []; session.variables = []; session.selectedFrame = 0;
    }
    return this.snapshot(session);
  }
  /**
   * 入口 / Entry: DebugAdapter.setBreakpoints.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.snapshot(session)` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `this.snapshot(session)` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.selected`, `lines`, `session.transport.request`, `posix.basename` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.selected`, `lines`, `session.transport.request`, `posix.basename`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string; input: number[]
   * 输出 / Returns: `this.snapshot(session)`.
   * 副作用 / Effects: `session.transport.request`; 更新 / updates `session.breakpoints`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async setBreakpoints(id: string, token: string, input: number[]) {
    const session = await this.selected(id, token);
    const breakpoints = lines(input);
    const result = await session.transport.request('setBreakpoints', {
      source: { name: posix.basename(session.program), path: session.program },
      breakpoints: breakpoints.map((line) => ({ line })), lines: breakpoints,
    });
    session.breakpoints = (result.breakpoints || []).map((item: any) => ({
      line: Number(item.line), verified: !!item.verified, message: item.message ? String(item.message) : undefined,
    }));
    return this.snapshot(session);
  }
  /**
   * 入口 / Entry: DebugAdapter.inspect.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.snapshot(session)` 供上层消费（`DebugAdapter`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `DebugAdapter`; this entry produces `this.snapshot(session)` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.selected`, `this.refresh`, `session.frames.some`, `this.loadFrame` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.selected`, `this.refresh`, `session.frames.some`, `this.loadFrame`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string; frameId: number
   * 输出 / Returns: `this.snapshot(session)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `session.state !== 'stopped'`; `!session.frames.some((frame) => frame.id === frameId)`; 异常 / errors `new AppError('程序尚未暂停', 409)`; `new AppError('调用栈帧已失效', 409)`.
   */
  async inspect(id: string, token: string, frameId: number) {
    const session = await this.selected(id, token);
    if (session.state !== 'stopped') throw new AppError('程序尚未暂停', 409);
    await this.refresh(session);
    if (!session.frames.some((frame) => frame.id === frameId)) throw new AppError('调用栈帧已失效', 409);
    await this.loadFrame(session, frameId);
    return this.snapshot(session);
  }
  /**
   * 入口 / Entry: DebugAdapter.expand.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ variables: await this.loadVariables(session, reference) }` 供上层消费（`DebugAdapter`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `DebugAdapter`; this entry produces `{ variables: await this.loadVariables(session, reference) }` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.selected`, `this.loadVariables` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.selected`, `this.loadVariables`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; token: string; reference: number
   * 输出 / Returns: `{ variables: await this.loadVariables(session, reference) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `session.state !== 'stopped' || !Number.isInteger(reference) || reference <= 0`; 异常 / errors `new AppError('变量引用已失效', 409)`.
   */
  async expand(id: string, token: string, reference: number) {
    const session = await this.selected(id, token);
    if (session.state !== 'stopped' || !Number.isInteger(reference) || reference <= 0)
      throw new AppError('变量引用已失效', 409);
    return { variables: await this.loadVariables(session, reference) };
  }
  /**
   * 入口 / Entry: DebugAdapter.stop.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ active: false, stopped: true, output: '' }` / `{ active: false, stopped: true, output: session.output }` 供上层消费（`DebugAdapter`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `DebugAdapter`; this entry produces `{ active: false, stopped: true, output: '' }` / `{ active: false, stopped: true, output: session.output }` for its caller. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `this.sessions.get`, `inline.find`, `this.streams.recordsAll`, `this.streams.stop` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.get`, `inline.find`, `this.streams.recordsAll`, `this.streams.stop`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!['terminated', 'error'].includes(session.state)`.
   * 输入 / Inputs: id: string; token: string
   * 输出 / Returns: `{ active: false, stopped: true, output: '' }`; `{ active: false, stopped: true, output: session.output }`.
   * 副作用 / Effects: `this.streams.stop`; `session.transport.request().catch`; `session.transport.request`; `session.transport.close`; `session.owner.close`; 更新 / updates `session.state`, `session.cleanupError`, `session.error`.
   * 拒绝 / Refusals: 条件 / conditions `!session || session.id !== token`; `!record`; 异常 / errors `new AppError('调试会话已结束', 409)`; `error`.
   * 失败处理：catch 分支执行 `session.state = 'error';`; `session.cleanupError = error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `session.state = 'error';`; `session.cleanupError = error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async stop(id: string, token: string) {
    const session = this.sessions.get(id);
    if (!session || session.id !== token) {
      const record = (await this.streams.recordsAll(id)).find(item => item.kind === 'dap' && item.runId === token);
      if (!record) throw new AppError('调试会话已结束', 409);
      await this.streams.stop(id, record.projectId, record.runId); return { active: false, stopped: true, output: '' };
    }
    if (!['terminated', 'error'].includes(session.state))
      await session.transport.request('disconnect', { terminateDebuggee: true }, 5000).catch(() => {});
    session.transport.close();
    try { await session.owner.close(); }
    catch (error) { session.state = 'error'; session.cleanupError = error; session.error = (error as Error).message; throw error; }
    this.sessions.delete(id);
    return { active: false, stopped: true, output: session.output };
  }
  /**
   * 入口 / Entry: DebugAdapter.close.
   * 功能：在管理项目 Python 调试适配器及断点、检查请求中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`DebugAdapter`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `DebugAdapter`; the calls and state transitions below complete the operation. Module context: Owns project Python debug adapters, breakpoints and inspection requests; stopping uses the original protocol-run ticket.
   * 处理：通过 `Promise.allSettled`, `inline.map`, `this.sessions.values`, `this.streams.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`, `inline.map`, `this.sessions.values`, `this.streams.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.streams.close`; `results.push`.
   * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `failure`.
   * 失败处理：catch 分支执行 `results.push({ status: 'rejected', reason: error });`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `results.push({ status: 'rejected', reason: error });`; these statements determine whether a failure is absorbed or rejected again.
   */
  async close() {
    const results = await Promise.allSettled([...this.sessions.values()].map(session => this.stop(session.vm, session.id)));
    try { await this.streams.close(); } catch (error) { results.push({ status: 'rejected', reason: error }); }
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) { const failure = new AggregateError(errors, '调试原完整运行域清理未确认', { cause: errors[0] });
      Object.assign(failure, { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' }); throw failure; }
  }
}

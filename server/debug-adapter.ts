import { posix } from 'node:path';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError, guestPath } from './model.ts';
import { quote } from './files.ts';
import { repositoryPath } from './git-workbench.ts';
import { DapTransport } from './dap-transport.ts';
import { ProjectProtocolStreams, type OwnedProjectProtocolStream } from './project-protocol-stream.ts';
import { projectDapPython, projectProtocolInstallScript, projectProtocolInstalledCommand } from './project-protocol-assets.ts';
import { guestTask } from './guest-task.ts';
import { projectVersion } from './workspaces.ts';

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
function projectFile(directory: string, input: string) {
  const path = guestPath(input);
  const relative = posix.relative(directory, path);
  if (relative === '.' || relative.startsWith('../') || posix.isAbsolute(relative))
    throw new AppError('调试文件必须位于当前项目目录', 400);
  if (!repositoryPath.safeParse(relative).success) throw new AppError('调试文件路径无效', 400);
  if (!path.endsWith('.py')) throw new AppError('当前 DAP 调试器支持 Python 文件');
  return path;
}
function lines(input: number[]) {
  if (!Array.isArray(input) || input.length > 100 || input.some((line) =>
    !Number.isInteger(line) || line < 1 || line > 100000)) throw new AppError('断点行号无效');
  return [...new Set(input)].sort((a, b) => a - b);
}

export class DebugAdapter {
  private sessions = new Map<string, Session>();
  private starting = new Set<string>();
  private streams: Pick<ProjectProtocolStreams, 'open' | 'recordsAll' | 'readonly' | 'stop' | 'close'>;
  constructor(private machines: Machines, private workspaces: Workspaces,
    private options: { streams?: DebugAdapter['streams']; adminTask?: typeof guestTask } = {}) {
    this.streams = options.streams || new ProjectProtocolStreams(machines, workspaces);
  }
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
  async install(id: string, signal?: AbortSignal) {
    const command = projectProtocolInstallScript('dap', this.machines.get(id).distro || 'alpine');
    const result = await (this.options.adminTask || guestTask)(this.machines, id, command,
      signal || new AbortController().signal, () => {}, 360000);
    if (result.code !== 0) throw new AppError(`Python 调试器安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    return { installed: true };
  }
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
  private async startSession(id: string, input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] },
    signal: AbortSignal | undefined, projectId: string, live: object) {
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
      const closeTerminated = () => session.owner.close().catch(error => {
        session.cleanupError = error; session.state = 'error'; session.error = (error as Error).message;
        throw error;
      });
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
  private async loadVariables(session: Session, reference: number) {
    const result = await session.transport.request('variables', { variablesReference: reference, start: 0, count: 50 });
    return (result.variables || []).slice(0, 50).map((item: any): Variable => ({
      name: String(item.name || '').slice(0, 200), value: String(item.value || '').slice(0, 500),
      type: String(item.type || '').slice(0, 100), variablesReference: Number(item.variablesReference || 0),
    }));
  }
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
  async inspect(id: string, token: string, frameId: number) {
    const session = await this.selected(id, token);
    if (session.state !== 'stopped') throw new AppError('程序尚未暂停', 409);
    await this.refresh(session);
    if (!session.frames.some((frame) => frame.id === frameId)) throw new AppError('调用栈帧已失效', 409);
    await this.loadFrame(session, frameId);
    return this.snapshot(session);
  }
  async expand(id: string, token: string, reference: number) {
    const session = await this.selected(id, token);
    if (session.state !== 'stopped' || !Number.isInteger(reference) || reference <= 0)
      throw new AppError('变量引用已失效', 409);
    return { variables: await this.loadVariables(session, reference) };
  }
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
  async close() {
    const results = await Promise.allSettled([...this.sessions.values()].map(session => this.stop(session.vm, session.id)));
    try { await this.streams.close(); } catch (error) { results.push({ status: 'rejected', reason: error }); }
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (errors.length) { const failure = new AggregateError(errors, '调试原完整运行域清理未确认', { cause: errors[0] });
      Object.assign(failure, { status: 503, code: 'PROJECT_IDENTITY_CLEANUP_FAILED' }); throw failure; }
  }
}

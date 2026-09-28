import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import type { Client } from 'ssh2';
import type { Duplex } from 'node:stream';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { AppError, guestPath } from './model.ts';
import { quote } from './files.ts';
import { repositoryPath } from './git-workbench.ts';
import { DapTransport } from './dap-transport.ts';

const python = '/opt/sakura-debugger/bin/python';
const maxOutput = 64 * 1024;
type Frame = { id: number; name: string; path: string; line: number; column: number };
type Variable = { name: string; value: string; type: string; variablesReference: number };
type Session = {
  id: string; vm: string; directory: string; program: string;
  client: Client; transport: DapTransport;
  state: 'starting' | 'running' | 'stopped' | 'terminated' | 'error';
  reason: string; threadId: number; output: string; breakpoints: { line: number; verified: boolean; message?: string }[];
  revision: number; cachedRevision: number; frames: Frame[]; variables: Variable[]; error: string;
  selectedFrame: number;
  startedAt: string;
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
  private installed = new Map<string, { value: boolean; until: number }>();
  constructor(private machines: Machines, private workspaces: Workspaces) {}
  async status(id: string, signal?: AbortSignal) {
    const session = this.sessions.get(id);
    if (session) return { installed: true, ...await this.snapshot(session) };
    const cached = this.installed.get(id);
    if (cached && cached.until > Date.now()) return { installed: cached.value, active: false };
    const result = await this.machines.exec(id,
      `test -x ${quote(python)} && ${quote(python)} -c 'import debugpy; assert debugpy.__version__ == "1.8.16"'`, 10000, signal);
    const value = result.code === 0;
    this.installed.set(id, { value, until: Date.now() + 30000 });
    return { installed: value, active: false };
  }
  async install(id: string, signal?: AbortSignal) {
    const distro = this.machines.get(id).distro;
    const packages = !distro || distro === 'alpine'
      ? 'apk add --no-cache --timeout 30 python3 py3-pip'
      : 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y python3 python3-venv';
    const command = `set -eu; if ! command -v python3 >/dev/null; then for attempt in 1 2 3; do if (${packages}); then break; fi; sleep 2; done; fi; command -v python3 >/dev/null; if ! test -x ${quote(python)}; then if ! python3 -m venv /opt/sakura-debugger; then for attempt in 1 2 3; do if (${packages}); then break; fi; sleep 2; done; python3 -m venv /opt/sakura-debugger; fi; fi; for attempt in 1 2 3; do if /opt/sakura-debugger/bin/pip install --disable-pip-version-check debugpy==1.8.16; then break; fi; sleep 2; done; ${quote(python)} -c 'import debugpy; assert debugpy.__version__ == "1.8.16"'`;
    const result = await this.machines.exec(id, command, 360000, signal);
    if (result.code !== 0) throw new AppError(`Python 调试器安装失败：${(result.stderr || result.stdout).slice(-2000)}`, 502);
    this.installed.set(id, { value: true, until: Date.now() + 60000 });
    return { installed: true };
  }
  async start(id: string, input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] }, signal?: AbortSignal) {
    if (this.starting.has(id)) throw new AppError('调试会话正在启动', 409);
    this.starting.add(id);
    try {
      return await this.startSession(id, input, signal);
    } finally {
      this.starting.delete(id);
    }
  }
  private async startSession(id: string, input: { path: string; breakpoints: number[]; stopOnEntry?: boolean; args?: string[] }, signal?: AbortSignal) {
    const project = await this.workspaces.config(id);
    const program = projectFile(project.directory, input.path);
    const breakpoints = lines(input.breakpoints);
    const args = input.args || [];
    if (args.length > 20 || args.some((item) => typeof item !== 'string' || item.length > 1024 || /[\x00-\x1f]/.test(item)))
      throw new AppError('调试参数无效');
    const existing = this.sessions.get(id);
    if (existing && !['terminated', 'error'].includes(existing.state)) throw new AppError('当前实例已有调试会话，请先停止', 409);
    if (this.sessions.size >= 4 && !existing) throw new AppError('同时最多运行四个调试会话', 409);
    if (existing) await this.stop(id, existing.id).catch(() => {});
    const checked = await this.machines.exec(id,
      `test -f ${quote(program)} && test -x ${quote(python)} && ${quote(python)} -c 'import debugpy; assert debugpy.__version__ == "1.8.16"'`, 10000, signal);
    if (checked.code !== 0) throw new AppError('请先保存 Python 文件并安装调试器', 409);
    const client = await this.machines.connect(id, 10000, signal);
    const abort = () => client.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    let transport: DapTransport | undefined;
    try {
      const stream = await new Promise<Duplex>((resolve, reject) => client.exec(
        `exec ${quote(python)} -m debugpy.adapter`, (error, channel) => error ? reject(error) : resolve(channel)));
      transport = new DapTransport(stream);
      const session: Session = {
        id: randomUUID(), vm: id, directory: project.directory, program, client, transport,
        state: 'starting', reason: '', threadId: 0, output: '', breakpoints: [], revision: 0,
        cachedRevision: -1, frames: [], variables: [], selectedFrame: 0,
        error: '', startedAt: new Date().toISOString(),
      };
      this.sessions.set(id, session);
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
        }
      });
      client.once('close', () => {
        if (session.state !== 'terminated') {
          session.state = 'error'; session.error ||= '调试适配器连接已关闭';
        }
        transport?.close();
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
      if (session.state === 'starting') session.state = 'running';
      signal?.removeEventListener('abort', abort);
      return this.snapshot(session);
    } catch (error) {
      signal?.removeEventListener('abort', abort);
      transport?.close();
      client.destroy();
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
  private async snapshot(session: Session) {
    if (session.state === 'stopped') await this.refresh(session).catch((error) => { session.error = (error as Error).message; });
    return {
      active: !['terminated', 'error'].includes(session.state), token: session.id,
      state: session.state, path: session.program, directory: session.directory,
      reason: session.reason, threadId: session.threadId, selectedFrame: session.selectedFrame,
      output: session.output, breakpoints: session.breakpoints, frames: session.frames,
      variables: session.variables, error: session.error, startedAt: session.startedAt,
    };
  }
  private async selected(id: string, token: string) {
    const session = this.sessions.get(id);
    if (!session || session.id !== token) throw new AppError('调试会话已结束或不属于此实例', 409);
    if ((await this.workspaces.config(id)).directory !== session.directory)
      throw new AppError('当前项目已切换，请返回原项目或停止调试', 409);
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
    if (!session || session.id !== token) throw new AppError('调试会话已结束', 409);
    this.sessions.delete(id);
    if (!['terminated', 'error'].includes(session.state))
      await session.transport.request('disconnect', { terminateDebuggee: true }, 5000).catch(() => {});
    session.transport.close();
    session.client.end();
    return { active: false, stopped: true, output: session.output };
  }
  async close() {
    await Promise.allSettled([...this.sessions.values()].map((session) => this.stop(session.vm, session.id)));
    this.sessions.clear();
  }
}

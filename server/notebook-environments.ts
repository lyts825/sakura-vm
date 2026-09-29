import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project, Workspaces } from './workspaces.ts';
import { provisionScript } from './workspaces.ts';
import { AppError, DATA } from './model.ts';
import { quote } from './files.ts';
import { guestTask } from './guest-task.ts';
import { readStore, writeStore } from './local-store.ts';
import { ensureProjectNetworkScript, projectNetworkCommand } from './project-network-isolation.ts';
import { ProjectNetworkBridges } from './project-network-bridges.ts';

export const notebookInput = z.object({
  mode: z.enum(['status', 'install', 'start', 'stop']).default('status'),
  provider: z.enum(['jupyter', 'marimo']).default('jupyter'),
  guestPort: z.number().int().min(1024).max(65535).default(8888),
  hostPort: z.number().int().min(1024).max(65535).default(8888),
}).strict();
type Input = z.infer<typeof notebookInput>;
type Provider = Input['provider'];

const sessionSchema = z.object({
  vmId: z.uuid(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  provider: z.enum(['jupyter', 'marimo']), directory: z.string().min(1).max(4096),
  guestPort: z.number().int().min(1024).max(65535),
  hostPort: z.number().int().min(1024).max(65535),
  token: z.string().regex(/^[a-f0-9]{64}$/), createdForward: z.boolean(),
  networkIsolation: z.enum(['host', 'private']).default('host'),
  status: z.enum(['starting', 'running', 'review']), startedAt: z.iso.datetime(),
}).strict().refine((session) => session.networkIsolation !== 'private' || !session.createdForward,
  { message: 'Private Notebook sessions cannot own QEMU forwards' });
type Session = z.infer<typeof sessionSchema>;
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(sessionSchema).max(128) }).strict();

const sessionName = (projectId: string) => `sakura-notebook-${projectId}`;
const sessionLog = (projectId: string) => `/tmp/${sessionName(projectId)}.log`;
const environment = (directory: string, provider: Provider) =>
  `${directory.replace(/\/$/, '')}/.sakura/notebooks/${provider}/venv`;
const executable = (directory: string, provider: Provider) =>
  `${environment(directory, provider)}/bin/${provider === 'jupyter' ? 'jupyter' : 'marimo'}`;

async function httpReady(session: Session) {
  const url = `http://127.0.0.1:${session.hostPort}${session.provider === 'jupyter'
    ? '/api/status' : '/health'}`;
  const authorization = session.provider === 'jupyter'
    ? `token ${session.token}`
    : `Basic ${Buffer.from(':' + session.token).toString('base64')}`;
  try {
    const response = await fetch(url, { headers: { authorization },
      redirect: 'manual', signal: AbortSignal.timeout(2500) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

export class NotebookEnvironments {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  private controls = new Map<string, Promise<unknown>>();
  private bridges: ProjectNetworkBridges;
  private closed = false;
  constructor(private machines: Machines, private workspaces: Workspaces,
    private file = join(DATA, 'notebook-environments.json'),
    private probeHttp: (session: Session) => Promise<boolean> = httpReady) {
    this.bridges = new ProjectNetworkBridges(machines);
  }

  async init() {
    this.state = storeSchema.parse(await readStore(this.file, () => ({ version: 1, sessions: [] })));
    if (this.state.sessions.some((item) => item.status === 'starting'))
      await this.change((state) => {
        for (const item of state.sessions) if (item.status === 'starting') item.status = 'review';
      });
  }

  private async change<T>(edit: (state: z.infer<typeof storeSchema>) => T) {
    const operation = this.writes.catch(() => {}).then(async () => {
      const next = structuredClone(this.state!);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
    this.writes = operation;
    return operation;
  }

  private context(id: string) {
    const vm = this.machines.get(id);
    const projectId = this.workspaces.projects.current(id);
    const session = this.state!.sessions.find((item) =>
      item.vmId === id && item.projectId === projectId);
    return { vm, projectId, session };
  }

  private async alive(id: string, projectId: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id,
      `tmux has-session -t =${sessionName(projectId)} 2>/dev/null`, 5000, signal);
    return result.code === 0;
  }

  private async installed(id: string, directory: string, provider: Provider,
    signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id,
      `test -x ${quote(executable(directory, provider))}`, 5000, signal);
    return result.code === 0;
  }

  async view(id: string, input: unknown = {}, signal?: AbortSignal) {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const options = notebookInput.parse(input);
    const { projectId, session } = this.context(id);
    const project = await this.workspaces.config(id);
    const running = this.machines.state(id) === 'running';
    const [installed, alive] = running ? await Promise.all([
      this.installed(id, project.directory, options.provider, signal),
      session ? this.alive(id, projectId, signal) : Promise.resolve(false),
    ]) : [false, false];
    let reachable = false;
    if (alive && session && this.matchesProject(session, project)) {
      try { await this.restoreBridge(session, project, signal); reachable = await this.probeHttp(session); }
      catch { signal?.throwIfAborted(); }
    }
    return { ready: running, executed: false, installed,
      session: session ? { provider: session.provider, directory: session.directory,
        guestPort: session.guestPort, hostPort: session.hostPort,
        status: !alive ? 'stopped' : reachable ? 'running' : 'unhealthy',
        startedAt: session.startedAt, needsReview: session.status === 'review' } : null,
      projectId,
      message: !running ? '请先启动实例。' : project.networkIsolation === 'private'
        ? 'Notebook 在私有项目网络中运行，通过本机回环桥接访问。'
        : '可安装、启动或停止当前项目的 Notebook 会话。' };
  }

  private matchesProject(session: Session, project: Project) {
    return session.directory === project.directory &&
      session.networkIsolation === (project.networkIsolation || 'host');
  }

  private async control<T>(session: Session, work: () => Promise<T>) {
    const key = `${session.vmId}:${session.projectId}`;
    const pending = (this.controls.get(key) || Promise.resolve()).catch(() => {}).then(work);
    this.controls.set(key, pending);
    try { return await pending; }
    finally { if (this.controls.get(key) === pending) this.controls.delete(key); }
  }

  private restoreBridge(session: Session, project: Project, signal?: AbortSignal) {
    return this.control(session, async () => {
      if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
      if (!this.matchesProject(session, project))
        throw new AppError('项目网络或目录已变更，请先停止 Notebook 会话', 409);
      if (!this.state!.sessions.some((item) => item.vmId === session.vmId &&
          item.projectId === session.projectId && item.token === session.token))
        throw new AppError('Notebook 会话已停止', 409);
      if (session.networkIsolation === 'private')
        await this.bridges.open(session.vmId, project, session.guestPort, session.hostPort, signal);
    });
  }

  private async preparePrivate(id: string, project: Project, signal: AbortSignal) {
    const vm = this.machines.get(id);
    // Provision system tools outside the namespace without any project paths
    // or Python import settings. Project Python only runs after entering it.
    const script = `set -eu\ncd /\nif ! command -v python3 >/dev/null || ! command -v tmux >/dev/null || ! python3 -I -m venv --help >/dev/null 2>&1 || ! python3 -I -m pip --version >/dev/null 2>&1 || ! python3 -I -S -c 'import ensurepip' >/dev/null 2>&1; then\n${provisionScript('python', vm.distro)}\nfi\n${ensureProjectNetworkScript(project, vm.distro || 'alpine')}`;
    const result = await guestTask(this.machines, id, script, signal);
    if (result.code !== 0) throw new AppError(result.stderr || 'Notebook 私有网络准备失败');
  }

  private async install(id: string, project: Project, provider: Provider,
    signal: AbortSignal, log: (line: string) => void) {
    const directory = project.directory;
    if (project.networkIsolation === 'private') await this.preparePrivate(id, project, signal);
    if (await this.installed(id, directory, provider, signal)) return;
    signal.throwIfAborted();
    const vm = this.machines.get(id);
    const venv = environment(directory, provider);
    const packageName = provider === 'jupyter' ? 'jupyterlab' : 'marimo';
    log(`正在安装 ${packageName} 到当前项目的独立 Python 环境…\n`);
    let script: string;
    if (project.networkIsolation === 'private') {
      const cache = `/var/cache/sakura/notebook-wheels-${randomBytes(16).toString('hex')}`;
      const offline = `set -eu\nmkdir -p ${quote(directory)}\npython3 -I -m venv ${quote(venv)}\n${quote(venv + '/bin/python')} -I -m pip --isolated install --disable-pip-version-check --no-input --no-index --only-binary=:all: --find-links=${quote(cache)} ${packageName}\ntest -x ${quote(executable(directory, provider))}`;
      script = `set -eu\ncd /\numask 077\nmkdir -p /var/cache/sakura\nmkdir ${quote(cache)}\ntrap ${quote(`rm -rf -- ${quote(cache)}`)} EXIT HUP INT TERM\npython3 -I -m pip --isolated download --disable-pip-version-check --no-input --no-cache-dir --only-binary=:all: --dest ${quote(cache)} ${packageName}\n${projectNetworkCommand(project, offline)}`;
    } else {
      script = `set -eu\nif ! command -v python3 >/dev/null || ! command -v tmux >/dev/null || ! python3 -m venv --help >/dev/null 2>&1; then\n${provisionScript('python', vm.distro)}\nfi\nmkdir -p ${quote(directory)}\nif ! python3 -m venv ${quote(venv)}; then\n${provisionScript('python', vm.distro)}\npython3 -m venv ${quote(venv)}\nfi\n${quote(venv + '/bin/python')} -m pip install --disable-pip-version-check --no-input ${packageName}\ntest -x ${quote(executable(directory, provider))}`;
    }
    const result = await guestTask(this.machines, id, script, signal, undefined, 20 * 60_000);
    if (result.code !== 0) throw new AppError(`Notebook 安装失败：${result.stderr.slice(-1000) || result.code}`);
    log(`${packageName} 已安装。\n`);
  }

  private async removeForward(id: string, session: Session) {
    if (!session.createdForward) return;
    const forwards = this.machines.get(id).forwards;
    const owns = (item: typeof forwards[number]) => item.host === session.hostPort &&
      item.guest === session.guestPort && item.name === `notebook-${session.provider}`;
    if (!forwards.some(owns))
      return;
    await this.machines.setForwards(id, forwards.filter((item) => !owns(item)), forwards);
  }

  private stop(id: string, session: Session, signal: AbortSignal) {
    return this.control(session, () => this.stopSession(id, session, signal));
  }

  private async stopSession(id: string, session: Session, signal: AbortSignal) {
    if (this.machines.state(id) === 'paused')
      throw new AppError('请先恢复实例，再停止 Notebook 会话', 409);
    if (this.machines.state(id) === 'running') {
      const result = await this.machines.exec(id,
        `if tmux has-session -t =${sessionName(session.projectId)} 2>/dev/null; then tmux kill-session -t =${sessionName(session.projectId)}; fi`,
        10000, signal);
      if (result.code !== 0) throw new AppError('无法停止 Notebook 会话');
    }
    await this.bridges.stop(id, session.projectId);
    await this.removeForward(id, session);
    await this.change((state) => {
      state.sessions = state.sessions.filter((item) =>
        !(item.vmId === id && item.projectId === session.projectId));
    });
  }

  private launchCommand(session: Session) {
    const binary = executable(session.directory, session.provider);
    const port = session.guestPort;
    const address = session.networkIsolation === 'private' ? '127.0.0.1' : '0.0.0.0';
    if (session.provider === 'jupyter')
      return `export JUPYTER_TOKEN=${quote(session.token)}\nexec ${quote(binary)} lab --no-browser --allow-root --ip=${address} --port=${port} --ServerApp.port_retries=0 --ServerApp.root_dir=${quote(session.directory)} --ServerApp.log_level=ERROR`;
    return `exec ${quote(binary)} edit --headless --host ${address} --port ${port} --token --token-password ${quote(session.token)}`;
  }

  private async start(id: string, options: Input, signal: AbortSignal,
    log: (line: string) => void) {
    const { projectId, session: prior } = this.context(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    const project = await this.workspaces.config(id);
    if (prior && await this.alive(id, projectId, signal)) {
      if (prior.provider !== options.provider || !this.matchesProject(prior, project) ||
          prior.hostPort !== options.hostPort || prior.guestPort !== options.guestPort)
        throw new AppError('请先停止当前 Notebook 会话，再修改参数', 409);
      await this.restoreBridge(prior, project, signal);
      if (!await this.probeHttp(prior)) throw new AppError('Notebook 进程仍在运行但入口不可达', 409);
      return { ready: true, executed: true, session: {
        provider: prior.provider, status: 'running', hostPort: prior.hostPort,
        guestPort: prior.guestPort }, message: 'Notebook 会话已经运行。' };
    }
    if (prior) await this.stop(id, prior, signal);
    await this.install(id, project, options.provider, signal, log);
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    signal.throwIfAborted();
    const before = this.machines.get(id).forwards;
    const networkIsolation = project.networkIsolation || 'host';
    const existing = before.find((item) => item.host === options.hostPort);
    if (existing && (networkIsolation === 'private' || existing.guest !== options.guestPort))
      throw new AppError('所选本机端口已映射到其他客户机端口', 409);
    const createdForward = networkIsolation === 'host' && !existing;
    if (createdForward) await this.machines.setForwards(id,
      [...before, { name: `notebook-${options.provider}`, host: options.hostPort,
        guest: options.guestPort }], before);
    const session: Session = { vmId: id, projectId, provider: options.provider,
      directory: project.directory, guestPort: options.guestPort,
      hostPort: options.hostPort, token: randomBytes(32).toString('hex'),
      createdForward, networkIsolation, status: 'starting', startedAt: new Date().toISOString() };
    try {
      await this.change((state) => {
        if (state.sessions.length >= 128) throw new AppError('Notebook 会话记录已达到上限', 409);
        state.sessions.push(session);
      });
      await this.restoreBridge(session, project, signal);
      const script = `${this.launchCommand(session)} > ${quote(sessionLog(projectId))} 2>&1`;
      const result = await this.machines.exec(id,
        `tmux new-session -d -s ${sessionName(projectId)} -c ${quote(project.directory)} ${quote(projectNetworkCommand(project, script))}`,
        10000, signal);
      if (result.code !== 0) throw new AppError(result.stderr || '无法启动 Notebook 会话');
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (!await this.alive(id, projectId, signal))
          throw new AppError('Notebook 进程已退出，请检查客户机日志');
        if (await this.probeHttp(session)) {
          await this.change((state) => {
            const item = state.sessions.find((row) => row.vmId === id && row.projectId === projectId)!;
            item.status = 'running';
          });
          log('Notebook 已在本机回环端口就绪。\n');
          return { ready: true, executed: true, session: {
            provider: session.provider, status: 'running', hostPort: session.hostPort,
            guestPort: session.guestPort }, message: 'Notebook 已启动；使用下方按钮获取访问链接。' };
        }
        await delay(500, undefined, { signal });
      }
      throw new AppError('Notebook 就绪检查超时');
    } catch (error) {
      await this.stop(id, session, new AbortController().signal).catch(() => {});
      throw error;
    }
  }

  async run(id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const options = notebookInput.parse(input);
    const { projectId } = this.context(id);
    const key = `${id}:${projectId}`;
    if (this.active.has(key)) throw new AppError('此项目的 Notebook 操作仍在进行', 409);
    this.active.add(key);
    try {
      signal.throwIfAborted();
      if (options.mode === 'status') return await this.view(id, options, signal);
      if (options.mode === 'start') return await this.start(id, options, signal, log);
      if (options.mode === 'install') {
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
        const project = await this.workspaces.config(id);
        await this.install(id, project, options.provider, signal, log);
        return { ready: true, executed: true, installed: true,
          provider: options.provider, message: 'Notebook 环境已安装；现在可启动会话。' };
      }
      const session = this.context(id).session;
      if (session) await this.stop(id, session, signal);
      return { ready: true, executed: true, session: null, message: 'Notebook 会话已停止。' };
    } finally { this.active.delete(key); }
  }

  async link(id: string) {
    if (this.closed) throw new AppError('Notebook 服务已关闭', 409);
    const { projectId, session } = this.context(id);
    if (!session || !await this.alive(id, projectId))
      throw new AppError('Notebook 会话尚未就绪', 409);
    await this.restoreBridge(session, await this.workspaces.config(id));
    if (!await this.probeHttp(session))
      throw new AppError('Notebook 会话尚未就绪', 409);
    const base = `http://127.0.0.1:${session.hostPort}/`;
    return { provider: session.provider,
      url: session.provider === 'jupyter'
        ? `${base}lab?token=${session.token}`
        : `${base}?access_token=${session.token}` };
  }

  async close() {
    this.closed = true;
    await this.bridges.close();
    await Promise.allSettled(this.controls.values());
    await this.writes;
  }
}

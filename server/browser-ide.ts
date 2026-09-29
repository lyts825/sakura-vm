import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Project, Workspaces } from './workspaces.ts';
import { AppError, DATA } from './model.ts';
import { quote } from './files.ts';
import { guestTask } from './guest-task.ts';
import { readStore, writeStore } from './local-store.ts';
import { ensureProjectNetworkScript, projectNetworkCommand } from './project-network-isolation.ts';
import { ProjectNetworkBridges } from './project-network-bridges.ts';

export const browserIdeInput = z.object({
  mode: z.enum(['status', 'install', 'start', 'stop']).default('status'),
  guestPort: z.number().int().min(1024).max(65535).default(8080),
  hostPort: z.number().int().min(1024).max(65535).default(8080),
  ttlMinutes: z.number().int().min(1).max(240).default(60),
}).strict();
type Input = z.infer<typeof browserIdeInput>;

// The pinned archive is a self-contained Linux amd64 build. Check the release
// digest before any archive contents become executable in the guest.
const VERSION = '4.132.0';
const SHA256 = 'a38d26f4cb81f768feddff79e2937fd3f39c83d3da8be3da7225e1087e62e4ed';
const archive = `code-server-${VERSION}-linux-amd64`;
const installRoot = '/opt/sakura/browser-ide';
const binary = `${installRoot}/${VERSION}/bin/code-server`;
const releaseUrl = `https://github.com/coder/code-server/releases/download/v${VERSION}/${archive}.tar.gz`;
const assetUrl = 'https://api.github.com/repos/coder/code-server/releases/assets/509052857?download=1';
const packageCache = '/var/cache/sakura/browser-ide';
export const browserIdePackage = { version: VERSION, fileName: `${archive}.tar.gz`,
  sha256: SHA256, url: releaseUrl, assetUrl, cachePath: `${packageCache}/${archive}.tar.gz` } as const;

const sessionSchema = z.object({
  vmId: z.uuid(), projectId: z.string().regex(/^(default|[a-f0-9]{16})$/),
  directory: z.string().min(1).max(4096),
  guestPort: z.number().int().min(1024).max(65535),
  hostPort: z.number().int().min(1024).max(65535),
  password: z.string().regex(/^[a-f0-9]{64}$/),
  createdForward: z.boolean(), status: z.enum(['starting', 'running', 'review']),
  networkIsolation: z.enum(['host', 'private']).default('host'),
  startedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
}).strict().refine((session) => session.networkIsolation !== 'private' || !session.createdForward,
  { message: 'Private IDE sessions cannot own QEMU forwards' });
type Session = z.infer<typeof sessionSchema>;
const storeSchema = z.object({ version: z.literal(1), sessions: z.array(sessionSchema).max(128) }).strict();
const sessionName = (projectId: string) => `sakura-browser-ide-${projectId}`;
const sessionLog = (projectId: string) => `/tmp/${sessionName(projectId)}.log`;
const keyOf = (session: Session) => `${session.vmId}:${session.projectId}`;

async function httpReady(session: Session) {
  try {
    const response = await fetch(`http://127.0.0.1:${session.hostPort}/healthz`,
      { redirect: 'manual', signal: AbortSignal.timeout(2500) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

export class BrowserIde {
  private state?: z.infer<typeof storeSchema>;
  private writes: Promise<unknown> = Promise.resolve();
  private active = new Set<string>();
  private controls = new Map<string, Promise<unknown>>();
  private installs = new Map<string, Promise<void>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private bridges: ProjectNetworkBridges;
  private closed = false;
  constructor(private machines: Machines, private workspaces: Workspaces,
    private file = join(DATA, 'browser-ide.json'),
    private probeHttp: (session: Session) => Promise<boolean> = httpReady) {
    this.bridges = new ProjectNetworkBridges(machines);
  }

  async init() {
    this.state = storeSchema.parse(await readStore(this.file, () => ({ version: 1, sessions: [] })));
    const missing = new Set<string>();
    for (const session of this.state.sessions) {
      try { this.machines.get(session.vmId); }
      catch (error) {
        if (!(error instanceof AppError) || error.status !== 404) throw error;
        missing.add(session.vmId);
      }
    }
    if (missing.size || this.state.sessions.some((item) => item.status === 'starting'))
      await this.change((state) => {
        state.sessions = state.sessions.filter((item) => !missing.has(item.vmId));
        for (const item of state.sessions) if (item.status === 'starting') item.status = 'review';
      });
    for (const session of this.state.sessions) this.schedule(session);
  }

  async close() {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await this.bridges.close();
    await Promise.allSettled(this.controls.values());
    await this.writes;
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

  private schedule(session: Session, retryMs?: number) {
    if (this.closed) return;
    const key = keyOf(session);
    const previous = this.timers.get(key);
    if (previous) clearTimeout(previous);
    const wait = retryMs ?? Math.max(0, Date.parse(session.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.expire(session);
    }, wait);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private async expire(session: Session) {
    if (this.closed) return;
    const key = keyOf(session);
    const current = this.state?.sessions.find((item) => keyOf(item) === key);
    if (!current || current.startedAt !== session.startedAt) return;
    if (Date.now() < Date.parse(current.expiresAt)) { this.schedule(current); return; }
    if (this.active.has(key)) { this.schedule(current, 5000); return; }
    this.active.add(key);
    try {
      await this.stop(current.vmId, current, new AbortController().signal);
    } catch (error) {
      if (error instanceof AppError && error.status === 404)
        await this.change((state) => {
          state.sessions = state.sessions.filter((item) => keyOf(item) !== key);
        });
      else this.schedule(current, 1000);
    } finally { this.active.delete(key); }
  }

  private async alive(id: string, projectId: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id,
      `tmux has-session -t =${sessionName(projectId)} 2>/dev/null`, 5000, signal);
    return result.code === 0;
  }

  private async installed(id: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') return false;
    const result = await this.machines.exec(id, `test -x ${quote(binary)}`, 5000, signal);
    return result.code === 0;
  }

  async view(id: string, input: unknown = {}, signal?: AbortSignal) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    browserIdeInput.parse(input);
    const { vm, projectId, session } = this.context(id);
    const project = await this.workspaces.config(id);
    const isolated = project.networkIsolation === 'private';
    const supported = vm.distro === 'debian' || vm.distro === 'ubuntu';
    const running = this.machines.state(id) === 'running';
    const expired = !!session && Date.now() >= Date.parse(session.expiresAt);
    const [installed, alive] = running ? await Promise.all([
      this.installed(id, signal),
      session && !expired ? this.alive(id, projectId, signal) : Promise.resolve(false),
    ]) : [false, false];
    let reachable = false;
    if (alive && session && this.matchesProject(session, project)) {
      try { await this.restoreBridge(session, project, signal); reachable = await this.probeHttp(session); }
      catch { signal?.throwIfAborted(); }
    }
    if (expired && session) await this.bridges.stop(id, session.projectId);
    return { ready: supported && running, executed: false, supported, installed,
      session: session ? { directory: session.directory, hostPort: session.hostPort,
        guestPort: session.guestPort, startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        status: expired ? 'expired' : !alive ? 'stopped' : reachable ? 'running' : 'unhealthy',
        needsReview: session.status === 'review' } : null,
      projectId,
      message: !supported ? '浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机。'
        : !running ? '请先启动实例。'
          : isolated ? '浏览器 IDE 在私有项目网络中运行，通过本机回环桥接访问。'
          : '可为当前项目安装、启动或停止带密码的浏览器 IDE。' };
  }

  private matchesProject(session: Session, project: Project) {
    return session.directory === project.directory &&
      session.networkIsolation === (project.networkIsolation || 'host');
  }

  private async control<T>(session: Session, work: () => Promise<T>) {
    const key = keyOf(session);
    const pending = (this.controls.get(key) || Promise.resolve()).catch(() => {}).then(work);
    this.controls.set(key, pending);
    try { return await pending; }
    finally { if (this.controls.get(key) === pending) this.controls.delete(key); }
  }

  private restoreBridge(session: Session, project: Project, signal?: AbortSignal) {
    return this.control(session, async () => {
      if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
      if (!this.matchesProject(session, project))
        throw new AppError('项目网络或目录已变更，请先停止浏览器 IDE 会话', 409);
      if (!this.state!.sessions.some((item) => keyOf(item) === keyOf(session) &&
          item.password === session.password && Date.now() < Date.parse(item.expiresAt)))
        throw new AppError('浏览器 IDE 会话已停止或过期', 409);
      if (session.networkIsolation === 'private')
        await this.bridges.open(session.vmId, project, session.guestPort, session.hostPort, signal);
    });
  }

  private async preparePrivate(id: string, project: Project, signal: AbortSignal) {
    const script = `set -eu\ncd /\nif ! command -v python3 >/dev/null || ! command -v tmux >/dev/null; then\nexport DEBIAN_FRONTEND=noninteractive\napt-get -o Acquire::Retries=2 update\napt-get -o Acquire::Retries=2 install -y python3 tmux\nfi\n${ensureProjectNetworkScript(project, this.machines.get(id).distro || 'debian')}\n${projectNetworkCommand(project, `mkdir -p ${quote(project.directory)}`)}`;
    const result = await guestTask(this.machines, id, script, signal);
    if (result.code !== 0) throw new AppError(result.stderr || '浏览器 IDE 私有网络准备失败');
  }

  private async install(id: string, signal: AbortSignal, log: (line: string) => void) {
    if (await this.installed(id, signal)) return;
    const existing = this.installs.get(id);
    if (existing) { await existing; return; }
    const promise = (async () => {
      const vm = this.machines.get(id);
      if (vm.distro !== 'debian' && vm.distro !== 'ubuntu')
        throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
      log(`正在准备并校验 code-server ${VERSION}；缺少缓存时下载约 239 MB…\n`);
      const cacheTemp = browserIdePackage.cachePath + '.' + randomBytes(16).toString('hex') + '.tmp';
      const script = `set -eu
cd /
if ! command -v curl >/dev/null || ! command -v tmux >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o Acquire::Retries=2 update
  apt-get -o Acquire::Retries=2 install -y curl ca-certificates tmux
fi
if test -x ${quote(binary)}; then exit 0; fi
mkdir -p ${quote(installRoot)}
sakura_stage=$(mktemp -d ${quote(installRoot + '/.install.XXXXXX')})
trap ${quote(`rm -rf "$sakura_stage"; rm -f -- ${quote(cacheTemp)}`)} EXIT HUP INT TERM
if test -f ${quote(browserIdePackage.cachePath)}; then
  cp -- ${quote(browserIdePackage.cachePath)} "$sakura_stage/release.tgz"
else
  if ! curl -fL --retry 3 --retry-all-errors --retry-max-time 1800 --connect-timeout 20 --max-time 1800 -o "$sakura_stage/release.tgz" ${quote(releaseUrl)}; then
    curl -fL --retry 3 --retry-all-errors --retry-max-time 1800 --connect-timeout 20 --max-time 1800 -H 'Accept: application/octet-stream' -H 'X-GitHub-Api-Version: 2026-03-10' -o "$sakura_stage/release.tgz" ${quote(assetUrl)}
  fi
fi
printf '%s  %s\\n' ${quote(SHA256)} "$sakura_stage/release.tgz" | sha256sum -c -
if ! test -f ${quote(browserIdePackage.cachePath)}; then
  mkdir -p ${quote(packageCache)}
  cp -- "$sakura_stage/release.tgz" ${quote(cacheTemp)}
  mv -- ${quote(cacheTemp)} ${quote(browserIdePackage.cachePath)}
fi
tar -xzf "$sakura_stage/release.tgz" -C "$sakura_stage"
mv "$sakura_stage/${archive}" ${quote(installRoot + '/' + VERSION)}
test -x ${quote(binary)}`;
      const result = await guestTask(this.machines, id, script, signal, undefined, 35 * 60_000);
      if (result.code !== 0)
        throw new AppError(`浏览器 IDE 安装失败：${result.stderr.slice(-1000) || result.code}`);
      log('code-server 已安装并通过校验。\n');
    })();
    this.installs.set(id, promise);
    try { await promise; } finally { this.installs.delete(id); }
  }

  private async removeForward(id: string, session: Session) {
    if (!session.createdForward) return;
    const forwards = this.machines.get(id).forwards;
    const owns = (item: typeof forwards[number]) => item.host === session.hostPort &&
      item.guest === session.guestPort && item.name === 'browser-ide';
    if (forwards.some(owns))
      await this.machines.setForwards(id, forwards.filter((item) => !owns(item)), forwards);
  }

  private stop(id: string, session: Session, signal: AbortSignal) {
    return this.control(session, () => this.stopSession(id, session, signal));
  }

  private async stopSession(id: string, session: Session, signal: AbortSignal) {
    if (this.machines.state(id) === 'paused')
      throw new AppError('请先恢复实例，再停止浏览器 IDE 会话', 409);
    if (this.machines.state(id) === 'running') {
      const result = await this.machines.exec(id,
        `if tmux has-session -t =${sessionName(session.projectId)} 2>/dev/null; then tmux kill-session -t =${sessionName(session.projectId)}; fi`,
        10000, signal);
      if (result.code !== 0) throw new AppError('无法停止浏览器 IDE 会话');
    }
    await this.bridges.stop(id, session.projectId);
    await this.removeForward(id, session);
    await this.change((state) => {
      state.sessions = state.sessions.filter((item) =>
        !(item.vmId === id && item.projectId === session.projectId &&
          item.startedAt === session.startedAt));
    });
    const key = keyOf(session);
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private async start(id: string, options: Input, signal: AbortSignal,
    log: (line: string) => void) {
    const { vm, projectId, session: prior } = this.context(id);
    if (vm.distro !== 'debian' && vm.distro !== 'ubuntu')
      throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    const project = await this.workspaces.config(id);
    if (prior && Date.now() < Date.parse(prior.expiresAt) &&
        await this.alive(id, projectId, signal)) {
      if (!this.matchesProject(prior, project) || prior.hostPort !== options.hostPort ||
          prior.guestPort !== options.guestPort)
        throw new AppError('请先停止当前浏览器 IDE 会话，再修改参数', 409);
      await this.restoreBridge(prior, project, signal);
      if (!await this.probeHttp(prior)) throw new AppError('浏览器 IDE 进程运行但入口不可达', 409);
      return { ready: true, executed: true, session: {
        status: 'running', hostPort: prior.hostPort, guestPort: prior.guestPort,
        expiresAt: prior.expiresAt }, message: '浏览器 IDE 会话已经运行。' };
    }
    if (prior) await this.stop(id, prior, signal);
    await this.install(id, signal, log);
    if (project.networkIsolation === 'private') await this.preparePrivate(id, project, signal);
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    signal.throwIfAborted();
    const before = this.machines.get(id).forwards;
    const networkIsolation = project.networkIsolation || 'host';
    const existing = before.find((item) => item.host === options.hostPort);
    if (existing && (networkIsolation === 'private' || existing.guest !== options.guestPort))
      throw new AppError('所选本机端口已映射到其他客户机端口', 409);
    const createdForward = networkIsolation === 'host' && !existing;
    if (createdForward) await this.machines.setForwards(id,
      [...before, { name: 'browser-ide', host: options.hostPort,
        guest: options.guestPort }], before);
    const session: Session = { vmId: id, projectId, directory: project.directory,
      guestPort: options.guestPort, hostPort: options.hostPort,
      password: randomBytes(32).toString('hex'), createdForward,
      networkIsolation,
      status: 'starting', startedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + options.ttlMinutes * 60_000).toISOString() };
    try {
      await this.change((state) => {
        if (state.sessions.length >= 128) throw new AppError('浏览器 IDE 会话记录已达到上限', 409);
        state.sessions.push(session);
      });
      await this.restoreBridge(session, project, signal);
      const durationSeconds = Math.max(1, Math.floor(
        (Date.parse(session.expiresAt) - Date.now()) / 1000));
      const command = `export PASSWORD=${quote(session.password)}
export CODE_SERVER_CONFIG=${quote('/tmp/' + sessionName(projectId) + '.yaml')}
exec timeout ${durationSeconds}s ${quote(binary)} ${quote(project.directory)} --auth password --bind-addr ${networkIsolation === 'private' ? '127.0.0.1' : '0.0.0.0'}:${session.guestPort} --disable-telemetry --disable-update-check --user-data-dir ${quote('/root/.local/share/' + sessionName(projectId))}`;
      const script = `${command} > ${quote(sessionLog(projectId))} 2>&1`;
      const result = await this.machines.exec(id,
        `tmux new-session -d -s ${sessionName(projectId)} -c ${quote(project.directory)} ${quote(projectNetworkCommand(project, script))}`,
        10000, signal);
      if (result.code !== 0) throw new AppError(result.stderr || '无法启动浏览器 IDE');
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (!await this.alive(id, projectId, signal))
          throw new AppError('浏览器 IDE 进程已退出，请检查客户机日志');
        if (await this.probeHttp(session)) {
          await this.change((state) => {
            const item = state.sessions.find((row) =>
              row.vmId === id && row.projectId === projectId)!;
            item.status = 'running';
          });
          this.schedule(session);
          log('浏览器 IDE 已在本机回环端口就绪。\n');
          return { ready: true, executed: true, session: {
            status: 'running', hostPort: session.hostPort, guestPort: session.guestPort,
            expiresAt: session.expiresAt }, message: '浏览器 IDE 已启动；打开入口后输入访问密码。' };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new AppError('浏览器 IDE 就绪检查超时');
    } catch (error) {
      await this.stop(id, session, new AbortController().signal).catch(() => {});
      throw error;
    }
  }

  async run(id: string, input: unknown, signal: AbortSignal, log: (line: string) => void) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    const options = browserIdeInput.parse(input);
    const { vm, projectId } = this.context(id);
    const key = `${id}:${projectId}`;
    if (this.active.has(key)) throw new AppError('此项目的浏览器 IDE 操作仍在进行', 409);
    this.active.add(key);
    try {
      signal.throwIfAborted();
      if (options.mode === 'status') return await this.view(id, options, signal);
      if (options.mode === 'start') return await this.start(id, options, signal, log);
      if (options.mode === 'install') {
        if (vm.distro !== 'debian' && vm.distro !== 'ubuntu')
          throw new AppError('浏览器 IDE 目前支持 Debian 和 Ubuntu 客户机', 409);
        if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
        await this.install(id, signal, log);
        return { ready: true, executed: true, installed: true,
          message: '浏览器 IDE 已安装；现在可启动会话。' };
      }
      const session = this.context(id).session;
      if (session) await this.stop(id, session, signal);
      return { ready: true, executed: true, session: null,
        message: '浏览器 IDE 会话已停止。' };
    } finally { this.active.delete(key); }
  }

  async link(id: string) {
    if (this.closed) throw new AppError('浏览器 IDE 服务已关闭', 409);
    const { projectId, session } = this.context(id);
    if (!session || Date.now() >= Date.parse(session.expiresAt) ||
        !await this.alive(id, projectId))
      throw new AppError('浏览器 IDE 会话未就绪或已过期', 409);
    await this.restoreBridge(session, await this.workspaces.config(id));
    if (!await this.probeHttp(session))
      throw new AppError('浏览器 IDE 会话未就绪或已过期', 409);
    return { url: `http://127.0.0.1:${session.hostPort}/`,
      password: session.password, expiresAt: session.expiresAt };
  }
}

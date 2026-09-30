import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces, Project } from './workspaces.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectNetworkCommand } from './project-network-isolation.ts';
import { withProjectCommand } from './project-execution.ts';

type Tunnel = {
  vmId: string;
  instance: unknown;
  project: Project;
  server: Server;
  guestPort: number;
  localPort: number;
  expiresAt: string;
  timer: ReturnType<typeof setTimeout>;
  sockets: Set<Socket>;
  channels: Set<Duplex>;
};
type Opening = { vmId: string; abort: AbortController; pending: Promise<unknown> };
const probeCommand = 'python3 -I -S -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"';

export class ReverseTunnels {
  private readonly owner = 'reverse-tunnel:' + randomUUID();
  private tunnels = new Map<string, Tunnel>();
  private stopping = new Map<string, Promise<boolean>>();
  private opening = new Map<string, Opening>();
  private closed = false;
  private unguard: () => void;
  private isRunning(id: string) {
    try { return this.machines.state(id) === 'running'; }
    catch { return false; }
  }
  private key(id: string) {
    return `${id}:${projectIdSchema.parse(this.workspaces.projects.current(id))}`;
  }
  private readonly changed = () => {
    for (const [key, tunnel] of this.tunnels)
      if (!this.isRunning(tunnel.vmId) || this.machines.live.get(tunnel.vmId) !== tunnel.instance)
        void this.stopKey(key);
    for (const opening of this.opening.values())
      if (!this.isRunning(opening.vmId)) opening.abort.abort();
  };
  private readonly locked = (id: string) => {
    for (const [key, tunnel] of this.tunnels)
      if (tunnel.vmId === id) void this.stopKey(key);
    for (const opening of this.opening.values())
      if (opening.vmId === id) opening.abort.abort();
  };

  constructor(private machines: Machines, private workspaces: Workspaces) {
    machines.on('change', this.changed);
    machines.on('incident-lockdown', this.locked);
    this.unguard = workspaces.beforeConfigChange(async (id, previous, next) => {
      if (previous.directory === next.directory &&
          (previous.networkIsolation || 'host') === (next.networkIsolation || 'host')) return;
      const key = `${id}:${previous._workspace || 'default'}`;
      if (this.tunnels.has(key) || this.opening.has(key) || this.stopping.has(key))
        throw new AppError('请先关闭此项目的临时隧道，再修改目录或网络模式', 409);
    });
  }

  async check(id: string, signal?: AbortSignal) {
    const running = this.isRunning(id);
    const project = await this.workspaces.config(id);
    const probe = running ? await this.machines.exec(id,
      projectNetworkCommand(project, probeCommand), 10000, signal) : null;
    return { ready: probe?.code === 0, executed: false,
      reason: !running ? '请先启动发行版。' : probe?.code === 0 ?
        '项目 Python 3.9+ 与网络空间已就绪，可创建限时本机 TCP 入口。' :
        '客户机需要 Python 3.9+，私有项目还需要有效的网络命名空间。', ...this.status(id) };
  }

  private describe(tunnel: Tunnel) {
    return { active: true as const, host: '127.0.0.1', localPort: tunnel.localPort,
      guestPort: tunnel.guestPort, expiresAt: tunnel.expiresAt,
      projectId: tunnel.project._workspace || 'default', directory: tunnel.project.directory,
      networkIsolation: tunnel.project.networkIsolation || 'host', connections: tunnel.sockets.size };
  }

  status(id: string) {
    const tunnel = this.tunnels.get(this.key(id));
    return tunnel ? this.describe(tunnel) : { active: false as const };
  }

  async open(id: string, guestPort: number, durationSeconds: number, signal?: AbortSignal) {
    if (!Number.isInteger(guestPort) || guestPort < 1 || guestPort > 65535 ||
        !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600)
      return Promise.reject(new AppError('客户机端口或隧道时限无效'));
    const key = this.key(id), projectId = this.workspaces.projects.current(id);
    if (this.closed) return Promise.reject(new AppError('临时隧道服务已关闭', 409));
    if (this.tunnels.has(key) || this.opening.has(key) || this.stopping.has(key))
      return Promise.reject(new AppError('此项目已有临时调试入口，请先关闭', 409));
    const abort = new AbortController();
    const combined = AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]);
    const opening: Opening = { vmId: id, abort, pending: Promise.resolve() };
    this.opening.set(key, opening);
    const pending = this.workspaces.projects.inScope(id, projectId, () =>
      withProjectCommand(this.machines, id, combined, this.workspaces, async (project) => {
        combined.throwIfAborted();
        if (this.closed) throw new AppError('临时隧道服务已关闭', 409);
        const probe = await this.machines.exec(id,
          projectNetworkCommand(project, probeCommand), 10000, combined);
        if (probe.code !== 0) throw new AppError(probe.stderr || '项目 Python 或网络空间未就绪', 409);
        const server = createServer({ allowHalfOpen: true },
          (socket) => void this.bridge(key, server, socket));
        const listening = new AbortController();
        const abortListen = () => listening.abort(combined.reason);
        combined.addEventListener('abort', abortListen, { once: true });
        if (combined.aborted) abortListen();
        let reserved = false;
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.once('close', () => reject(new AppError('临时隧道监听已取消', 409)));
            server.listen({ port: 0, host: '127.0.0.1', signal: listening.signal }, resolve);
          });
          combined.throwIfAborted();
          if (this.closed || !this.isRunning(id)) throw new AppError('实例或服务已关闭', 409);
          this.machines.requireUnlocked(id);
          const address = server.address();
          if (!address || typeof address === 'string') throw new AppError('无法分配本机端口', 500);
          const localPort = address.port;
          this.machines.reserveHostPorts(this.owner + ':' + key, [localPort]);
          reserved = true;
          // The relay receives only its captured namespace and directory metadata.
          const binding: Project = { directory: project.directory, template: 'none', repository: '', setup: '', command: '',
            _workspace: projectId === 'default' ? undefined : projectId,
            networkIsolation: project.networkIsolation || 'host' };
          const tunnel: Tunnel = { vmId: id, instance: this.machines.live.get(id), project: binding,
            server, guestPort, localPort, expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
            timer: setTimeout(() => void this.stopKey(key), durationSeconds * 1000),
            sockets: new Set(), channels: new Set() };
          tunnel.timer.unref();
          this.tunnels.set(key, tunnel);
          server.on('error', () => void this.stopKey(key));
          return { code: 0, ready: true, executed: true, ...this.describe(tunnel) };
        } catch (error) {
          await new Promise<void>((resolve) => server.close(() => resolve()));
          if (reserved) this.machines.reserveHostPorts(this.owner + ':' + key, []);
          throw error;
        } finally { combined.removeEventListener('abort', abortListen); }
      }));
    opening.pending = pending;
    return pending.finally(() => { if (this.opening.get(key) === opening) this.opening.delete(key); });
  }

  private async bridge(key: string, server: Server, socket: Socket) {
    const tunnel = this.tunnels.get(key);
    if (!tunnel || tunnel.server !== server || tunnel.sockets.size >= 4 || !this.isRunning(tunnel.vmId) ||
        this.machines.live.get(tunnel.vmId) !== tunnel.instance) { socket.destroy(); return; }
    tunnel.sockets.add(socket);
    const abort = new AbortController();
    socket.once('close', () => { abort.abort(); tunnel.sockets.delete(socket); });
    socket.on('error', () => socket.destroy());
    try {
      const project = await this.workspaces.projects.inScope(tunnel.vmId, tunnel.project._workspace || 'default',
        () => this.workspaces.config(tunnel.vmId));
      if (project.directory !== tunnel.project.directory ||
          (project.networkIsolation || 'host') !== tunnel.project.networkIsolation)
        throw new AppError('项目绑定已变化', 409);
      this.machines.requireUnlocked(tunnel.vmId);
      abort.signal.throwIfAborted();
      const channel = await this.machines.openGuestTcpStream(tunnel.vmId, tunnel.guestPort, abort.signal, tunnel.project);
      if (this.tunnels.get(key) !== tunnel || socket.destroyed) { channel.destroy(); return; }
      tunnel.channels.add(channel);
      channel.once('close', () => { tunnel.channels.delete(channel); socket.end(); });
      channel.once('end', () => socket.end());
      channel.on('error', () => socket.destroy());
      socket.pipe(channel).pipe(socket);
    } catch { socket.destroy(); }
  }

  private stopKey(key: string): Promise<boolean> {
    const existing = this.stopping.get(key);
    if (existing) return existing;
    const opening = this.opening.get(key);
    if (opening) {
      opening.abort.abort();
      return opening.pending.catch(() => {}).then(() => this.stopKey(key));
    }
    const tunnel = this.tunnels.get(key);
    if (!tunnel) return Promise.resolve(false);
    this.tunnels.delete(key);
    clearTimeout(tunnel.timer);
    for (const socket of tunnel.sockets) socket.destroy();
    for (const channel of tunnel.channels) channel.destroy();
    const pending = new Promise<boolean>((resolve) => tunnel.server.close(() => resolve(true)))
      .finally(() => {
        this.machines.reserveHostPorts(this.owner + ':' + key, []);
        this.stopping.delete(key);
      });
    this.stopping.set(key, pending);
    return pending;
  }

  stop(id: string) { return this.stopKey(this.key(id)); }

  async close() {
    this.closed = true;
    this.machines.off('change', this.changed);
    this.machines.off('incident-lockdown', this.locked);
    for (const opening of this.opening.values()) opening.abort.abort();
    await Promise.allSettled([...this.opening.values()].map((opening) => opening.pending));
    await Promise.all([...this.tunnels.keys()].map((key) => this.stopKey(key)));
    await Promise.all(this.stopping.values());
    this.unguard();
  }
}

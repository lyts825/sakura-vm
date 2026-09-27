import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { AppError } from './model.ts';
import type { Machines } from './machines.ts';

type Tunnel = {
  server: Server;
  guestPort: number;
  localPort: number;
  expiresAt: string;
  timer: ReturnType<typeof setTimeout>;
  sockets: Set<Socket>;
  channels: Set<Duplex>;
};

export class ReverseTunnels {
  private readonly owner = 'reverse-tunnel:' + randomUUID();
  private tunnels = new Map<string, Tunnel>();
  private stopping = new Map<string, Promise<boolean>>();
  private opening = new Set<string>();
  private closed = false;
  private isRunning(id: string) {
    try { return this.machines.state(id) === 'running'; }
    catch { return false; }
  }
  private readonly changed = () => {
    for (const id of this.tunnels.keys())
      if (!this.isRunning(id)) void this.stop(id);
  };
  private readonly locked = (id: string) => { void this.stop(id); };

  constructor(private machines: Machines) {
    machines.on('change', this.changed);
    machines.on('incident-lockdown', this.locked);
  }

  async check(id: string, signal?: AbortSignal) {
    const running = this.isRunning(id);
    const probe = running ? await this.machines.exec(id,
      'python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"',
      10000, signal) : null;
    return { ready: probe?.code === 0, executed: false,
      reason: !running ? '请先启动发行版。' : probe?.code === 0 ?
        'Python 3.9+ 已就绪，可在本机回环地址创建限时 TCP 调试入口。' :
        '客户机需要 Python 3.9+。', ...this.status(id) };
  }

  status(id: string) {
    const tunnel = this.tunnels.get(id);
    return tunnel
      ? { active: true, host: '127.0.0.1', localPort: tunnel.localPort,
          guestPort: tunnel.guestPort, expiresAt: tunnel.expiresAt,
          connections: tunnel.sockets.size }
      : { active: false };
  }

  async open(id: string, guestPort: number, durationSeconds: number, signal?: AbortSignal) {
    if (!Number.isInteger(guestPort) || guestPort < 1 || guestPort > 65535 ||
        !Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 600)
      throw new AppError('客户机端口或隧道时限无效');
    if (this.closed) throw new AppError('临时隧道服务已关闭', 409);
    if (this.tunnels.has(id) || this.opening.has(id))
      throw new AppError('此实例已有临时调试入口，请先关闭', 409);
    if (!this.isRunning(id)) throw new AppError('请先启动发行版', 409);
    this.machines.requireUnlocked(id);
    signal?.throwIfAborted();
    this.opening.add(id);
    const server = createServer((socket) => void this.bridge(id, server, socket));
    let reserved = false;
    try {
      const probe = await this.machines.exec(id,
        'python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)"',
        10000, signal);
      if (probe.code !== 0) throw new AppError('临时隧道需要客户机 Python 3.9+', 409);
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => reject(error);
        server.once('error', failed);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', failed);
          resolve();
        });
      });
      signal?.throwIfAborted();
      if (this.closed || !this.isRunning(id))
        throw new AppError('发行版已停止或服务正在关闭', 409);
      const address = server.address();
      if (!address || typeof address === 'string') throw new AppError('无法分配本机端口', 500);
      const localPort = address.port;
      this.machines.reserveHostPorts(this.owner + ':' + id, [localPort]);
      reserved = true;
      const tunnel: Tunnel = {
        server, guestPort, localPort,
        expiresAt: new Date(Date.now() + durationSeconds * 1000).toISOString(),
        timer: setTimeout(() => void this.stop(id), durationSeconds * 1000),
        sockets: new Set(), channels: new Set(),
      };
      tunnel.timer.unref();
      this.tunnels.set(id, tunnel);
      server.on('error', () => void this.stop(id));
      return { code: 0, ready: true, executed: true, ...this.status(id) };
    } catch (error) {
      if (server.listening) server.close();
      if (reserved) this.machines.reserveHostPorts(this.owner + ':' + id, []);
      throw error;
    } finally {
      this.opening.delete(id);
    }
  }

  private async bridge(id: string, server: Server, socket: Socket) {
    const tunnel = this.tunnels.get(id);
    if (!tunnel || tunnel.server !== server || tunnel.sockets.size >= 4 ||
        !this.isRunning(id)) {
      socket.destroy();
      return;
    }
    tunnel.sockets.add(socket);
    const abort = new AbortController();
    socket.once('close', () => {
      abort.abort();
      tunnel.sockets.delete(socket);
    });
    socket.on('error', () => socket.destroy());
    try {
      const channel = await this.machines.openGuestTcpStream(id, tunnel.guestPort, abort.signal);
      if (this.tunnels.get(id) !== tunnel || socket.destroyed) {
        channel.destroy();
        return;
      }
      tunnel.channels.add(channel);
      channel.once('close', () => {
        tunnel.channels.delete(channel);
        socket.destroy();
      });
      channel.on('error', () => channel.destroy());
      socket.pipe(channel).pipe(socket);
    } catch {
      socket.destroy();
    }
  }

  stop(id: string): Promise<boolean> {
    const existing = this.stopping.get(id);
    if (existing) return existing;
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return Promise.resolve(false);
    this.tunnels.delete(id);
    clearTimeout(tunnel.timer);
    this.machines.reserveHostPorts(this.owner + ':' + id, []);
    for (const socket of tunnel.sockets) socket.destroy();
    for (const channel of tunnel.channels) channel.destroy();
    const pending = new Promise<boolean>((resolve) => tunnel.server.close(() => resolve(true)))
      .finally(() => this.stopping.delete(id));
    this.stopping.set(id, pending);
    return pending;
  }

  async close() {
    this.closed = true;
    this.machines.off('change', this.changed);
    this.machines.off('incident-lockdown', this.locked);
    await Promise.all([...this.tunnels.keys()].map((id) => this.stop(id)));
    await Promise.all(this.stopping.values());
  }
}

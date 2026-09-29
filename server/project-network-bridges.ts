import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import type { ClientChannel } from 'ssh2';
import type { Machines } from './machines.ts';
import type { Project } from './workspaces.ts';
import { AppError } from './model.ts';
import { quote } from './files.ts';
import { projectNetworkCommand, projectNetworkNamespace } from './project-network-isolation.ts';

type Bridge = {
  vmId: string;
  namespace: string;
  guestPort: number;
  hostPort: number;
  command: string;
  server: Server;
  abort: AbortController;
  sockets: Set<Socket>;
  opening: Promise<void>;
  disposing?: Promise<void>;
};

// This relay only connects to one fixed loopback port inside the project
// namespace. It transports HTTP and WebSocket bytes without adding a guest
// interface, route, proxy or destination chosen by the browser.
function relayCommand(project: Project, port: number) {
  const script = [
    'import socket,sys,threading',
    `sock=socket.create_connection(("127.0.0.1",${port}),10)`,
    'sock.settimeout(None)',
    'def upstream():',
    '  try:',
    '    while True:',
    '      data=sys.stdin.buffer.read1(65536)',
    '      if not data: break',
    '      sock.sendall(data)',
    '  except OSError: pass',
    '  finally:',
    '    try: sock.shutdown(socket.SHUT_WR)',
    '    except OSError: pass',
    'threading.Thread(target=upstream,daemon=True).start()',
    'try:',
    '  while True:',
    '    data=sock.recv(65536)',
    '    if not data: break',
    '    sys.stdout.buffer.write(data)',
    '    sys.stdout.buffer.flush()',
    'finally: sock.close()',
  ].join('\n');
  return projectNetworkCommand(project, `exec python3 -I -S -u -c ${quote(script)}`);
}

export class ProjectNetworkBridges {
  private readonly owner = 'project-network-bridge:' + randomUUID();
  private bridges = new Map<string, Bridge>();
  private stopping = new Map<string, Promise<void>>();
  private closed = false;
  private isRunning(id: string) {
    try { return this.machines.state(id) === 'running'; }
    catch { return false; }
  }
  private readonly changed = () => {
    for (const [key, bridge] of this.bridges)
      if (!this.isRunning(bridge.vmId)) void this.stopKey(key);
  };
  private readonly locked = (id: string) => {
    for (const [key, bridge] of this.bridges)
      if (bridge.vmId === id) void this.stopKey(key);
  };

  constructor(private machines: Machines) {
    machines.on('change', this.changed);
    machines.on('incident-lockdown', this.locked);
  }

  async open(id: string, project: Project, guestPort: number, hostPort: number,
    signal?: AbortSignal) {
    const namespace = projectNetworkNamespace(project);
    if (!namespace) throw new AppError('本机桥接需要私有项目网络', 409);
    if (![guestPort, hostPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535))
      throw new AppError('项目桥接端口无效');
    if (this.closed) throw new AppError('项目桥接服务已关闭', 409);
    signal?.throwIfAborted();
    if (!this.isRunning(id)) throw new AppError('请先启动实例', 409);
    this.machines.requireUnlocked(id);
    const key = `${id}:${namespace}`;
    await this.stopping.get(key);
    if (this.closed || !this.isRunning(id)) throw new AppError('实例或项目桥接已关闭', 409);
    const prior = this.bridges.get(key);
    if (prior) {
      if (prior.guestPort !== guestPort || prior.hostPort !== hostPort)
        throw new AppError('请先关闭已有项目桥接，再修改端口', 409);
      await prior.opening;
      signal?.throwIfAborted();
      return;
    }
    const server = createServer({ allowHalfOpen: true },
      (socket) => void this.connect(key, server, socket));
    const bridge: Bridge = { vmId: id, namespace, guestPort, hostPort,
      command: relayCommand(project, guestPort), server,
      abort: new AbortController(), sockets: new Set(), opening: Promise.resolve() };
    this.bridges.set(key, bridge);
    const abort = () => bridge.abort.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    bridge.opening = (async () => {
      let reserved = false;
      try {
        signal?.throwIfAborted();
        this.machines.requireUnlocked(id);
        this.machines.reserveHostPorts(this.owner + ':' + key, [hostPort]);
        reserved = true;
        const result = await this.machines.exec(id,
          projectNetworkCommand(project, 'python3 -I -S -c "import socket,threading"'),
          10000, bridge.abort.signal);
        if (result.code !== 0) throw new AppError(result.stderr || '项目命名空间或 Python 桥接未就绪', 409);
        bridge.abort.signal.throwIfAborted();
        if (this.closed || !this.isRunning(id) || this.bridges.get(key) !== bridge)
          throw new AppError('实例或项目桥接已关闭', 409);
        this.machines.requireUnlocked(id);
        await new Promise<void>((resolve, reject) => {
          const failed = (error: Error) => reject(error);
          server.once('error', failed);
          server.listen({ port: hostPort, host: '127.0.0.1', signal: bridge.abort.signal }, () => {
            server.off('error', failed);
            resolve();
          });
          // An aborted listen can emit close without emitting error.
          server.once('close', () => reject(new AppError('项目桥接已关闭', 409)));
        });
        server.on('error', () => void this.stopKey(key));
        bridge.abort.signal.throwIfAborted();
      } catch (error) {
        if (this.bridges.get(key) === bridge) this.bridges.delete(key);
        if (reserved) await this.dispose(key, bridge);
        else bridge.abort.abort();
        throw error;
      } finally { signal?.removeEventListener('abort', abort); }
    })();
    await bridge.opening;
  }

  private async connect(key: string, server: Server, socket: Socket) {
    const bridge = this.bridges.get(key);
    if (!bridge || bridge.server !== server || bridge.abort.signal.aborted || bridge.sockets.size >= 32 ||
        !this.isRunning(bridge.vmId)) { socket.destroy(); return; }
    const abort = new AbortController();
    bridge.sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => {
      abort.abort();
      bridge.sockets.delete(socket);
    });
    try {
      this.machines.requireUnlocked(bridge.vmId);
      const client = await this.machines.connect(bridge.vmId, 10000, abort.signal);
      const destroy = () => client.destroy();
      abort.signal.addEventListener('abort', destroy, { once: true });
      client.once('close', () => socket.destroy());
      client.on('error', () => socket.destroy());
      if (abort.signal.aborted || this.bridges.get(key) !== bridge) {
        client.destroy(); socket.destroy(); return;
      }
      try {
        const channel = await new Promise<ClientChannel>((resolve, reject) => {
          let settled = false;
          const finish = (error?: Error, stream?: ClientChannel) => {
            if (settled) { stream?.destroy(); return; }
            settled = true;
            clearTimeout(timer);
            client.off('close', closed);
            abort.signal.removeEventListener('abort', cancelled);
            error ? reject(error) : resolve(stream!);
          };
          const closed = () => finish(new Error('SSH connection closed'));
          const cancelled = () => finish(new AppError('项目桥接连接已取消', 409));
          const timer = setTimeout(() => finish(new AppError('项目桥接连接超时', 504)), 10000);
          timer.unref();
          client.once('close', closed);
          abort.signal.addEventListener('abort', cancelled, { once: true });
          if (abort.signal.aborted) return cancelled();
          client.exec(bridge.command, (error, stream) => finish(error || undefined, stream));
        });
        if (socket.destroyed || this.bridges.get(key) !== bridge) { channel.destroy(); return; }
        channel.stderr.resume();
        channel.stderr.on('error', () => socket.destroy());
        channel.on('error', () => socket.destroy());
        // EOF ends the response, preserving buffered bytes; client close is
        // deferred until the local socket has flushed them.
        channel.once('end', () => socket.end());
        channel.once('close', () => socket.end());
        socket.pipe(channel).pipe(socket);
      } catch { socket.destroy(); }
      if (socket.destroyed) client.destroy();
    } catch { socket.destroy(); }
  }

  private dispose(key: string, bridge: Bridge) {
    if (bridge.disposing) return bridge.disposing;
    for (const socket of bridge.sockets) socket.destroy();
    bridge.disposing = new Promise<void>((resolve) => {
      bridge.server.close(() => resolve());
      bridge.abort.abort();
    }).finally(() => this.machines.reserveHostPorts(this.owner + ':' + key, []));
    return bridge.disposing;
  }

  private stopKey(key: string): Promise<void> {
    const pending = this.stopping.get(key);
    if (pending) return pending;
    const bridge = this.bridges.get(key);
    if (!bridge) return Promise.resolve();
    this.bridges.delete(key);
    bridge.abort.abort();
    for (const socket of bridge.sockets) socket.destroy();
    const stopping = bridge.opening.catch(() => {}).then(() => this.dispose(key, bridge))
      .finally(() => this.stopping.delete(key));
    this.stopping.set(key, stopping);
    return stopping;
  }

  stop(id: string, projectId: string) { return this.stopKey(`${id}:sk-${projectId}`); }

  async close() {
    this.closed = true;
    this.machines.off('change', this.changed);
    this.machines.off('incident-lockdown', this.locked);
    await Promise.all([...this.bridges.keys()].map((key) => this.stopKey(key)));
    await Promise.all(this.stopping.values());
  }
}

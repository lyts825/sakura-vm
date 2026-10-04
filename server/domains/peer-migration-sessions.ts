import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Server as TcpServer, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import { AppError } from '../../shared/errors.ts';
import type { qmp } from '../qmp.ts';

export type MigrationChannel = 'disk' | 'state';
type MigrationSession = {
  requesterId: string;
  ports: Record<MigrationChannel, number>;
  qmpPort?: number;
  targetDiskNode?: string;
  targetVmId?: string;
  transferId?: string;
  exportId?: string;
  expiresAt: number;
  active: Set<Duplex>;
};
type MigrationForward = { server: TcpServer; sockets: Set<Duplex> };
export const migrationQmpInput = z
  .object({
    sessionId: z.uuid(),
    command: z.enum([
      'query-status',
      'query-version',
      'query-hotpluggable-cpus',
      'query-block',
      'migrate-incoming',
      'nbd-server-start',
      'block-export-add',
      'block-export-del',
      'nbd-server-stop',
    ]),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type MigrationSessionPorts = {
  unavailable(): boolean;
  now(): number;
  inbound(request: IncomingMessage): { requesterId: string; allowImport: boolean; allowActivate: boolean };
  canReceive(requesterId: string): boolean;
  outbound(peerId: string): { url: string; fingerprint: string; token: string } | undefined;
  dial(options: { host: string; port: number }, signal: AbortSignal): Promise<Socket>;
  createServer(listener: (socket: Socket) => void): TcpServer;
  connectPinned(url: string, fingerprint: string, path: string, token: string): Promise<Duplex>;
  query: typeof qmp;
};

/** Owns revocable migration sessions, QMP authority, loopback forwards and their sockets. */
export class PeerMigrationSessions {
  private migrationSessions = new Map<string, MigrationSession>();
  private migrationForwards = new Map<string, Set<MigrationForward>>();
  private closed = false;
  constructor(private readonly ports: MigrationSessionPorts) {}
  async acceptMigrationStream(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => {});
    const reject = (status: number) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`);
    };
    try {
      if (this.closed || this.ports.unavailable()) return reject(503);
      const peer = this.ports.inbound(request);
      if (!peer.allowImport || !peer.allowActivate) return reject(403);
      const match = /^\/peer\/migration-stream\/([0-9a-f-]{36})\/(disk|state)$/.exec(request.url || '');
      if (!match) return reject(404);
      const session = this.migrationSessions.get(match[1]);
      if (!session || session.requesterId !== peer.requesterId || session.expiresAt <= this.ports.now())
        return reject(404);
      if (session.active.size >= 4) return reject(429);
      socket.pause();
      session.active.add(socket);
      const abort = new AbortController();
      socket.once('close', () => {
        session.active.delete(socket);
        abort.abort();
      });
      const upstream = await this.ports.dial(
        { host: '127.0.0.1', port: session.ports[match[2] as MigrationChannel] },
        abort.signal,
      );
      if (
        socket.destroyed ||
        this.migrationSessions.get(match[1]) !== session ||
        session.expiresAt <= this.ports.now()
      ) {
        upstream.destroy();
        return socket.destroy();
      }
      const cleanup = () => {
        session.active.delete(socket);
        upstream.destroy();
      };
      socket.once('close', cleanup);
      socket.once('error', () => upstream.destroy());
      upstream.once('error', () => socket.destroy());
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
      socket.resume();
      upstream.resume();
    } catch (error) {
      reject(error instanceof AppError ? error.status : 400);
    }
  }

  /** Target-side, short-lived authority for QEMU ports already bound to loopback. */
  registerMigrationSession(
    requesterId: string,
    ports: Record<MigrationChannel, number> & {
      qmp?: number;
      targetDiskNode?: string;
      targetVmId?: string;
      transferId?: string;
    },
  ) {
    if (this.closed || this.ports.unavailable()) throw new AppError('服务不可用', 503);
    z.uuid().parse(requesterId);
    if (!this.ports.canReceive(requesterId)) throw new AppError('同伴没有在线迁移接收权限', 403);
    for (const [id, session] of this.migrationSessions)
      if (session.expiresAt <= this.ports.now() && session.active.size === 0) this.closeMigrationSession(id);
    if (this.migrationSessions.size >= 4) throw new AppError('迁移通道数量已达上限', 409);
    for (const port of [ports.disk, ports.state, ...(ports.qmp === undefined ? [] : [ports.qmp])])
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new AppError('迁移端口无效');
    if (
      (ports.qmp === undefined) !== (ports.targetDiskNode === undefined) ||
      (ports.targetDiskNode !== undefined && !/^[#a-zA-Z0-9._-]{1,64}$/.test(ports.targetDiskNode))
    )
      throw new AppError('目标 QMP 与磁盘节点必须一起登记');
    if ((ports.targetVmId === undefined) !== (ports.transferId === undefined))
      throw new AppError('目标实例与迁移标识必须一起登记');
    if (ports.targetVmId) z.uuid().parse(ports.targetVmId);
    if (ports.transferId) z.uuid().parse(ports.transferId);
    const id = randomUUID();
    this.migrationSessions.set(id, {
      requesterId,
      ports: { ...ports },
      qmpPort: ports.qmp,
      targetDiskNode: ports.targetDiskNode,
      targetVmId: ports.targetVmId,
      transferId: ports.transferId,
      expiresAt: this.ports.now() + 30 * 60_000,
      active: new Set(),
    });
    return id;
  }

  matchesMigrationSession(id: string, requesterId: string, targetVmId: string, transferId: string) {
    const session = this.migrationSessions.get(id);
    return (
      !!session &&
      session.expiresAt > this.ports.now() &&
      session.requesterId === requesterId &&
      session.targetVmId === targetVmId &&
      session.transferId === transferId
    );
  }

  closeMigrationSession(id: string) {
    const session = this.migrationSessions.get(id);
    if (!session) return;
    this.migrationSessions.delete(id);
    for (const socket of session.active) socket.destroy();
  }

  closeMigrationForwards(peerId: string) {
    const forwards = this.migrationForwards.get(peerId);
    if (!forwards) return;
    this.migrationForwards.delete(peerId);
    for (const forward of forwards) {
      for (const socket of forward.sockets) socket.destroy();
      forward.server.close();
    }
    forwards.clear();
  }

  /** Source-side local forward: QEMU only sees 127.0.0.1 while TLS carries the bytes. */
  async openMigrationForward(peerId: string, sessionId: string, channel: MigrationChannel) {
    if (this.closed || this.ports.unavailable()) throw new AppError('服务不可用', 503);
    z.uuid().parse(sessionId);
    if (channel !== 'disk' && channel !== 'state') throw new AppError('迁移通道无效');
    const peer = this.ports.outbound(peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    if ((this.migrationForwards.get(peerId)?.size || 0) >= 4)
      throw new AppError('本机迁移转发端口数量已达上限', 409);
    const sockets = new Set<Duplex>();
    const server = this.ports.createServer((local: Socket) => {
      local.pause();
      sockets.add(local);
      local.once('close', () => sockets.delete(local));
      void this.ports.connectPinned(
        peer.url,
        peer.fingerprint,
        `/peer/migration-stream/${sessionId}/${channel}`,
        peer.token,
      )
        .then((remote) => {
          if (local.destroyed) return remote.destroy();
          sockets.add(remote);
          remote.once('close', () => sockets.delete(remote));
          local.once('error', () => remote.destroy());
          remote.once('error', () => local.destroy());
          local.once('close', () => remote.destroy());
          remote.once('close', () => local.destroy());
          local.pipe(remote);
          remote.pipe(local);
          local.resume();
        })
        .catch(() => local.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    // Listening is asynchronous: revocation or shutdown may have occurred before publication.
    const current = this.ports.outbound(peerId);
    if (this.closed || this.ports.unavailable() || !current || current.token !== peer.token ||
      current.url !== peer.url || current.fingerprint !== peer.fingerprint ||
      (this.migrationForwards.get(peerId)?.size || 0) >= 4) {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      throw new AppError('迁移转发准入已失效', 409);
    }
    const entry = { server, sockets };
    const active = this.migrationForwards.get(peerId) || new Set<MigrationForward>();
    active.add(entry);
    this.migrationForwards.set(peerId, active);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('迁移转发端口无效');
    return {
      port: address.port,
      close: async () => {
        if (!active.delete(entry)) return;
        if (!active.size) this.migrationForwards.delete(peerId);
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async executeMigrationQmp(peerId: string, input: z.infer<typeof migrationQmpInput>) {
    input = migrationQmpInput.parse(input);
    const session = this.migrationSessions.get(input.sessionId);
    if (
      !session ||
      session.requesterId !== peerId ||
      session.expiresAt <= this.ports.now() ||
      !session.qmpPort ||
      !session.targetDiskNode
    )
      throw new AppError('迁移会话不存在或已过期', 404);
    const args = input.args || {};
    const keys = Object.keys(args).sort().join(',');
    if (input.command.startsWith('query-') || input.command === 'nbd-server-stop') {
      if (keys) throw new AppError('QMP 查询或停止命令不能包含参数');
    } else if (input.command === 'migrate-incoming') {
      if (
        keys !== 'exit-on-error,uri' ||
        args.uri !== `tcp:127.0.0.1:${session.ports.state}` ||
        args['exit-on-error'] !== false
      )
        throw new AppError('迁移接收端口与会话不一致');
    } else if (input.command === 'nbd-server-start') {
      const expected = { type: 'inet', data: { host: '127.0.0.1', port: String(session.ports.disk) } };
      if (keys !== 'addr' || JSON.stringify(args.addr) !== JSON.stringify(expected))
        throw new AppError('NBD 监听端口与会话不一致');
    } else if (input.command === 'block-export-add') {
      const id = args.id;
      if (
        keys !== 'id,name,node-name,type,writable' ||
        typeof id !== 'string' ||
        !/^sakura-export-[0-9a-f]{12}$/.test(id) ||
        args.name !== id ||
        args.type !== 'nbd' ||
        args.writable !== true ||
        args['node-name'] !== session.targetDiskNode ||
        session.exportId
      )
        throw new AppError('NBD 导出与迁移会话不一致');
    } else if (input.command === 'block-export-del') {
      if (keys !== 'id' || args.id !== session.exportId) throw new AppError('NBD 导出标识与迁移会话不一致');
    }
    const result = await this.ports.query(session.qmpPort, input.command, args, 10_000);
    if (input.command === 'block-export-add') session.exportId = args.id as string;
    if (input.command === 'block-export-del') session.exportId = undefined;
    return result;
  }


  revokeUnauthorized() {
    for (const [id, session] of this.migrationSessions)
      if (!this.ports.canReceive(session.requesterId)) this.closeMigrationSession(id);
  }
  close() {
    this.closed = true;
    for (const id of this.migrationSessions.keys()) this.closeMigrationSession(id);
    for (const peerId of this.migrationForwards.keys()) this.closeMigrationForwards(peerId);
  }
}

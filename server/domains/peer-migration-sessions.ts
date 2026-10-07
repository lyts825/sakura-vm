/**
 * 模块职责：管理同伴迁移会话、数据通道和 QMP 转发；连接受配对权限及原会话身份限制。
 * Module purpose: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
 */
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
  /**
   * 签名 / Signature: MigrationSessionPorts.unavailable.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 unavailable 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for unavailable in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  unavailable(): boolean;
  /**
   * 签名 / Signature: MigrationSessionPorts.now.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 now 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for now in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: number.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  now(): number;
  /**
   * 签名 / Signature: MigrationSessionPorts.inbound.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 inbound 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for inbound in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: request: IncomingMessage
   * 输出 / Returns: { requesterId: string; allowImport: boolean; allowActivate: boolean }.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  inbound(request: IncomingMessage): { requesterId: string; allowImport: boolean; allowActivate: boolean };
  /**
   * 签名 / Signature: MigrationSessionPorts.canReceive.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 canReceive 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for canReceive in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: requesterId: string
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  canReceive(requesterId: string): boolean;
  /**
   * 签名 / Signature: MigrationSessionPorts.outbound.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 outbound 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for outbound in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: peerId: string
   * 输出 / Returns: { url: string; fingerprint: string; token: string } | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  outbound(peerId: string): { url: string; fingerprint: string; token: string } | undefined;
  /**
   * 签名 / Signature: MigrationSessionPorts.dial.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 dial 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for dial in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: options: { host: string; port: number }; signal: AbortSignal
   * 输出 / Returns: Promise<Socket>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  dial(options: { host: string; port: number }, signal: AbortSignal): Promise<Socket>;
  /**
   * 签名 / Signature: MigrationSessionPorts.createServer.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 createServer 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for createServer in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: listener: (socket: Socket) => void
   * 输出 / Returns: TcpServer.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  createServer(listener:
  /**
   * 中文功能：为 MigrationSessionPorts.createServer.listener 登记事件、状态变化或阶段结束通知，接收本声明规定的事件数据。
   * English: Registers event/state-change/phase-completion notification for MigrationSessionPorts.createServer.listener using its declared event data.
   * 所属 / Owner: MigrationSessionPorts.createServer.listener.
   * 输入 / Inputs: socket: Socket.
   * 结果 / Result: `void`.
   */
  (socket: Socket) => void): TcpServer;
  /**
   * 签名 / Signature: MigrationSessionPorts.connectPinned.
   * 功能：为管理同伴迁移会话、数据通道和 QMP 转发声明 connectPinned 的输入与结果契约，所属容器为 MigrationSessionPorts。
   * Purpose: Declares the input/result contract for connectPinned in MigrationSessionPorts. Module responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 输入 / Inputs: url: string; fingerprint: string; path: string; token: string
   * 输出 / Returns: Promise<Duplex>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  connectPinned(url: string, fingerprint: string, path: string, token: string): Promise<Duplex>;
  query: typeof qmp;
};

/** Owns revocable migration sessions, QMP authority, loopback forwards and their sockets. */
export class PeerMigrationSessions {
  private migrationSessions = new Map<string, MigrationSession>();
  private migrationForwards = new Map<string, Set<MigrationForward>>();
  private closed = false;
  /**
   * 入口 / Entry: PeerMigrationSessions.constructor.
   * 功能：建立 PeerMigrationSessions 的管理同伴迁移会话、数据通道和 QMP 转发上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PeerMigrationSessions context for this module's responsibility: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: ports: MigrationSessionPorts
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly ports: MigrationSessionPorts) {}
  /**
   * 入口 / Entry: PeerMigrationSessions.acceptMigrationStream.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `reject(503)` / `reject(403)` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; this entry produces `reject(503)` / `reject(403)` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `socket.on`, `this.ports.unavailable`, `reject`, `this.ports.inbound` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socket.on`, `this.ports.unavailable`, `reject`, `this.ports.inbound`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.ports.unavailable()`; `!peer.allowImport || !peer.allowActivate`; `!match`.
   * 输入 / Inputs: request: IncomingMessage; socket: Duplex; head: Buffer
   * 输出 / Returns: `reject(503)`; `reject(403)`; `reject(404)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `inline.exec`; `session.active.add`; `upstream.destroy`; `socket.destroy`; `socket.write`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `reject(error instanceof AppError ? error.status : 400);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `reject(error instanceof AppError ? error.status : 400);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async acceptMigrationStream(request: IncomingMessage, socket: Duplex, head: Buffer) {
    socket.on('error', () => {});
    /**
     * 入口 / Entry: PeerMigrationSessions.acceptMigrationStream.reject.
     * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PeerMigrationSessions`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; the calls and state transitions below complete the operation. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
     * 处理：通过 `socket.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `socket.end`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: status: number
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
      /**
       * 入口 / Entry: PeerMigrationSessions.acceptMigrationStream.cleanup.
       * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PeerMigrationSessions`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerMigrationSessions`; the calls and state transitions below complete the operation. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
       * 处理：通过 `session.active.delete`, `upstream.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `session.active.delete`, `upstream.destroy`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `session.active.delete`; `upstream.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
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
  /**
   * 入口 / Entry: PeerMigrationSessions.registerMigrationSession.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `id` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; this entry produces `id` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.ports.unavailable`, `z.uuid().parse`, `z.uuid`, `this.ports.canReceive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.unavailable`, `z.uuid().parse`, `z.uuid`, `this.ports.canReceive`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.expiresAt <= this.ports.now() && session.active.size === 0`; `ports.targetVmId`; `ports.transferId`.
   * 输入 / Inputs: requesterId: string; ports: Record<MigrationChannel, number> & { qmp?: number; targetDiskNode?: string; targetVmI…
   * 输出 / Returns: `id`.
   * 副作用 / Effects: `this.closeMigrationSession`; `this.migrationSessions.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.ports.unavailable()`; `!this.ports.canReceive(requesterId)`; `this.migrationSessions.size >= 4`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('同伴没有在线迁移接收权限', 403)`.
   */
  registerMigrationSession(
    requesterId: string,
    ports: Record<MigrationChannel, number> & {
      qmp?: number;
      targetDiskNode?: string;
      targetVmId?: string;
      transferId?: string;
      sessionId?: string;
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
    const id = ports.sessionId ? z.uuid().parse(ports.sessionId) as ReturnType<typeof randomUUID> : randomUUID();
    if (this.migrationSessions.has(id)) throw new AppError('原迁移会话仍然存在，不能覆盖', 409);
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

  /**
   * 入口 / Entry: PeerMigrationSessions.matchesMigrationSession.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( !!session && session.expiresAt > this.ports.now() && session.requesterId === requesterId && session.targetVmId === targetVm…` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; this entry produces `( !!session && session.expiresAt > this.ports.now() && session.requesterId === requesterId && session.targetVmId === targetVm…` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.migrationSessions.get`, `this.ports.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migrationSessions.get`, `this.ports.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; requesterId: string; targetVmId: string; transferId: string
   * 输出 / Returns: `( !!session && session.expiresAt > this.ports.now() && session.requesterId === requesterId && session.targetVmId === targetVm…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

  /**
   * 入口 / Entry: PeerMigrationSessions.closeMigrationSession.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerMigrationSessions`; this entry produces `void` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.migrationSessions.get`, `this.migrationSessions.delete`, `socket.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migrationSessions.get`, `this.migrationSessions.delete`, `socket.destroy`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!session`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.migrationSessions.delete`; `socket.destroy`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  closeMigrationSession(id: string) {
    const session = this.migrationSessions.get(id);
    if (!session) return;
    this.migrationSessions.delete(id);
    for (const socket of session.active) socket.destroy();
  }

  /**
   * 入口 / Entry: PeerMigrationSessions.closeMigrationForwards.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerMigrationSessions`; this entry produces `void` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.migrationForwards.get`, `this.migrationForwards.delete`, `socket.destroy`, `forward.server.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migrationForwards.get`, `this.migrationForwards.delete`, `socket.destroy`, `forward.server.close`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!forwards`.
   * 输入 / Inputs: peerId: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.migrationForwards.delete`; `socket.destroy`; `forward.server.close`; `forwards.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: PeerMigrationSessions.openMigrationForward.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ port: address.port, close: async () => { if (!active.delete(entry)) return; if (!active.size) this.migrationForwards.delete…` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; this entry produces `{ port: address.port, close: async () => { if (!active.delete(entry)) return; if (!active.size) this.migrationForwards.delete…` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.ports.unavailable`, `z.uuid().parse`, `z.uuid`, `this.ports.outbound` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.unavailable`, `z.uuid().parse`, `z.uuid`, `this.ports.outbound`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: peerId: string; sessionId: string; channel: MigrationChannel
   * 输出 / Returns: `{ port: address.port, close: async () => { if (!active.delete(entry)) return; if (!active.size) this.migrationForwards.delete…`.
   * 副作用 / Effects: `this.ports.createServer`; `socket.destroy`; `active.add`; `this.migrationForwards.set`; `server.address`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || this.ports.unavailable()`; `channel !== 'disk' && channel !== 'state'`; `!peer`; 异常 / errors `new AppError('服务不可用', 503)`; `new AppError('迁移通道无效')`.
   */
  async openMigrationForward(peerId: string, sessionId: string, channel: MigrationChannel) {
    if (this.closed || this.ports.unavailable()) throw new AppError('服务不可用', 503);
    z.uuid().parse(sessionId);
    if (channel !== 'disk' && channel !== 'state') throw new AppError('迁移通道无效');
    const peer = this.ports.outbound(peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    if ((this.migrationForwards.get(peerId)?.size || 0) >= 4)
      throw new AppError('本机迁移转发端口数量已达上限', 409);
    const sockets = new Set<Duplex>();
    /**
     * 入口 / Entry: PeerMigrationSessions.openMigrationForward.callback@195.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.ports.createServer）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.ports.createServer).
     * 输入 / Inputs: local: Socket
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `sockets.add`; `this.ports.connectPinned().then().catch`; `this.ports.connectPinned().then`; `this.ports.connectPinned`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const server = this.ports.createServer((local: Socket) => {
      local.pause();
      sockets.add(local);
      local.once('close', () => sockets.delete(local));
      /**
       * 入口 / Entry: PeerMigrationSessions.openMigrationForward.callback@205.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.ports.connectPinned().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.ports.connectPinned().then).
       * 输入 / Inputs: remote
       * 输出 / Returns: `remote.destroy()`.
       * 副作用 / Effects: `remote.destroy`; `sockets.add`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
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
      /**
       * 入口 / Entry: PeerMigrationSessions.openMigrationForward.close.
       * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`PeerMigrationSessions`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerMigrationSessions`; this entry produces `void` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
       * 处理：通过 `active.delete`, `this.migrationForwards.delete`, `socket.destroy` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `active.delete`, `this.migrationForwards.delete`, `socket.destroy`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!active.delete(entry)`; `!active.size`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `active.delete`; `this.migrationForwards.delete`; `socket.destroy`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      close: async () => {
        if (!active.delete(entry)) return;
        if (!active.size) this.migrationForwards.delete(peerId);
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  /**
   * 入口 / Entry: PeerMigrationSessions.executeMigrationQmp.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; this entry produces `result` for its caller. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `migrationQmpInput.parse`, `this.migrationSessions.get`, `this.ports.now`, `input.command.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `migrationQmpInput.parse`, `this.migrationSessions.get`, `this.ports.now`, `input.command.startsWith`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `input.command === 'block-export-add'`; `input.command === 'block-export-del'`.
   * 输入 / Inputs: peerId: string; input: z.infer<typeof migrationQmpInput>
   * 输出 / Returns: `result`.
   * 副作用 / Effects: `input.command.startsWith`; 更新 / updates `input`, `session.exportId`.
   * 拒绝 / Refusals: 条件 / conditions `!session || session.requesterId !== peerId || session.expiresAt <= this.ports.now() || !session.qmpPort || !session.targetDis…`; `input.command.startsWith('query-') || input.command === 'nbd-server-stop'`; `keys`; 异常 / errors `new AppError('迁移会话不存在或已过期', 404)`; `new AppError('QMP 查询或停止命令不能包含参数')`.
   */
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


  /**
   * 入口 / Entry: PeerMigrationSessions.revokeUnauthorized.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PeerMigrationSessions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PeerMigrationSessions`; the calls and state transitions below complete the operation. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.ports.canReceive`, `this.closeMigrationSession` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ports.canReceive`, `this.closeMigrationSession`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.ports.canReceive(session.requesterId)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.closeMigrationSession`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revokeUnauthorized() {
    for (const [id, session] of this.migrationSessions)
      if (!this.ports.canReceive(session.requesterId)) this.closeMigrationSession(id);
  }
  /**
   * 入口 / Entry: PeerMigrationSessions.close.
   * 功能：在管理同伴迁移会话、数据通道和 QMP 转发中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`PeerMigrationSessions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PeerMigrationSessions`; the outcome is recorded in `this.closed`. Module context: Owns peer migration sessions, channels and QMP forwarding under pairing permissions and original session identity.
   * 处理：通过 `this.migrationSessions.keys`, `this.closeMigrationSession`, `this.migrationForwards.keys`, `this.closeMigrationForwards` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.migrationSessions.keys`, `this.closeMigrationSession`, `this.migrationForwards.keys`, `this.closeMigrationForwards`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.closeMigrationSession`; `this.closeMigrationForwards`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() {
    this.closed = true;
    for (const id of this.migrationSessions.keys()) this.closeMigrationSession(id);
    for (const peerId of this.migrationForwards.keys()) this.closeMigrationForwards(peerId);
  }
}

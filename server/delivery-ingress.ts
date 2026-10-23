/** 固定 SSH 隧道上的 HTTP 协议适配；不创建外网连接，不转发管理凭据。 */
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { networkFor, type NetworkScope } from './network/index.ts';
import type { VmAccess } from './vm-access.ts';
import type { DeliverySpace } from './delivery-executor.ts';
import { AppError } from '../shared/errors.ts';
import { quote } from './shell.ts';
const allowedRequest = new Set([
  'accept',
  'accept-language',
  'content-type',
  'content-length',
  'range',
  'if-none-match',
  'if-modified-since',
  'user-agent',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
]);
const blockedResponse = new Set([
  'set-cookie',
  'www-authenticate',
  'proxy-authenticate',
  'connection',
  'transfer-encoding',
  'content-security-policy',
  'access-control-allow-origin',
  'access-control-allow-credentials',
]);
export class DeliveryIngress {
  private server?: Server;
  private sockets = new Set<Duplex>();
  private closed = false;
  private networking: NetworkScope;
  private authority = '';
  url = '';
  constructor(
    private machines: VmAccess,
    private space: DeliverySpace,
    private guestPort: number,
    private expiresAt: string,
    private assertCurrent: () => void,
    private authorize: () => void | Promise<void>,
    network: NetworkScope = networkFor('core:delivery-preview'),
  ) {
    this.networking = network;
  }
  private check() {
    this.assertCurrent();
    if (this.closed || Date.now() >= Date.parse(this.expiresAt))
      throw new AppError('预览入口已撤回或到期', 410);
  }
  private track(socket: Duplex) {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }
  /** 每次握手复核权限，固定回环中继不接收任意连接目标。 Rechecks each handshake and relays only the captured guest loopback port. */
  private async request(method: string, path: string, headers: IncomingMessage['headers']) {
    this.check();
    await this.authorize();
    const client = await this.machines.connect(this.space.vmId, 15_000);
    let tunnel: Duplex | undefined;
    try {
      this.check();
      await this.authorize();
      // Some base images disable SSH direct-tcpip. This fixed relay opens exactly the captured loopback port,
      // carries no shell input and exits on EOF, connection closure, or the original preview deadline.
      const lifetime = Math.max(1, Math.ceil((Date.parse(this.expiresAt) - Date.now()) / 1000));
      const relay = `import os,socket,select,time\ns=socket.create_connection(('127.0.0.1',${this.guestPort}),5)\nend=time.monotonic()+${lifetime}\ntry:\n while time.monotonic()<end:\n  ready,_,_=select.select([s,0],[],[],min(1,max(0,end-time.monotonic())))\n  if 0 in ready:\n   data=os.read(0,65536)\n   if not data:break\n   s.sendall(data)\n  if s in ready:\n   data=s.recv(65536)\n   if not data:break\n   view=memoryview(data)\n   while view:view=view[os.write(1,view):]\nfinally:s.close()\n`;
      tunnel = await new Promise<Duplex>((resolve, reject) =>
        client.exec('exec /usr/bin/python3 -I -S -c ' + quote(relay), (error, stream) =>
          error ? reject(error) : resolve(stream),
        ),
      );
      tunnel.once('close', () => client.end());
      this.track(tunnel);
      this.check();
      // ClientRequest is used only as an HTTP parser on the already-owned SSH channel.
      const request = this.networking.httpStreamRequest(
        { method, path, host: '127.0.0.1', port: this.guestPort, headers },
        tunnel,
      );
      request.setTimeout(30_000, () => request.destroy(new Error('预览响应超时')));
      request.once('close', () => tunnel?.destroy());
      return request;
    } catch (error) {
      tunnel?.destroy();
      client.end();
      throw error;
    }
  }
  /** 分配独立浏览器来源并限制 Host 和 Origin。 Allocates a separate browser origin with Host and Origin enforcement. */
  async open(id: string) {
    const server = this.networking.createHttpServer((request, response) => {
      void this.proxy(request, response).catch((error) => {
        if (!response.headersSent) response.writeHead(error instanceof AppError ? error.status : 502);
        response.end('Preview unavailable');
      });
    });
    this.server = server;
    server.on('connection', (socket) => this.track(socket));
    server.on('upgrade', (request, socket, head) => {
      void this.upgrade(request, socket, head).catch(() => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.authority = 'delivery-' + id + '.localhost:' + (server.address() as { port: number }).port;
    this.url = 'http://' + this.authority;
    return this.url;
  }
  private headers(request: IncomingMessage) {
    this.check();
    if (
      request.headers.host !== this.authority ||
      !request.url?.startsWith('/') ||
      request.url.startsWith('//')
    )
      throw new AppError('预览来源不匹配', 403);
    if (request.headers.origin && request.headers.origin !== this.url)
      throw new AppError('跨来源预览访问被拒绝', 403);
    const headers: IncomingMessage['headers'] = { host: '127.0.0.1:' + this.guestPort };
    for (const [key, value] of Object.entries(request.headers))
      if (allowedRequest.has(key)) headers[key] = value;
    return headers;
  }
  private async proxy(request: IncomingMessage, response: ServerResponse) {
    const upstream = await this.request(request.method || 'GET', request.url || '/', this.headers(request));
    upstream.on('response', (received) => {
      const headers = Object.fromEntries(
        Object.entries(received.headers).filter(([key]) => !blockedResponse.has(key)),
      );
      response.writeHead(received.statusCode || 502, {
        ...headers,
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy':
          "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; connect-src 'self'; frame-src 'none'",
      });
      received.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end('Preview unavailable');
    });
    response.once('close', () => upstream.destroy());
    request.pipe(upstream);
  }
  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const headers = this.headers(request);
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
    const upstream = await this.request('GET', request.url || '/', headers);
    upstream.on('upgrade', (response, stream, upstreamHead) => {
      try {
        this.check();
      } catch {
        upstream.destroy();
        stream.destroy();
        socket.destroy();
        return;
      }
      this.track(stream);
      const allowed = ['upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol'];
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          allowed
            .filter((key) => response.headers[key])
            .map((key) => key + ': ' + response.headers[key])
            .join('\r\n') +
          '\r\n\r\n',
      );
      if (head.length) stream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(stream).pipe(socket);
      socket.once('close', () => stream.destroy());
    });
    upstream.once('response', () => {
      upstream.destroy();
      socket.destroy();
    });
    upstream.once('error', () => socket.destroy());
    upstream.end();
  }
  /** 消费真实 HTTP 响应判定就绪。 Determines readiness from an actual HTTP response. */
  async health(path: string) {
    const request = await this.request('GET', path, {
      host: '127.0.0.1:' + this.guestPort,
      connection: 'close',
    });
    return new Promise<boolean>((resolve, reject) => {
      request.once('response', (response) => {
        const okay = !!response.statusCode && response.statusCode >= 200 && response.statusCode < 400;
        response.resume();
        response.once('end', () => resolve(okay));
      });
      request.once('error', reject);
      request.end();
    });
  }
  /** 撤销入口并关闭 HTTP、WebSocket 和 SSH 流。 Revokes ingress and closes HTTP, WebSocket, and SSH streams. */
  async close() {
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    await this.networking.close();
  }
}

import { randomUUID } from 'node:crypto';
import {
  createServer as createHttpServer,
  request,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { Duplex } from 'node:stream';
import { join } from 'node:path';
import { z } from 'zod';
import {
  ingressActionSchema,
  ingressAlias,
  ingressEntrySchema,
  type IngressAction,
  type IngressEntry,
  type IngressHealth,
  type IngressView,
} from '../shared/http-ingress.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA, PORT } from './model.ts';
import type { Machines } from './machines.ts';
import type { IngressCertificates } from './ingress-certificates.ts';

const OWNER = 'http-ingress';
const storedSchema = z.array(ingressEntrySchema).max(24);
const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'forwarded',
]);

function cleanHeaders(headers: IncomingMessage['headers']) {
  const next = { ...headers };
  const listed = String(headers.connection || '')
    .split(',')
    .map((value) => value.trim().toLowerCase());
  for (const key of Object.keys(next)) {
    if (hopHeaders.has(key) || listed.includes(key) || key.startsWith('x-forwarded-')) delete next[key];
  }
  return next;
}

function matching(path: string, prefix: string) {
  return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
}

function localClient(req: IncomingMessage, port: number, aliases: Set<string>) {
  const host = req.headers.host?.toLowerCase();
  if (host && host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && !aliases.has(host))
    return false;
  if (!req.headers.origin) return true;
  if (!host) return false;
  try {
    const origin = new URL(req.headers.origin);
    return origin.host.toLowerCase() === host &&
      origin.protocol === ((req.socket as { encrypted?: boolean }).encrypted ? 'https:' : 'http:');
  } catch {
    return false;
  }
}

export class HttpIngress {
  private entries: IngressEntry[] = [];
  private listeners = new Map<number, Server>();
  private sockets = new Map<number, Set<Duplex>>();
  private probes = new Set<ClientRequest>();
  private listenerErrors: Record<string, string> = {};
  private health = new Map<string, IngressHealth>();
  private timer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private closed = false;

  constructor(
    private machines: Machines,
    private file = join(DATA, 'plugins', 'network', 'ingress.json'),
    private certificates?: IngressCertificates,
  ) {}

  async init() {
    this.entries = storedSchema.parse(await readStore(this.file, () => []));
    if (this.certificates)
      this.unsubscribe = this.certificates.onChange((certificate) => {
        for (const [port, server] of this.listeners)
          if (this.entries.some((entry) => entry.listenPort === port && entry.protocol === 'https'))
            (server as HttpsServer).setSecureContext({ key: certificate.key, cert: certificate.cert });
      });
    for (const port of new Set(this.entries.map((entry) => entry.listenPort))) {
      try {
        const protocols = new Set(
          this.entries.filter((entry) => entry.listenPort === port).map((entry) => entry.protocol),
        );
        if (protocols.size !== 1) throw new AppError('同一端口不能混用 HTTP 与 HTTPS', 409);
        this.machines.reserveHostPorts(OWNER, [...this.listeners.keys(), port]);
        if (protocols.has('https')) {
          if (!this.certificates) throw new AppError('HTTPS 证书服务未启用', 503);
          await this.certificates.ensure(
            this.entries.some((entry) => entry.listenPort === port && entry.domainAlias),
          );
        }
        this.listeners.set(port, await this.listen(port, [...protocols][0]));
      } catch (error) {
        this.machines.reserveHostPorts(OWNER, this.listeners.keys());
        this.listenerErrors[String(port)] = (error as Error).message;
      }
    }
    this.timer = setInterval(() => void this.checkAll().catch(() => {}), 15000);
    this.timer.unref();
    void this.checkAll().catch(() => {});
  }

  view(): IngressView {
    return {
      entries: this.entries.map((entry) => ({
        ...entry,
        url: `${entry.protocol}://${entry.domainAlias ? ingressAlias(entry.id) : '127.0.0.1'}:${entry.listenPort}${entry.pathPrefix}`,
        health: this.availability(entry) || this.health.get(entry.id) || { status: 'checking' },
      })),
      listenerErrors: { ...this.listenerErrors },
    };
  }

  async action(input: unknown): Promise<IngressView> {
    const action = ingressActionSchema.parse(input) as IngressAction;
    if (action.action === 'check') {
      const entries = action.id ? this.entries.filter((entry) => entry.id === action.id) : this.entries;
      if (action.id && !entries.length) throw new AppError('服务入口不存在', 404);
      await Promise.all(entries.map((entry) => this.check(entry)));
      return this.view();
    }
    return this.machines.locked('launch', async () => {
      if (this.closed) throw new AppError('入口服务正在关闭', 503);
      let next: IngressEntry[];
      if (action.action === 'delete') {
        if (!this.entries.some((entry) => entry.id === action.id)) throw new AppError('服务入口不存在', 404);
        next = this.entries.filter((entry) => entry.id !== action.id);
      } else {
        const input = action.entry;
        const current = input.id ? this.entries.find((entry) => entry.id === input.id) : undefined;
        if (input.id && !current) throw new AppError('服务入口不存在', 404);
        const vm = this.machines.get(input.vmId);
        if (vm.sandbox || vm.rescueOf) throw new AppError('此实例不能发布服务入口', 409);
        if (!vm.forwards.some((forward) => forward.host === input.upstreamPort))
          throw new AppError('上游端口须先在此实例的端口转发中声明', 409);
        if (input.listenPort === PORT) throw new AppError('入口端口不能占用 Sakura 控制端口', 409);
        const timestamp = new Date().toISOString();
        const entry: IngressEntry = {
          ...input,
          id: current?.id || randomUUID(),
          createdAt: current?.createdAt || timestamp,
          updatedAt: timestamp,
        };
        next = [...this.entries.filter((item) => item.id !== entry.id), entry];
      }
      if (next.length > 24 || new Set(next.map((entry) => entry.listenPort)).size > 4)
        throw new AppError('最多保存 24 条入口规则和 4 个监听端口', 409);
      const keys = next.map(
        (entry) => `${entry.listenPort}:${entry.domainAlias ? ingressAlias(entry.id) : 'loopback'}:${entry.pathPrefix}`,
      );
      if (new Set(keys).size !== keys.length) throw new AppError('监听端口与路径组合不能重复', 409);
      for (const port of new Set(next.map((entry) => entry.listenPort))) {
        const protocol = new Set(next.filter((entry) => entry.listenPort === port).map((entry) => entry.protocol));
        if (protocol.size !== 1) throw new AppError('同一端口不能混用 HTTP 与 HTTPS', 409);
        const active = this.entries.find((entry) => entry.listenPort === port)?.protocol;
        if (this.listeners.has(port) && active !== [...protocol][0])
          throw new AppError('切换 HTTP/HTTPS 时请先删除旧入口，或使用新的监听端口', 409);
      }
      if (next.some((entry) => entry.protocol === 'https') && !this.certificates)
        throw new AppError('HTTPS 证书服务未启用', 503);
      await this.apply(next);
      return this.view();
    });
  }

  private async apply(next: IngressEntry[]) {
    const oldPorts = [...this.listeners.keys()];
    const nextPorts = [...new Set(next.map((entry) => entry.listenPort))];
    const added = new Map<number, Server>();
    this.machines.reserveHostPorts(OWNER, nextPorts);
    try {
      if (next.some((entry) => entry.protocol === 'https' && entry.domainAlias))
        await this.certificates!.ensure(true);
      for (const port of nextPorts) {
        if (this.listeners.has(port)) continue;
        const protocol = next.find((entry) => entry.listenPort === port)!.protocol;
        if (protocol === 'https') await this.certificates!.ensure();
        added.set(port, await this.listen(port, protocol));
      }
      await writeStore(this.file, next);
    } catch (error) {
      for (const [port, server] of added) await this.closeListener(port, server);
      this.machines.reserveHostPorts(OWNER, oldPorts);
      throw error;
    }
    this.entries = next;
    for (const [port, server] of added) this.listeners.set(port, server);
    for (const [port, server] of this.listeners) {
      if (nextPorts.includes(port)) continue;
      this.listeners.delete(port);
      await this.closeListener(port, server);
    }
    this.listenerErrors = {};
    this.health.clear();
    void this.checkAll().catch(() => {});
  }

  private listen(port: number, protocol: 'http' | 'https') {
    const listener = (req: IncomingMessage, res: ServerResponse) => this.proxy(req, res, port);
    const server: Server =
      protocol === 'https'
        ? createHttpsServer(this.certificates!.tlsOptions(), listener)
        : createHttpServer(listener);
    server.on('error', (error) => {
      this.listenerErrors[String(port)] = error.message;
    });
    server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head, port));
    server.on('connection', (socket) => this.trackSocket(port, socket));
    return new Promise<Server>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  }

  private trackSocket(port: number, socket: Duplex) {
    const sockets = this.sockets.get(port) || new Set<Duplex>();
    sockets.add(socket);
    this.sockets.set(port, sockets);
    socket.once('close', () => sockets.delete(socket));
  }

  private closeListener(port: number, server: Server) {
    for (const socket of this.sockets.get(port) || []) socket.destroy();
    this.sockets.delete(port);
    return new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }

  private aliases(port: number) {
    return new Set(
      this.entries
        .filter((entry) => entry.listenPort === port && entry.domainAlias)
        .map((entry) => `${ingressAlias(entry.id)}:${port}`),
    );
  }

  private target(req: IncomingMessage, port: number) {
    const raw = req.url || '/';
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    const url = new URL(raw, 'http://127.0.0.1');
    const host = req.headers.host?.toLowerCase().replace(new RegExp(`:${port}$`), '') || '127.0.0.1';
    const entry = this.entries
      .filter((candidate) =>
        candidate.listenPort === port &&
        matching(url.pathname, candidate.pathPrefix) &&
        (candidate.domainAlias
          ? ingressAlias(candidate.id) === host
          : host === '127.0.0.1' || host === 'localhost'),
      )
      .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length)[0];
    if (!entry) return null;
    const path =
      entry.stripPrefix && entry.pathPrefix !== '/'
        ? url.pathname.slice(entry.pathPrefix.length) || '/'
        : url.pathname;
    return { entry, path: `${path}${url.search}` };
  }

  private availability(entry: IngressEntry): IngressHealth | null {
    if (this.listenerErrors[String(entry.listenPort)])
      return { status: 'unhealthy', error: this.listenerErrors[String(entry.listenPort)] };
    if (!this.listeners.has(entry.listenPort))
      return {
        status: 'unhealthy',
        error: this.listenerErrors[String(entry.listenPort)] || '监听端口不可用',
      };
    try {
      const vm = this.machines.get(entry.vmId);
      if (!vm.forwards.some((forward) => forward.host === entry.upstreamPort))
        return { status: 'unconfigured', error: '上游端口转发已移除' };
      if (this.machines.state(entry.vmId) !== 'running') return { status: 'stopped' };
    } catch {
      return { status: 'unconfigured', error: '实例已移除' };
    }
    return null;
  }

  private proxy(req: IncomingMessage, res: ServerResponse, port: number) {
    if (!localClient(req, port, this.aliases(port))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const target = this.target(req, port);
    if (!target) {
      res.writeHead(404).end('Not found');
      return;
    }
    if (this.availability(target.entry)) {
      res.writeHead(503).end('Upstream unavailable');
      return;
    }
    const headers = cleanHeaders(req.headers);
    headers.host = `127.0.0.1:${target.entry.upstreamPort}`;
    headers['x-forwarded-for'] = '127.0.0.1';
    headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${port}`;
    headers['x-forwarded-proto'] = target.entry.protocol;
    if (target.entry.pathPrefix !== '/') headers['x-forwarded-prefix'] = target.entry.pathPrefix;
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: target.entry.upstreamPort,
        method: req.method,
        path: target.path,
        headers,
        timeout: 120000,
      },
      (response) => {
        const responseHeaders = cleanHeaders(response.headers);
        res.writeHead(response.statusCode || 502, responseHeaders);
        response.on('aborted', () => res.destroy());
        response.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Bad gateway');
      else res.destroy();
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream timeout')));
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer, port: number) {
    if (!localClient(req, port, this.aliases(port))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const target = this.target(req, port);
    if (!target || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (this.availability(target.entry)) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    const headers = cleanHeaders(req.headers);
    headers.host = `127.0.0.1:${target.entry.upstreamPort}`;
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
    headers['x-forwarded-for'] = '127.0.0.1';
    headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${port}`;
    headers['x-forwarded-proto'] = target.entry.protocol;
    const upstream = request({
      hostname: '127.0.0.1',
      port: target.entry.upstreamPort,
      path: target.path,
      method: req.method,
      headers,
      timeout: 30000,
    });
    upstream.on('upgrade', (response, peer, peerHead) => {
      this.trackSocket(port, peer);
      const lines = [
        `HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}`,
      ];
      for (let i = 0; i < response.rawHeaders.length; i += 2)
        lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) peer.write(head);
      if (peerHead.length) socket.write(peerHead);
      peer.pipe(socket).pipe(peer);
    });
    upstream.on('response', (response) => {
      response.resume();
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    upstream.on('error', () => socket.destroy());
    upstream.on('timeout', () => upstream.destroy());
    socket.once('close', () => upstream.destroy());
    upstream.end();
  }

  private async check(entry: IngressEntry) {
    const unavailable = this.availability(entry);
    if (unavailable) {
      this.health.set(entry.id, unavailable);
      return;
    }
    const status = await new Promise<IngressHealth>((resolve) => {
      const probe = request(
        {
          hostname: '127.0.0.1',
          port: entry.upstreamPort,
          path: entry.healthPath,
          method: 'GET',
          timeout: 3000,
        },
        (response) => {
          response.resume();
          resolve({
            status: response.statusCode && response.statusCode < 400 ? 'healthy' : 'unhealthy',
            httpStatus: response.statusCode,
            checkedAt: new Date().toISOString(),
          });
        },
      );
      this.probes.add(probe);
      probe.once('close', () => this.probes.delete(probe));
      probe.on('timeout', () => probe.destroy(new Error('健康检查超时')));
      probe.on('error', (error) =>
        resolve({
          status: 'unhealthy',
          error: error.message,
          checkedAt: new Date().toISOString(),
        }),
      );
      probe.end();
    });
    if (this.entries.includes(entry)) this.health.set(entry.id, status);
  }

  private async checkAll() {
    await Promise.all(this.entries.map((entry) => this.check(entry)));
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const probe of this.probes) probe.destroy();
    const hadListeners = this.listeners.size > 0;
    await Promise.all([...this.listeners].map(([port, server]) => this.closeListener(port, server)));
    this.listeners.clear();
    if (hadListeners) this.machines.reserveHostPorts(OWNER, []);
    this.unsubscribe?.();
  }
}

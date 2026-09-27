import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { request as httpsRequest, createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { createSecureContext, type TLSSocket } from 'node:tls';
import { generate } from 'selfsigned';
import { z } from 'zod';
import { readJsonBody } from './http.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fingerprint = z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const hostName = z.string().trim().min(1).max(128);
const listenerSchema = z.object({
  enabled: z.boolean(), host: z.enum(['127.0.0.1', '0.0.0.0']),
  port: z.number().int().min(1024).max(65535),
}).strict();
const peerUrl = z.string().max(512).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !!url.port &&
      Number(url.port) >= 1024 && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}, '请输入带端口的 HTTPS 主机地址，不能包含路径或凭据');
const certificateSchema = z.object({
  key: z.string().min(100).max(16000), cert: z.string().min(100).max(16000),
}).strict();
const incomingSchema = z.object({
  id: z.uuid(), requesterId: z.uuid(), name: hostName,
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().nonnegative(),
}).strict();
const outboundSchema = z.object({
  id: z.uuid(), remoteId: z.uuid(), name: hostName, url: peerUrl,
  fingerprint, token: tokenSchema, createdAt: z.number().int().nonnegative(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1), hostId: z.uuid(), name: hostName,
  certificate: certificateSchema, listener: listenerSchema,
  incoming: z.array(incomingSchema).max(16), outbound: z.array(outboundSchema).max(16),
}).strict();
const statusSchema = z.object({
  version: z.literal(1), id: z.uuid(), name: hostName,
  platform: z.string().min(1).max(32), arch: z.string().min(1).max(32),
  cpus: z.number().int().min(1).max(4096),
  memoryTotal: z.number().int().nonnegative(), memoryFree: z.number().int().nonnegative(),
  load: z.array(z.number().finite().nonnegative()).length(3),
  vmCount: z.number().int().nonnegative(), runningVms: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(),
}).strict();
export type PeerStatus = z.infer<typeof statusSchema>;
type Store = z.infer<typeof storeSchema>;
type Observation = { status?: PeerStatus; error?: string; checkedAt: number; lastSuccessAt?: number };
const pairInput = z.object({ code: z.string().regex(/^[A-F0-9]{10}$/),
  requesterId: z.uuid(), name: hostName }).strict();
const pairResponse = z.object({ id: z.uuid(), name: hostName, token: tokenSchema }).strict();
export const hostPeerRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('listener'), listener: listenerSchema }).strict(),
  z.object({ operation: z.literal('create-code') }).strict(),
  z.object({ operation: z.literal('revoke-code') }).strict(),
  z.object({ operation: z.literal('connect'), url: peerUrl, fingerprint,
    code: pairInput.shape.code }).strict(),
  z.object({ operation: z.literal('remove-outbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('revoke-inbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('refresh') }).strict(),
]);

async function initial(name: string): Promise<Store> {
  const certificate = await generate([{ name: 'commonName', value: 'Sakura Peer' }], {
    keyType: 'ec', curve: 'P-256', algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 3600_000),
    notAfterDate: new Date(Date.now() + 5 * 365 * 86400_000),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
    ],
  });
  return { version: 1, hostId: randomUUID(), name,
    certificate: { key: certificate.private, cert: certificate.cert },
    listener: { enabled: false, host: '127.0.0.1', port: 7443 },
    incoming: [], outbound: [],
  };
}

function requestPeer(urlText: string, pin: string, path: string, method: 'GET' | 'POST',
  payload?: unknown, token?: string): Promise<unknown> {
  const url = new URL(path, urlText);
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method, agent: false, rejectUnauthorized: false, signal: AbortSignal.timeout(10_000),
      headers: {
        ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 64 * 1024) request.destroy(new AppError('远端响应超过上限', 502));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
            throw new AppError(`远端返回 HTTP ${response.statusCode || 0}`, 502);
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.once('socket', (socket) => {
      socket.once('secureConnect', () => {
        const raw = (socket as TLSSocket).getPeerCertificate(true)?.raw;
        const certificate = raw ? new X509Certificate(raw) : null;
        const actual = certificate?.fingerprint256 || '';
        if (actual !== pin) request.destroy(new AppError('远端证书指纹不匹配', 409));
        else if (Date.parse(certificate!.validFrom) > Date.now() ||
            Date.parse(certificate!.validTo) <= Date.now())
          request.destroy(new AppError('远端证书尚未生效或已过期', 409));
        else request.end(body);
      });
    });
    request.on('error', reject);
  });
}

export class HostPeers {
  private state!: Store;
  private server?: HttpsServer;
  private timer?: NodeJS.Timeout;
  private code?: { value: string; expiresAt: number };
  private attempts = new Map<string, { count: number; until: number }>();
  private observations = new Map<string, Observation>();
  private writes: Promise<unknown> = Promise.resolve();
  private refreshing?: Promise<void>;
  private closed = false;
  private listenerError?: string;
  constructor(
    private snapshot: () => Promise<Omit<PeerStatus, 'version' | 'id' | 'name' | 'checkedAt'>>,
    private file = join(DATA, 'host-peers.json'),
    private name = 'Sakura',
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private now = Date.now,
  ) {}

  async init(schedule = true) {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 1024 * 1024))
      throw new AppError('主机配对存储类型或大小无效');
    this.state = info ? storeSchema.parse(await readStore(this.file, () => { throw new Error('missing'); })) :
      await initial(this.name);
    if (new Set(this.state.incoming.map((item) => item.id)).size !== this.state.incoming.length ||
        new Set(this.state.outbound.map((item) => item.id)).size !== this.state.outbound.length ||
        new Set(this.state.outbound.map((item) => item.remoteId)).size !== this.state.outbound.length)
      throw new AppError('主机配对记录重复');
    createSecureContext(this.state.certificate);
    if (!info) await writeStore(this.file, this.state);
    if (schedule && this.state.listener.enabled) {
      try { await this.listen(); }
      catch (error) { this.listenerError = (error as Error).message; }
    }
    if (schedule) {
      this.timer = setInterval(() => void this.refresh(), 30_000);
      this.timer.unref();
      void this.refresh();
    }
  }

  private async listen() {
    const server = createHttpsServer({ ...this.state.certificate, minVersion: 'TLSv1.2' },
      (request, response) => void this.peerRoute(request, response));
    server.requestTimeout = 10_000;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(this.state.listener.port, this.state.listener.host, () => {
          server.off('error', reject); resolve();
        });
      });
      this.server = server;
      server.on('error', (error) => { this.listenerError = error.message; });
    } catch (error) {
      server.close();
      throw error;
    }
  }

  private send(response: ServerResponse, payload: unknown, status = 200) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(payload));
  }

  private async peerRoute(request: IncomingMessage, response: ServerResponse) {
    try {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (request.method === 'POST' && request.url === '/peer/pair') {
        const address = request.socket.remoteAddress || 'unknown';
        const attempt = this.attempts.get(address);
        if (!attempt && this.attempts.size >= 1024)
          for (const [key, item] of this.attempts)
            if (item.until <= this.now()) this.attempts.delete(key);
        if (!attempt && this.attempts.size >= 1024)
          throw new AppError('配对尝试容量已满', 429);
        if (attempt && attempt.until > this.now() && attempt.count >= 5)
          throw new AppError('配对尝试过多，请稍后重试', 429);
        this.attempts.set(address, {
          count: attempt?.until && attempt.until > this.now() ? attempt.count + 1 : 1,
          until: this.now() + 300_000,
        });
        if (this.attempts.size > 1024)
          for (const [key, value] of this.attempts) if (value.until <= this.now()) this.attempts.delete(key);
        const value = pairInput.parse(await readJsonBody(request, 4096));
        this.mutation(1);
        try {
          const result = await this.change((next) => {
            if (!this.code || this.code.expiresAt <= this.now() ||
                !timingSafeEqual(Buffer.from(this.code.value), Buffer.from(value.code)))
              throw new AppError('配对码无效或已过期', 403);
            if (value.requesterId === next.hostId) throw new AppError('不能配对本机', 409);
            if (next.incoming.length >= 16) throw new AppError('已达到入站配对上限', 409);
            const token = randomBytes(32).toString('hex');
            next.incoming.push({ id: randomUUID(), requesterId: value.requesterId,
              name: value.name, tokenHash: hash(token), createdAt: this.now() });
            return { id: next.hostId, name: next.name, token };
          });
          this.code = undefined;
          return this.send(response, result);
        } finally { this.mutation(-1); }
      }
      if (request.method === 'GET' && request.url === '/peer/status') {
        const credential = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization || ''))?.[1];
        const digest = credential ? Buffer.from(hash(credential), 'hex') : null;
        if (!digest || !this.state.incoming.some((entry) =>
          timingSafeEqual(digest, Buffer.from(entry.tokenHash, 'hex'))))
          throw new AppError('同伴凭证无效', 401);
        return this.send(response, await this.status());
      }
      throw new AppError('未找到同伴接口', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 400;
      this.send(response, { error: status >= 500 ? '同伴请求失败' : (error as Error).message }, status);
    }
  }

  private change<T>(edit: (next: Store) => T): Promise<T> {
    const work = this.writes.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      const next = structuredClone(this.state);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
    this.writes = work;
    return work;
  }

  private codeChange(edit: () => void) {
    const work = this.writes.catch(() => {}).then(() => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      edit();
      return this.view();
    });
    this.writes = work;
    return work;
  }

  view() {
    return {
      hostId: this.state.hostId, name: this.state.name,
      fingerprint: new X509Certificate(this.state.certificate.cert).fingerprint256,
      listener: { ...this.state.listener, active: !!this.server,
        ...(this.listenerError ? { error: this.listenerError } : {}) },
      pairing: this.code && this.code.expiresAt > this.now() ? { ...this.code } : null,
      incoming: this.state.incoming.map(({ tokenHash, ...entry }) => entry),
      outbound: this.state.outbound.map(({ token, ...entry }) => ({ ...entry,
        observation: this.observations.get(entry.id) || null })),
    };
  }

  async status(): Promise<PeerStatus> {
    return statusSchema.parse({ version: 1, id: this.state.hostId,
      name: this.state.name, ...await this.snapshot(),
      checkedAt: new Date(this.now()).toISOString() });
  }

  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = hostPeerRequest.parse(input);
    if (value.operation === 'refresh') { await this.refresh(); return this.view(); }
    if (value.operation === 'create-code') return this.codeChange(() => {
      if (!this.server) throw new AppError('请先启用同伴入口并重启 Sakura 服务', 409);
      this.code = { value: randomBytes(5).toString('hex').toUpperCase(),
        expiresAt: this.now() + 300_000 };
    });
    if (value.operation === 'revoke-code') return this.codeChange(() => { this.code = undefined; });
    this.mutation(1);
    try {
      if (value.operation === 'connect') {
        if (value.fingerprint === this.view().fingerprint)
          throw new AppError('不能配对本机证书', 409);
        if (this.state.outbound.some((peer) => peer.url === value.url))
          throw new AppError('此地址已配对', 409);
        const result = pairResponse.parse(await requestPeer(value.url, value.fingerprint,
          '/peer/pair', 'POST', { code: value.code, requesterId: this.state.hostId,
            name: this.state.name }));
        if (result.id === this.state.hostId) throw new AppError('不能配对本机', 409);
        const peer = await this.change((next) => {
          if (next.outbound.some((item) => item.remoteId === result.id || item.url === value.url))
            throw new AppError('此主机已配对', 409);
          if (next.outbound.length >= 16) throw new AppError('已达到出站主机上限', 409);
          const item = { id: randomUUID(), remoteId: result.id, name: result.name,
            url: value.url, fingerprint: value.fingerprint, token: result.token,
            createdAt: this.now() };
          next.outbound.push(item);
          return item;
        });
        await this.poll(peer);
        return this.view();
      }
      await this.change((next) => {
        if (value.operation === 'listener') next.listener = value.listener;
        else if (value.operation === 'remove-outbound') {
          if (!next.outbound.some((item) => item.id === value.id))
            throw new AppError('远端主机不存在', 404);
          next.outbound = next.outbound.filter((item) => item.id !== value.id);
        } else if (value.operation === 'revoke-inbound') {
          if (!next.incoming.some((item) => item.id === value.id))
            throw new AppError('入站配对不存在', 404);
          next.incoming = next.incoming.filter((item) => item.id !== value.id);
        }
      });
      if (value.operation === 'remove-outbound') this.observations.delete(value.id);
      return this.view();
    } finally { this.mutation(-1); }
  }

  private async poll(peer: Store['outbound'][number]) {
    const checkedAt = this.now();
    try {
      const status = statusSchema.parse(await requestPeer(peer.url, peer.fingerprint,
        '/peer/status', 'GET', undefined, peer.token));
      if (status.id !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
      if (this.state.outbound.some((item) => item.id === peer.id))
        this.observations.set(peer.id, { status, checkedAt, lastSuccessAt: checkedAt });
    } catch (error) {
      const previous = this.observations.get(peer.id);
      if (this.state.outbound.some((item) => item.id === peer.id))
        this.observations.set(peer.id, { ...previous, checkedAt,
          error: String((error as Error).message || error).slice(0, 200) });
    }
  }

  async refresh() {
    if (this.closed || this.blocked()) return;
    if (this.refreshing) return this.refreshing;
    const task = Promise.all(this.state.outbound.map((peer) => this.poll(peer))).then(() => {});
    this.refreshing = task.finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  async close() {
    this.closed = true;
    this.code = undefined;
    if (this.timer) clearInterval(this.timer);
    if (this.server) {
      const closing = new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server.closeAllConnections();
      await closing;
    }
    await this.refreshing;
    await this.writes.catch(() => {});
  }
}

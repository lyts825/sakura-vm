import { createHash, randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { request as httpsRequest, createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { createSecureContext, type TLSSocket } from 'node:tls';
import type { Writable } from 'node:stream';
import { generate } from 'selfsigned';
import { z } from 'zod';
import { readJsonBody } from './http.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, createSchema, DATA } from './model.ts';
import { featureRolloutRequest } from './feature-rollouts.ts';

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
  allowImport: z.boolean().default(false),
  allowPolicy: z.boolean().default(false),
  allowActivate: z.boolean().default(false),
  allowFailover: z.boolean().default(false),
}).strict();
const rolloutPolicySchema = z.object({
  pluginId: z.string().min(1).max(128), enabled: z.boolean(),
  percentage: z.number().int().min(0).max(100), cohortVersion: z.string().min(1).max(64),
  revision: z.number().int().positive(), updatedAt: z.number().int().nonnegative(),
}).strict();
const rolloutViewSchema = z.object({ hostId: z.uuid(),
  policies: z.array(rolloutPolicySchema).max(128) }).strict();
export type PeerRolloutView = z.infer<typeof rolloutViewSchema>;
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
const importReceiptSchema = z.object({
  id: z.uuid(), name: createSchema.shape.name,
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceVmId: z.uuid().optional(), snapshotId: z.uuid().optional(),
}).strict();
type ImportReceipt = z.infer<typeof importReceiptSchema>;
type ImportIdentity = { transferId: string; requesterId: string };
const activateInput = z.object({ transferId: z.uuid(), remoteVmId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const replicaActivateInput = activateInput.safeExtend({
  sourceVmId: z.uuid(), snapshotId: z.uuid(),
});
const activateResult = z.object({ id: z.uuid(), status: z.enum([
  'stopped', 'starting', 'running', 'paused', 'stopping', 'error',
]) }).strict();
const activateCheckResult = z.object({ ready: z.literal(true), id: z.uuid(),
  status: activateResult.shape.status }).strict();
const retireResult = z.object({ id: z.uuid(), retired: z.literal(true) }).strict();
type ImportReceiver = {
  status: (identity: ImportIdentity) => Promise<ImportReceipt | null>;
  receive: (input: ImportIdentity & { name: string; sourceVmId?: string; snapshotId?: string;
    source: IncomingMessage;
    signal: AbortSignal }) => Promise<ImportReceipt>;
  activate?: (input: ImportIdentity & { remoteVmId: string; sha256: string }) =>
    Promise<z.infer<typeof activateResult>>;
  inspectActivation?: (input: ImportIdentity & { remoteVmId: string; sha256: string }) =>
    Promise<z.infer<typeof activateResult>>;
  activateReplica?: (input: ImportIdentity & z.infer<typeof replicaActivateInput>) =>
    Promise<z.infer<typeof activateResult>>;
  inspectReplicaActivation?: (input: ImportIdentity & z.infer<typeof replicaActivateInput>) =>
    Promise<z.infer<typeof activateResult>>;
  retireReplica?: (input: ImportIdentity & z.infer<typeof replicaActivateInput>) =>
    Promise<z.infer<typeof retireResult>>;
};
const pairInput = z.object({ code: z.string().regex(/^[A-F0-9]{10}$/),
  requesterId: z.uuid(), name: hostName }).strict();
const pairResponse = z.object({ id: z.uuid(), name: hostName, token: tokenSchema }).strict();
export const hostScoreInput = z.object({
  cpus: z.number().int().min(1).max(128),
  memoryMiB: z.number().int().min(256).max(131072),
}).strict();
export type HostScoreInput = z.infer<typeof hostScoreInput>;
export const hostPeerRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('listener'), listener: listenerSchema }).strict(),
  z.object({ operation: z.literal('create-code') }).strict(),
  z.object({ operation: z.literal('revoke-code') }).strict(),
  z.object({ operation: z.literal('connect'), url: peerUrl, fingerprint,
    code: pairInput.shape.code }).strict(),
  z.object({ operation: z.literal('remove-outbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('revoke-inbound'), id: z.uuid() }).strict(),
  z.object({ operation: z.literal('allow-import'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-policy'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-activate'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('allow-failover'), id: z.uuid(), enabled: z.boolean() }).strict(),
  z.object({ operation: z.literal('refresh') }).strict(),
  z.object({ operation: z.literal('score'), requirements: hostScoreInput }).strict(),
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

function checkPinnedCertificate(socket: TLSSocket, pin: string) {
  const raw = socket.getPeerCertificate(true)?.raw;
  const certificate = raw ? new X509Certificate(raw) : null;
  if (certificate?.fingerprint256 !== pin)
    throw new AppError('远端证书指纹不匹配', 409);
  if (Date.parse(certificate.validFrom) > Date.now() ||
      Date.parse(certificate.validTo) <= Date.now())
    throw new AppError('远端证书尚未生效或已过期', 409);
}

function requestPeer(urlText: string, pin: string, path: string, method: 'GET' | 'POST',
  payload?: unknown, token?: string, timeoutMs = 10_000): Promise<unknown> {
  const url = new URL(path, urlText);
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method, agent: false, rejectUnauthorized: false, signal: AbortSignal.timeout(timeoutMs),
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
        try { checkPinnedCertificate(socket as TLSSocket, pin); request.end(body); }
        catch (error) { request.destroy(error as Error); }
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
  private importReceiver?: ImportReceiver;
  private rolloutReceiver?: { view: () => PeerRolloutView; save: (input: unknown) => Promise<unknown> };
  private mobileHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  private activeImports = new Map<string, Set<AbortController>>();
  private transferIds = new Set<string>();
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
      if (request.url === '/mobile' || request.url?.startsWith('/mobile/')) {
        if (!this.mobileHandler) throw new AppError('移动伴侣尚未启用', 503);
        return await this.mobileHandler(request, response);
      }
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
              name: value.name, tokenHash: hash(token), createdAt: this.now(),
              allowImport: false, allowPolicy: false, allowActivate: false,
              allowFailover: false });
            return { id: next.hostId, name: next.name, token };
          });
          this.code = undefined;
          return this.send(response, result);
        } finally { this.mutation(-1); }
      }
      if (request.method === 'GET' && request.url === '/peer/status') {
        this.inbound(request);
        return this.send(response, await this.status());
      }
      if (request.url === '/peer/rollouts' && ['GET', 'POST'].includes(request.method || '')) {
        const peer = this.inbound(request);
        if (!peer.allowPolicy) throw new AppError('此同伴未获策略发布权限', 403);
        if (!this.rolloutReceiver) throw new AppError('目标主机尚未启用策略接收器', 503);
        if (request.method === 'GET') return this.send(response, this.rolloutReceiver.view());
        const input = featureRolloutRequest.parse(await readJsonBody(request, 4096));
        if (input.operation !== 'save') throw new AppError('同伴只能发布灰度策略', 400);
        if (!this.inbound(request).allowPolicy) throw new AppError('策略发布权限已撤销', 403);
        this.mutation(1);
        try {
          await this.rolloutReceiver.save(input);
          return this.send(response, this.rolloutReceiver.view());
        } finally { this.mutation(-1); }
      }
      if (request.method === 'GET' && request.url?.startsWith('/peer/import-status?')) {
        const peer = this.inbound(request);
        if (!peer.allowImport) throw new AppError('此同伴未获导入权限', 403);
        if (!this.importReceiver) throw new AppError('目标主机尚未启用迁移接收器', 503);
        const url = new URL(request.url, 'https://peer.invalid');
        if (url.pathname !== '/peer/import-status' ||
            [...url.searchParams.keys()].some((key) => key !== 'id') ||
            url.searchParams.getAll('id').length !== 1)
          throw new AppError('无效的迁移状态请求');
        const transferId = z.uuid().parse(url.searchParams.get('id'));
        return this.send(response, await this.importReceiver.status({
          transferId, requesterId: peer.requesterId }));
      }
      if (request.method === 'POST' &&
          (request.url === '/peer/activate' || request.url === '/peer/activate-check')) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowActivate)
          throw new AppError('此同伴未获目标实例启动权限', 403);
        if (!this.importReceiver?.activate || !this.importReceiver.inspectActivation)
          throw new AppError('目标主机尚未启用实例启动接收器', 503);
        const input = activateInput.parse(await readJsonBody(request, 4096));
        const identity = { transferId: input.transferId, requesterId: peer.requesterId };
        const receipt = await this.importReceiver.status(identity);
        if (!receipt?.sha256 || receipt.id !== input.remoteVmId ||
            receipt.sha256 !== input.sha256)
          throw new AppError('目标实例与已校验的导入回执不一致', 409);
        if (receipt.sourceVmId || receipt.snapshotId)
          throw new AppError('快照复制副本不能通过冷迁移目标启动接口启动', 409);
        const current = this.inbound(request);
        if (!current.allowImport || !current.allowActivate)
          throw new AppError('目标实例启动权限已撤销', 403);
        const activationInput = { ...identity, remoteVmId: input.remoteVmId,
          sha256: input.sha256 };
        if (request.url === '/peer/activate-check') {
          const inspected = activateResult.parse(await this.importReceiver.inspectActivation(
            activationInput));
          if (inspected.id !== input.remoteVmId)
            throw new AppError('目标实例启动预检返回了其他实例', 409);
          return this.send(response, { ready: true, id: input.remoteVmId,
            status: inspected.status });
        }
        this.mutation(1);
        try {
          const result = activateResult.parse(await this.importReceiver.activate(activationInput));
          if (result.id !== input.remoteVmId)
            throw new AppError('目标实例启动返回了其他实例', 409);
          return this.send(response, result);
        } finally { this.mutation(-1); }
      }
      if (request.method === 'POST' &&
          (request.url === '/peer/replica-activate' ||
           request.url === '/peer/replica-activate-check' ||
           request.url === '/peer/replica-retire')) {
        const peer = this.inbound(request);
        if (!peer.allowImport || !peer.allowFailover)
          throw new AppError('此同伴未获故障副本启动权限', 403);
        if (!this.importReceiver?.activateReplica ||
            !this.importReceiver.inspectReplicaActivation)
          throw new AppError('目标主机尚未启用故障副本接收器', 503);
        const input = replicaActivateInput.parse(await readJsonBody(request, 4096));
        const identity = { transferId: input.transferId, requesterId: peer.requesterId };
        const receipt = await this.importReceiver.status(identity);
        if (!receipt?.sha256 || receipt.id !== input.remoteVmId ||
            receipt.sha256 !== input.sha256 ||
            receipt.sourceVmId !== input.sourceVmId ||
            receipt.snapshotId !== input.snapshotId)
          throw new AppError('故障副本与已校验的快照回执不一致', 409);
        const current = this.inbound(request);
        if (!current.allowImport || !current.allowFailover)
          throw new AppError('故障副本启动权限已撤销', 403);
        const activationInput = { ...identity, ...input };
        if (request.url === '/peer/replica-retire') {
          if (!this.importReceiver.retireReplica)
            throw new AppError('目标主机尚未启用故障副本退出接口', 503);
          this.mutation(1);
          try {
            const result = retireResult.parse(await this.importReceiver.retireReplica(
              activationInput));
            if (result.id !== input.remoteVmId)
              throw new AppError('故障副本退出返回了其他实例', 409);
            return this.send(response, result);
          } finally { this.mutation(-1); }
        }
        if (request.url === '/peer/replica-activate-check') {
          const inspected = activateResult.parse(await
            this.importReceiver.inspectReplicaActivation(activationInput));
          if (inspected.id !== input.remoteVmId)
            throw new AppError('故障副本预检返回了其他实例', 409);
          return this.send(response, { ready: true, id: input.remoteVmId,
            status: inspected.status });
        }
        this.mutation(1);
        try {
          const result = activateResult.parse(await
            this.importReceiver.activateReplica(activationInput));
          if (result.id !== input.remoteVmId)
            throw new AppError('故障副本启动返回了其他实例', 409);
          return this.send(response, result);
        } finally { this.mutation(-1); }
      }
      if (request.method === 'POST' && request.url === '/peer/import') {
        const peer = this.inbound(request);
        if (!peer.allowImport) throw new AppError('此同伴未获导入权限', 403);
        if (!this.importReceiver) throw new AppError('目标主机尚未启用迁移接收器', 503);
        if (request.headers['content-type'] !== 'application/octet-stream')
          throw new AppError('需要二进制导出包', 415);
        const transferId = z.uuid().parse(request.headers['x-sakura-transfer-id']);
        const name = createSchema.shape.name.parse(request.headers['x-sakura-target-name']);
        const sourceVmId = z.uuid().optional().parse(request.headers['x-sakura-source-vm-id']);
        const snapshotId = z.uuid().optional().parse(request.headers['x-sakura-snapshot-id']);
        if (!!sourceVmId !== !!snapshotId)
          throw new AppError('快照来源必须同时包含实例与快照标识');
        const identity = { transferId, requesterId: peer.requesterId };
        const previous = await this.importReceiver.status(identity);
        if (previous) {
          if (previous.name !== name || previous.sourceVmId !== sourceVmId ||
              previous.snapshotId !== snapshotId)
            throw new AppError('迁移标识已用于其他来源或实例名称', 409);
          return this.send(response, previous);
        }
        const key = `${peer.requesterId}:${transferId}`;
        if (this.transferIds.has(key)) throw new AppError('此迁移任务仍在导入', 409);
        this.transferIds.add(key);
        const controller = new AbortController();
        const active = this.activeImports.get(peer.id) || new Set<AbortController>();
        active.add(controller);
        this.activeImports.set(peer.id, active);
        const abort = () => controller.abort(new AppError('同伴传输已中断', 409));
        request.once('aborted', abort);
        const closed = () => { if (!response.writableEnded) abort(); };
        response.once('close', closed);
        this.mutation(1);
        try {
          const result = await this.importReceiver.receive({ ...identity, name,
            ...(sourceVmId ? { sourceVmId } : {}), ...(snapshotId ? { snapshotId } : {}),
            source: request, signal: controller.signal });
          controller.signal.throwIfAborted();
          return this.send(response, result);
        } finally {
          request.off('aborted', abort);
          response.off('close', closed);
          active.delete(controller);
          if (!active.size) this.activeImports.delete(peer.id);
          this.transferIds.delete(key);
          this.mutation(-1);
        }
      }
      throw new AppError('未找到同伴接口', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 400;
      if (!response.destroyed && !response.headersSent)
        this.send(response, { error: status >= 500 ? '同伴请求失败' : (error as Error).message }, status);
    }
  }

  private inbound(request: IncomingMessage) {
    const credential = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization || ''))?.[1];
    const digest = credential ? Buffer.from(hash(credential), 'hex') : null;
    const peer = digest && this.state.incoming.find((entry) =>
      timingSafeEqual(digest, Buffer.from(entry.tokenHash, 'hex')));
    if (!peer) throw new AppError('同伴凭证无效', 401);
    return peer;
  }

  setImportReceiver(receiver: ImportReceiver) {
    this.importReceiver = receiver;
  }
  setRolloutReceiver(receiver: { view: () => PeerRolloutView; save: (input: unknown) => Promise<unknown> }) {
    this.rolloutReceiver = receiver;
  }
  setMobileHandler(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>) {
    this.mobileHandler = handler;
  }
  async rolloutStatus(peerId: string): Promise<PeerRolloutView> {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = rolloutViewSchema.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/rollouts', 'GET', undefined, peer.token));
    if (result.hostId !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
    return result;
  }
  async publishRollout(peerId: string, input: unknown): Promise<PeerRolloutView> {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = featureRolloutRequest.parse(input);
    if (value.operation !== 'save') throw new AppError('只允许发布灰度策略');
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = rolloutViewSchema.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/rollouts', 'POST', value, peer.token));
    if (result.hostId !== peer.remoteId) throw new AppError('远端主机身份已变化', 409);
    return result;
  }

  async importStatus(peerId: string, transferId: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    z.uuid().parse(transferId);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = await requestPeer(peer.url, peer.fingerprint,
      `/peer/import-status?id=${transferId}`, 'GET', undefined, peer.token);
    return result === null ? null : importReceiptSchema.parse(result);
  }

  async activateImport(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = activateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateResult.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/activate', 'POST', value, peer.token, 30_000));
    if (result.id !== value.remoteVmId)
      throw new AppError('远端目标实例身份已变化', 409);
    return result;
  }

  async checkImportActivation(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = activateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateCheckResult.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/activate-check', 'POST', value, peer.token));
    if (result.id !== value.remoteVmId)
      throw new AppError('远端目标实例身份已变化', 409);
    return result;
  }

  async checkReplicaActivation(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = replicaActivateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateCheckResult.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/replica-activate-check', 'POST', value, peer.token));
    if (result.id !== value.remoteVmId)
      throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }

  async activateReplica(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = replicaActivateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = activateResult.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/replica-activate', 'POST', value, peer.token, 30_000));
    if (result.id !== value.remoteVmId)
      throw new AppError('远端故障副本身份已变化', 409);
    return result;
  }

  async retireReplica(peerId: string, input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = replicaActivateInput.parse(input);
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const result = retireResult.parse(await requestPeer(peer.url, peer.fingerprint,
      '/peer/replica-retire', 'POST', value, peer.token, 30_000));
    if (result.id !== value.remoteVmId)
      throw new AppError('远端故障副本身份已变化', 409);
    return result;
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

  async score(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const requirements = hostScoreInput.parse(input);
    await this.refresh();
    const local = await this.status();
    const entries: Array<{ id: string; name: string; source: 'local' | 'peer';
      status?: PeerStatus; error?: string; observedAt?: number }> = [
      { id: local.id, name: local.name, source: 'local', status: local,
        observedAt: this.now() },
      ...this.state.outbound.map((peer) => {
        const observation = this.observations.get(peer.id);
        return { id: peer.remoteId, name: peer.name, source: 'peer' as const,
          status: observation?.status, error: observation?.error,
          observedAt: observation?.lastSuccessAt };
      }),
    ];
    const requiredBytes = requirements.memoryMiB * 1024 ** 2;
    const candidates = entries.map((entry) => {
      const status = entry.status;
      const reasons: string[] = [];
      if (entry.error) reasons.push(`连接失败：${entry.error}`);
      if (!status || !entry.observedAt || this.now() - entry.observedAt > 90_000)
        reasons.push('没有 90 秒内的有效资源观测');
      if (status && status.cpus < requirements.cpus)
        reasons.push(`逻辑处理器不足：${status.cpus} < ${requirements.cpus}`);
      if (status && status.memoryFree < requiredBytes)
        reasons.push(`空闲内存不足：${Math.floor(status.memoryFree / 1024 ** 2)} MiB < ${requirements.memoryMiB} MiB`);
      const eligible = reasons.length === 0;
      const memoryHeadroom = status ? Math.min(1, Math.max(0,
        (status.memoryFree / requiredBytes - 1) / 3)) : 0;
      const cpuHeadroom = status ? Math.max(0, 1 - status.load[0] / status.cpus) : 0;
      const density = status ? 1 / (1 + status.runningVms / status.cpus) : 0;
      const components = { memory: Math.round(memoryHeadroom * 100),
        cpuLoad: Math.round(cpuHeadroom * 100),
        instanceDensity: Math.round(density * 100) };
      const score = eligible ? Math.round(100 *
        (0.45 * memoryHeadroom + 0.45 * cpuHeadroom + 0.10 * density)) : null;
      return { id: entry.id, name: entry.name, source: entry.source,
        eligible, score, components, reasons, status: status || null,
        observedAt: entry.observedAt || null };
    }).sort((left, right) => Number(right.eligible) - Number(left.eligible) ||
      (right.score ?? -1) - (left.score ?? -1) || left.id.localeCompare(right.id));
    return { requirements, scoredAt: new Date(this.now()).toISOString(), candidates };
  }

  async upload(peerId: string, transferId: string, name: string,
    produce: (target: Writable, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal,
    origin?: { sourceVmId: string; snapshotId: string }) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    z.uuid().parse(transferId);
    createSchema.shape.name.parse(name);
    if (origin) {
      z.uuid().parse(origin.sourceVmId);
      z.uuid().parse(origin.snapshotId);
    }
    const peer = this.state.outbound.find((item) => item.id === peerId);
    if (!peer) throw new AppError('远端主机不存在', 404);
    const previous = await this.importStatus(peerId, transferId);
    if (previous) {
      if (previous.name !== name || previous.sourceVmId !== origin?.sourceVmId ||
          previous.snapshotId !== origin?.snapshotId)
        throw new AppError('迁移标识已用于其他来源或实例名称', 409);
      return previous;
    }
    const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]);
    operationSignal.throwIfAborted();
    const url = new URL('/peer/import', peer.url);
    this.mutation(1);
    try {
      return await new Promise<ImportReceipt>((resolve, reject) => {
        let settled = false;
        let producerDone = false;
        let reply: ImportReceipt | undefined;
        const complete = () => {
          if (!settled && producerDone && reply) {
            settled = true;
            resolve(reply);
          }
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          request.destroy();
          reject(error);
        };
        const request = httpsRequest(url, {
          method: 'POST', agent: false, rejectUnauthorized: false, signal: operationSignal,
          headers: { authorization: `Bearer ${peer.token}`,
            'content-type': 'application/octet-stream',
            'x-sakura-transfer-id': transferId, 'x-sakura-target-name': name,
            ...(origin ? { 'x-sakura-source-vm-id': origin.sourceVmId,
              'x-sakura-snapshot-id': origin.snapshotId } : {}) },
        }, (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 64 * 1024) fail(new AppError('远端响应超过上限', 502));
            else chunks.push(chunk);
          });
          response.on('end', () => {
            if (settled) return;
            try {
              if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300)
                throw new AppError(`远端返回 HTTP ${response.statusCode || 0}`, 502);
              const result = importReceiptSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
              reply = result;
              complete();
            } catch (error) { fail(error as Error); }
          });
          response.on('error', fail);
        });
        request.on('error', (error) => { if (!reply) fail(error); });
        request.once('socket', (socket) => {
          socket.once('secureConnect', () => {
            try {
              checkPinnedCertificate(socket as TLSSocket, peer.fingerprint);
              void produce(request, operationSignal).then(() => {
                producerDone = true;
                if (!reply && !request.writableEnded) request.end();
                complete();
              }).catch((error) => {
                producerDone = true;
                if (reply) complete();
                else fail(error as Error);
              });
            } catch (error) { fail(error as Error); }
          });
        });
      });
    } finally { this.mutation(-1); }
  }

  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = hostPeerRequest.parse(input);
    if (value.operation === 'refresh') { await this.refresh(); return this.view(); }
    if (value.operation === 'score') return this.score(value.requirements);
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
        } else if (value.operation === 'allow-import') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowImport = value.enabled;
        } else if (value.operation === 'allow-policy') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowPolicy = value.enabled;
        } else if (value.operation === 'allow-activate') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowActivate = value.enabled;
        } else if (value.operation === 'allow-failover') {
          const peer = next.incoming.find((item) => item.id === value.id);
          if (!peer) throw new AppError('入站配对不存在', 404);
          peer.allowFailover = value.enabled;
        }
      });
      if (value.operation === 'remove-outbound') this.observations.delete(value.id);
      if (value.operation === 'revoke-inbound' ||
          (value.operation === 'allow-import' && !value.enabled))
        for (const controller of this.activeImports.get(value.id) || [])
          controller.abort(new AppError('导入权限已撤销', 403));
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
    for (const active of this.activeImports.values())
      for (const controller of active) controller.abort(new AppError('服务正在关闭', 503));
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

import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { GetObjectCommand, GetObjectLockConfigurationCommand, HeadObjectCommand,
  PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { AuditLog } from './audit.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash &&
    (url.pathname === '/' || url.pathname === '') &&
    (url.protocol === 'https:' || (url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)));
}, '远程审计地址需要 HTTPS；本机测试可使用 HTTP');
export const remoteAuditTarget = z.object({
  endpoint: endpoint.optional(),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  region: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).default('us-east-1'),
  prefix: z.string().max(120).regex(/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/)
    .default(''),
  retentionDays: z.number().int().min(7).max(3650),
}).strict();
export const remoteAuditAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), target: remoteAuditTarget }).strict(),
  z.object({ action: z.literal('disable') }).strict(),
  z.object({ action: z.literal('sync') }).strict(),
  z.object({ action: z.literal('verify') }).strict(),
]);
export type RemoteAuditTarget = z.infer<typeof remoteAuditTarget>;

const anchorBody = z.object({ format: z.literal('sakura-audit-anchor/v1'),
  hostId: z.uuid(), sequence: z.number().int().min(0), hash: hex,
  createdAt: z.iso.datetime(), previous: z.object({ key: z.string().min(1).max(300),
    versionId: z.string().min(1).max(512) }).strict().nullable() }).strict();
const anchor = z.object({ target: remoteAuditTarget, key: z.string().min(1).max(300),
  versionId: z.string().min(1).max(512), sequence: z.number().int().min(0),
  hash: hex, body: z.string().min(1).max(2048),
  retainUntil: z.iso.datetime() }).strict();
const stateSchema = z.object({ version: z.literal(1), hostId: z.uuid(),
  target: remoteAuditTarget.nullable(), last: anchor.optional(),
  lastAttemptAt: z.iso.datetime().optional(),
  lastVerifiedAt: z.iso.datetime().optional(),
  lastError: z.string().max(500).optional() }).strict();
type State = z.infer<typeof stateSchema>;
type Anchor = z.infer<typeof anchor>;

export type RemoteAuditObject = { body: string; versionId: string;
  mode: string | undefined; retainUntil: Date | undefined };
export interface RemoteAuditStore {
  locked(target: RemoteAuditTarget, signal?: AbortSignal): Promise<boolean>;
  put(target: RemoteAuditTarget, key: string, body: string, retainUntil: Date,
    signal?: AbortSignal): Promise<string>;
  read(target: RemoteAuditTarget, key: string, versionId?: string,
    signal?: AbortSignal): Promise<RemoteAuditObject>;
}

/** The S3 adapter requires a locked, versioned bucket and checks the exact object version. */
export class S3RemoteAuditStore implements RemoteAuditStore {
  private client(target: RemoteAuditTarget) {
    return new S3Client({ region: target.region,
      ...(target.endpoint ? { endpoint: target.endpoint, forcePathStyle: true } : {}),
      maxAttempts: 2 });
  }
  async locked(target: RemoteAuditTarget, signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const response = await client.send(new GetObjectLockConfigurationCommand({
        Bucket: target.bucket }),
      { abortSignal: signal || AbortSignal.timeout(15_000) });
      return response.ObjectLockConfiguration?.ObjectLockEnabled === 'Enabled';
    } finally { client.destroy(); }
  }
  async put(target: RemoteAuditTarget, key: string, body: string, retainUntil: Date,
    signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const bytes = Buffer.from(body);
      const response = await client.send(new PutObjectCommand({ Bucket: target.bucket,
        Key: key, Body: bytes, ContentType: 'application/json', IfNoneMatch: '*',
        ChecksumAlgorithm: 'SHA256',
        ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
        ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retainUntil }),
      { abortSignal: signal || AbortSignal.timeout(15_000) });
      if (!response.VersionId) throw new AppError('远端未返回受保护对象版本 ID', 409);
      return response.VersionId;
    } finally { client.destroy(); }
  }
  async read(target: RemoteAuditTarget, key: string, versionId?: string,
    signal?: AbortSignal) {
    const client = this.client(target);
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: target.bucket,
        Key: key, ...(versionId ? { VersionId: versionId } : {}) }),
      { abortSignal: signal || AbortSignal.timeout(15_000) });
      if (!head.VersionId || head.ContentLength === undefined ||
          head.ContentLength < 1 || head.ContentLength > 2048)
        throw new AppError('远端审计锚点缺少版本或内容过大', 409);
      const content = await client.send(new GetObjectCommand({ Bucket: target.bucket,
        Key: key, VersionId: head.VersionId }),
      { abortSignal: signal || AbortSignal.timeout(15_000) });
      if (!content.Body || content.ContentLength !== head.ContentLength)
        throw new AppError('远端审计锚点内容不一致', 409);
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of content.Body as Readable) {
        bytes += chunk.length;
        if (bytes > 2048) throw new AppError('远端审计锚点内容过大', 409);
        chunks.push(Buffer.from(chunk));
      }
      if (bytes !== head.ContentLength)
        throw new AppError('远端审计锚点长度不符', 409);
      const body = Buffer.concat(chunks).toString('utf8');
      return { body, versionId: head.VersionId,
        mode: head.ObjectLockMode, retainUntil: head.ObjectLockRetainUntilDate };
    } finally { client.destroy(); }
  }
}

/** Publishes the verified local audit head as a protected, version-addressed remote anchor. */
export class RemoteAuditLock {
  private state?: State;
  private pending = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private backgroundAllowed = () => true;
  constructor(private audit: AuditLog,
    private file = join(DATA, 'remote-audit.json'),
    private store: RemoteAuditStore = new S3RemoteAuditStore(),
    private now = Date.now, private intervalMs = 3_600_000) {}

  async init() {
    let created = false;
    const raw = await readStore(this.file, () => {
      created = true;
      return { version: 1 as const, hostId: randomUUID(), target: null };
    });
    const state = stateSchema.parse(raw);
    if (state.last && state.target &&
        JSON.stringify(state.last.target) !== JSON.stringify(state.target))
      throw new AppError('远程审计目标与已锚定目标不一致', 503);
    if (state.last) {
      try {
        const body = anchorBody.parse(JSON.parse(state.last.body));
        const prefix = `${state.last.target.prefix ? state.last.target.prefix + '/' : ''}` +
          `sakura-audit/${state.hostId}/`;
        if (body.hostId !== state.hostId || body.sequence !== state.last.sequence ||
            body.hash !== state.last.hash || !state.last.key.startsWith(prefix))
          throw new Error('anchor mismatch');
      } catch { throw new AppError('远程审计锚点本地记录损坏', 503); }
    }
    if (created) await writeStore(this.file, state);
    this.state = state;
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        if (this.state?.target && !this.closed && this.backgroundAllowed())
          void this.sync().catch(() => {});
      }, this.intervalMs);
      this.timer.unref();
    }
  }
  setBackgroundAllowed(check: () => boolean) { this.backgroundAllowed = check; }
  private ready() {
    if (!this.state) throw new AppError('远程审计服务尚未启动', 503);
    return this.state;
  }
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('远程审计服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }
  private async save(state: State) {
    await writeStore(this.file, stateSchema.parse(state));
    this.state = state;
  }
  async status() {
    const state = this.ready();
    const local = await this.audit.read(0, undefined, state.last);
    return { hostId: state.hostId, target: state.target, last: state.last && {
      key: state.last.key, versionId: state.last.versionId,
      sequence: state.last.sequence, hash: state.last.hash,
      retainUntil: state.last.retainUntil },
      local: local.valid ? { valid: true, sequence: local.sequence, hash: local.hash }
        : { valid: false, error: local.error },
      protected: Boolean(state.last && Date.parse(state.last.retainUntil) > this.now()),
      caughtUp: Boolean(local.valid && state.last &&
        local.sequence === state.last.sequence && local.hash === state.last.hash),
      lastAttemptAt: state.lastAttemptAt, lastVerifiedAt: state.lastVerifiedAt,
      lastError: state.lastError };
  }
  configure(input: unknown, signal?: AbortSignal) {
    const target = remoteAuditTarget.parse(input);
    return this.serial(async () => {
      const current = this.ready();
      if (current.last && JSON.stringify(current.last.target) !== JSON.stringify(target))
        throw new AppError('已有审计锚点，不能更换目标或保留期', 409);
      if (!await this.store.locked(target, signal))
        throw new AppError('远程桶未启用 Object Lock', 409);
      await this.save({ ...current, target, lastError: undefined });
      return this.status();
    });
  }
  disable() {
    return this.serial(async () => {
      await this.save({ ...this.ready(), target: null });
      return this.status();
    });
  }
  private async verifyAnchor(item: Anchor, signal?: AbortSignal) {
    const remote = await this.store.read(item.target, item.key, item.versionId, signal);
    if (remote.versionId !== item.versionId || remote.body !== item.body ||
        remote.mode !== 'COMPLIANCE' || !remote.retainUntil ||
        remote.retainUntil.getTime() < Date.parse(item.retainUntil) - 1000 ||
        remote.retainUntil.getTime() <= this.now())
      throw new AppError('远端审计锚点内容或不可变保留期校验失败', 409);
    return remote;
  }
  verify(signal?: AbortSignal) {
    return this.serial(async () => {
      const current = this.ready();
      const attempt = new Date(this.now()).toISOString();
      try {
        if (!current.last) throw new AppError('尚无远程审计锚点', 409);
        const local = await this.audit.read(0, undefined, current.last);
        if (!local.valid || local.sequence < current.last.sequence ||
            (local.sequence === current.last.sequence && local.hash !== current.last.hash))
          throw new AppError('本地审计链与已锚定版本不一致', 409);
        await this.verifyAnchor(current.last, signal);
        await this.save({ ...current, lastAttemptAt: attempt,
          lastVerifiedAt: attempt, lastError: undefined });
        return this.status();
      } catch (error) {
        await this.save({ ...current, lastAttemptAt: attempt,
          lastError: String((error as Error).message || error).slice(0, 500) });
        throw error;
      }
    });
  }
  sync(signal?: AbortSignal) {
    return this.serial(async () => {
      const current = this.ready();
      if (!current.target) throw new AppError('请先配置远程审计目标', 409);
      const attempt = new Date(this.now()).toISOString();
      try {
        const local = await this.audit.read(0, undefined, current.last);
        if (!local.valid) throw new AppError('本地审计链校验失败：' + local.error, 409);
        if (current.last && (local.sequence < current.last.sequence ||
            (local.sequence === current.last.sequence && local.hash !== current.last.hash)))
          throw new AppError('本地审计链落后于远程锚点', 409);
        if (!await this.store.locked(current.target, signal))
          throw new AppError('远程桶未启用 Object Lock', 409);
        if (current.last) await this.verifyAnchor(current.last, signal);
        // Renew the anchor before retention lapses even when no new audit event exists.
        if (current.last && local.sequence === current.last.sequence &&
            local.hash === current.last.hash &&
            Date.parse(current.last.retainUntil) > this.now() + 2 * 86_400_000) {
          await this.save({ ...current, lastAttemptAt: attempt,
            lastVerifiedAt: attempt, lastError: undefined });
          return this.status();
        }
        const body = JSON.stringify(anchorBody.parse({ format: 'sakura-audit-anchor/v1',
          hostId: current.hostId, sequence: local.sequence, hash: local.hash,
          createdAt: attempt,
          previous: current.last ? { key: current.last.key,
            versionId: current.last.versionId } : null }));
        const key = `${current.target.prefix ? current.target.prefix + '/' : ''}` +
          `sakura-audit/${current.hostId}/${local.sequence}-${local.hash}-${randomUUID()}.json`;
        const retainUntil = new Date(this.now() + current.target.retentionDays * 86_400_000);
        const versionId = await this.store.put(current.target, key, body, retainUntil, signal);
        const nextAnchor: Anchor = { target: current.target, key, versionId,
          sequence: local.sequence, hash: local.hash, body,
          retainUntil: retainUntil.toISOString() };
        await this.verifyAnchor(nextAnchor, signal);
        await this.save({ ...current, last: nextAnchor, lastAttemptAt: attempt,
          lastVerifiedAt: attempt, lastError: undefined });
        return this.status();
      } catch (error) {
        await this.save({ ...current, lastAttemptAt: attempt,
          lastError: String((error as Error).message || error).slice(0, 500) });
        throw error;
      }
    });
  }
  async close() { this.closed = true; if (this.timer) clearInterval(this.timer);
    await this.pending; }
}

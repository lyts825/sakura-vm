import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
  ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { z } from 'zod';
import type { Backups } from './backups.ts';
import { backupLocked, verifyBackup } from './backups.ts';
import type { Bundles } from './bundles.ts';
import { withDecrypted } from './encrypted-backups.ts';
import type { Machines } from './machines.ts';
import { AppError, DATA, createSchema, vmDir } from './model.ts';
import { fileHash, readStore, writeStore } from './local-store.ts';
import { secretName, type Secrets } from './secrets.ts';

const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const prefix = z.string().max(120).regex(/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/);
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    !url.search && !url.hash && (url.pathname === '/' || url.pathname === '');
}, '目标地址需要无凭据、查询和路径的 HTTP(S) URL');
export const objectTargetSchema = z.object({
  endpoint: endpoint.optional(),
  bucket: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  region: z.string().min(1).max(64).regex(/^[A-Za-z0-9-]+$/).default('us-east-1'),
  prefix: prefix.default(''),
  credentialSecret: secretName,
}).strict();
const credentialSchema = z.object({
  accessKeyId: z.string().min(1).max(256),
  secretAccessKey: z.string().min(1).max(1024),
  sessionToken: z.string().max(4096).optional(),
}).strict();
const metadataSchema = z.object({
  version: z.literal(1), sourceVmId: uuid, backupId: uuid,
  bytes: z.number().int().nonnegative().max(33 * 1024 ** 3),
  sha256: sha, encrypted: z.boolean(),
  createdAt: z.iso.datetime(),
  passwordSecret: secretName.optional(),
  retainUntil: z.iso.datetime().optional(),
}).strict();
type Metadata = z.infer<typeof metadataSchema>;
export const objectBackupInput = z.object({
  mode: z.enum(['status', 'save', 'list', 'upload', 'verify', 'restore', 'delete']).default('status'),
  target: objectTargetSchema.optional(),
  backupId: uuid.optional(),
  remoteId: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/).optional(),
  restoreName: createSchema.shape.name.optional(),
  passwordSecret: secretName.optional(),
}).strict();

export class ObjectBackup {
  constructor(
    private machines: Machines,
    private services: () => { backups?: Backups; bundles?: Bundles; secrets?: Secrets },
  ) {}

  private file(vmId: string) { return join(vmDir(vmId), 'object-backup.json'); }
  private async target(vmId: string) {
    return objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null));
  }
  private async client(vmId: string, target: z.infer<typeof objectTargetSchema>, secrets: Secrets) {
    let credential: z.infer<typeof credentialSchema>;
    try {
      credential = credentialSchema.parse(JSON.parse(await secrets.value(vmId, target.credentialSecret)));
    } catch {
      throw new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400);
    }
    return new S3Client({
      region: target.region,
      ...(target.endpoint ? { endpoint: target.endpoint } : {}),
      forcePathStyle: true,
      credentials: credential,
      maxAttempts: 2,
    });
  }
  private base(target: z.infer<typeof objectTargetSchema>) {
    return `${target.prefix ? target.prefix + '/' : ''}sakura-backups/`;
  }
  private keys(target: z.infer<typeof objectTargetSchema>, sourceVmId: string, backupId: string,
    encrypted: boolean) {
    const base = `${this.base(target)}${sourceVmId}/${backupId}`;
    return { metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` };
  }
  private async remoteMetadata(client: S3Client, target: z.infer<typeof objectTargetSchema>,
    remoteId: string, signal: AbortSignal) {
    const [sourceVmId, backupId] = remoteId.split('/');
    uuid.parse(sourceVmId); uuid.parse(backupId);
    const key = this.keys(target, sourceVmId, backupId, false).metadata;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }),
      { abortSignal: signal });
    if (!result.Body || result.ContentLength === undefined || result.ContentLength > 16384)
      throw new AppError('对象备份清单缺失或过大', 409);
    const metadata = metadataSchema.parse(JSON.parse(await result.Body.transformToString()));
    if (metadata.sourceVmId !== sourceVmId || metadata.backupId !== backupId)
      throw new AppError('对象备份清单与对象路径不匹配', 409);
    return metadata;
  }
  private async remoteHash(client: S3Client, target: z.infer<typeof objectTargetSchema>,
    metadata: Metadata, signal: AbortSignal, file?: string) {
    const key = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted).data;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }),
      { abortSignal: signal });
    if (!result.Body || result.ContentLength !== metadata.bytes)
      throw new AppError('远端备份对象长度不符', 409);
    const hash = createHash('sha256');
    let bytes = 0;
    const source = result.Body as Readable;
    if (file) {
      await pipeline(source, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > metadata.bytes) return callback(new AppError('远端备份对象超过声明长度', 409));
          hash.update(chunk); callback(null, chunk);
        },
      }), createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
    } else for await (const chunk of source) {
      signal.throwIfAborted();
      bytes += (chunk as Buffer).length;
      if (bytes > metadata.bytes) throw new AppError('远端备份对象超过声明长度', 409);
      hash.update(chunk as Buffer);
    }
    if (bytes !== metadata.bytes || hash.digest('hex') !== metadata.sha256)
      throw new AppError('远端备份 SHA-256 校验失败', 409);
  }

  async action(vmId: string, input: unknown, action: 'check' | 'run', signal: AbortSignal) {
    this.machines.get(vmId);
    const options = objectBackupInput.parse(input);
    const readOnly = action === 'check' || options.mode === 'status' || options.mode === 'list';
    if (!readOnly) this.machines.requireUnlocked(vmId);
    const configured = await this.target(vmId);
    if (!configured && options.mode !== 'save') return { ready: false, executed: false,
      reason: '请先保存 S3/MinIO 目标；凭据需在当前实例的私密配置中保存为 JSON。' };
    const { backups, bundles, secrets } = this.services();
    if (!backups || !bundles || !secrets) {
      const reason = '请启用快照、备份策略与私密配置插件';
      if (action === 'check' || options.mode === 'status')
        return { ready: false, executed: false, reason };
      throw new AppError(reason, 409);
    }
    if (options.mode === 'save') {
      if (!options.target) throw new AppError('请填写对象存储目标');
      const client = await this.client(vmId, options.target, secrets);
      try {
        await client.send(new HeadBucketCommand({ Bucket: options.target.bucket }), { abortSignal: signal });
        if (action === 'run') await this.machines.locked(`object-backup-config:${vmId}`,
          () => writeStore(this.file(vmId), options.target!));
        return { ready: true, executed: action === 'run', target: options.target };
      } finally { client.destroy(); }
    }
    const target = configured!;
    const client = await this.client(vmId, target, secrets);
    try {
      if (action === 'check' || options.mode === 'status') {
        await client.send(new HeadBucketCommand({ Bucket: target.bucket }), { abortSignal: signal });
        return { ready: true, executed: false, target };
      }
      if (options.mode === 'list') {
        const entries: Array<{ remoteId: string; metadata: Metadata }> = [];
        let token: string | undefined;
        do {
          const page = await client.send(new ListObjectsV2Command({
            Bucket: target.bucket, Prefix: this.base(target),
            ContinuationToken: token, MaxKeys: 1000,
          }), { abortSignal: signal });
          for (const item of page.Contents || []) {
            const key = item.Key || '';
            if (!key.startsWith(this.base(target)) || !key.endsWith('.json')) continue;
            const remoteId = key.slice(this.base(target).length, -'.json'.length);
            const [sourceVmId, backupId, extra] = remoteId.split('/');
            if (extra || !uuid.safeParse(sourceVmId).success || !uuid.safeParse(backupId).success)
              continue;
            entries.push({ remoteId, metadata: await this.remoteMetadata(client, target, remoteId, signal) });
            if (entries.length >= 100) break;
          }
          token = page.IsTruncated && entries.length < 100 ? page.NextContinuationToken : undefined;
        } while (token);
        return { ready: true, executed: false, target, entries };
      }
      if (options.mode === 'upload') {
        if (!options.backupId) throw new AppError('请选择本机备份');
        return await this.machines.locked(`object-backup:${vmId}`, async () => {
          const item = (await backups.view(vmId)).items.find((entry) => entry.id === options.backupId);
          if (!item) throw new AppError('本机备份不存在', 404);
          const passwordName = options.passwordSecret || item.passwordSecret;
          if (item.encrypted && !passwordName)
            throw new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400);
          const password = passwordName ? await secrets.value(vmId, passwordName) : undefined;
          const metadata: Metadata = {
            version: 1, sourceVmId: vmId, backupId: item.id, bytes: item.bytes,
            sha256: item.checksum, encrypted: Boolean(item.encrypted), createdAt: item.createdAt,
            ...(item.encrypted ? { passwordSecret: passwordName } : {}),
            ...(item.retainUntil ? { retainUntil: item.retainUntil } : {}),
          };
          const keys = this.keys(target, vmId, item.id, Boolean(item.encrypted));
          try {
            await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: keys.metadata }),
              { abortSignal: signal });
            const existing = await this.remoteMetadata(client, target, `${vmId}/${item.id}`, signal);
            if (existing.sha256 !== metadata.sha256 || existing.bytes !== metadata.bytes)
              throw new AppError('远端同名备份与本机备份不一致', 409);
            await this.remoteHash(client, target, existing, signal);
            return { ready: true, executed: false, remoteId: `${vmId}/${item.id}`,
              metadata: existing, message: '远端备份已存在并通过校验。' };
          } catch (error) {
            if (error instanceof AppError || !['NotFound', 'NoSuchKey', '404'].includes((error as Error).name))
              throw error;
          }
          await backups.withVerifiedFile(vmId, item.id, password, signal, async (verifiedFile) => {
            const artifact = await backups.downloadable(vmId, item.id);
            const file = artifact.type === 'file' ? artifact.path : verifiedFile;
            if ((await stat(file)).size !== item.bytes || await fileHash(file, signal) !== item.checksum)
              throw new AppError('本机备份与记录的校验值不符', 409);
            signal.throwIfAborted();
            const body = createReadStream(file);
            const upload = new Upload({ client, params: {
              Bucket: target.bucket, Key: keys.data, Body: body,
              ContentType: 'application/octet-stream',
            }, queueSize: 2, partSize: 8 * 1024 ** 2, leavePartsOnError: false });
            const cancel = () => { body.destroy(); void upload.abort().catch(() => {}); };
            signal.addEventListener('abort', cancel, { once: true });
            let uploaded = false;
            try {
              signal.throwIfAborted();
              await upload.done();
              uploaded = true;
              await this.remoteHash(client, target, metadata, signal);
              await client.send(new PutObjectCommand({ Bucket: target.bucket,
                Key: keys.metadata, Body: JSON.stringify(metadata), ContentType: 'application/json' }),
              { abortSignal: signal });
            } catch (error) {
              if (uploaded) await client.send(new DeleteObjectCommand({ Bucket: target.bucket,
                Key: keys.data })).catch(() => {});
              throw error;
            } finally { signal.removeEventListener('abort', cancel); body.destroy(); }
          });
          return { ready: true, executed: true, remoteId: `${vmId}/${item.id}`, metadata };
        });
      }
      if (!options.remoteId) throw new AppError('请选择远端备份');
      const metadata = await this.remoteMetadata(client, target, options.remoteId, signal);
      if (options.mode === 'delete') {
        if (backupLocked(metadata))
          throw new AppError('备份在保留锁定期内，不能删除：' + metadata.retainUntil,
            423, 'BACKUP_LOCKED');
        const keys = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted);
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.metadata }),
          { abortSignal: signal });
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.data }),
          { abortSignal: signal });
        return { ready: true, executed: true, remoteId: options.remoteId, deleted: true };
      }
      const tempRoot = join(DATA, 'object-backup-temp');
      await mkdir(tempRoot, { recursive: true });
      const temp = await mkdtemp(join(tempRoot, 'download-'));
      const file = join(temp, `backup.sakura${metadata.encrypted ? '.enc' : ''}`);
      try {
        await this.remoteHash(client, target, metadata, signal, file);
        let restored: { id: string; name: string } | undefined;
        if (metadata.encrypted) {
          const passwordName = options.passwordSecret || metadata.passwordSecret;
          if (!passwordName)
            throw new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400);
          const password = await secrets.value(vmId, passwordName);
          await withDecrypted(file, password, async (plain) => {
            await verifyBackup(plain, signal);
            if (options.mode === 'restore') {
              if (!options.restoreName) throw new AppError('恢复需要新实例名称');
              restored = await bundles.importExternal(options.restoreName, createReadStream(plain), signal);
            }
          }, signal);
        } else {
          await verifyBackup(file, signal);
          if (options.mode === 'restore') {
            if (!options.restoreName) throw new AppError('恢复需要新实例名称');
            restored = await bundles.importExternal(options.restoreName, createReadStream(file), signal);
          }
        }
        return { ready: true, executed: true,
          remoteId: options.remoteId, verified: true,
          ...(restored ? { restoredVmId: restored.id, restoredName: restored.name } : {}) };
      } finally { await rm(temp, { recursive: true, force: true }); }
    } finally { client.destroy(); }
  }
}

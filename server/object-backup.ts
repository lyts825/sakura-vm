import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { Backups } from './backups.ts';
import { backupLocked, verifyBackup } from './backups.ts';
import type { Bundles } from './bundles.ts';
import { withDecrypted } from './encrypted-backups.ts';
import type { Machines } from './machines.ts';
import { networkFor } from './network/index.ts';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { createSchema } from '../shared/contracts/vm.ts';
import { withoutOperationContext } from './operation-context.ts';
import { metadataFile } from './metadata-store.ts';
import { fileHash, readStore, writeStore } from './local-store.ts';
import { secretName, type Secrets } from './secrets.ts';
import { storageRuntime, type StorageLease } from './storage-runtime.ts';
import { uploadObjectFile, OBJECT_UPLOAD_BUFFERS } from './object-upload.ts';
import { randomUUID } from 'node:crypto';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const objectNetwork = networkFor('core:object-backup', 's3');
const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const prefix = z
  .string()
  .max(120)
  .regex(/^(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/);
const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === '/' || url.pathname === '')
  );
}, '目标地址需要无凭据、查询和路径的 HTTP(S) URL');
export const objectTargetSchema = z
  .object({
    endpoint: endpoint.optional(),
    bucket: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
    region: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/)
      .default('us-east-1'),
    prefix: prefix.default(''),
    credentialSecret: secretName,
    autoUpload: z.boolean().default(false),
  })
  .strict();
const credentialSchema = z
  .object({
    accessKeyId: z.string().min(1).max(256),
    secretAccessKey: z.string().min(1).max(1024),
    sessionToken: z.string().max(4096).optional(),
  })
  .strict();
const metadataSchema = z
  .object({
    version: z.literal(1),
    sourceVmId: uuid,
    backupId: uuid,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(33 * 1024 ** 3),
    sha256: sha,
    encrypted: z.boolean(),
    createdAt: z.iso.datetime(),
    passwordSecret: secretName.optional(),
    retainUntil: z.iso.datetime().optional(),
  })
  .strict();
type Metadata = z.infer<typeof metadataSchema>;
const syncStateSchema = z
  .object({
    mirrored: z.record(uuid, sha).default({}),
    lastAttemptAt: z.iso.datetime().optional(),
    lastSuccessAt: z.iso.datetime().optional(),
    lastError: z.string().max(500).optional(),
  })
  .strict();
type SyncState = z.infer<typeof syncStateSchema>;
export const objectBackupInput = z
  .object({
    mode: z.enum(['status', 'save', 'list', 'upload', 'verify', 'restore', 'delete']).default('status'),
    target: objectTargetSchema.optional(),
    backupId: uuid.optional(),
    remoteId: z
      .string()
      .regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/)
      .optional(),
    restoreName: createSchema.shape.name.optional(),
    passwordSecret: secretName.optional(),
  })
  .strict();

export class ObjectBackup {
  private schedule: ScheduleHandle;
  private closed = false;
  private automaticAbort = new AbortController();
  constructor(
    private machines: Machines,
    private services: () => { backups?: Backups; bundles?: Bundles; secrets?: Secrets },
  ) {
    this.schedule = scheduler.register({
      owner: 'core:object-backup',
      label: 'Mirror verified backups to object storage',
      intervalMs: 60_000,
      overlap: 'skip',
      catchUp: 'once',
      run: ({ signal }) => this.tick(Date.now(), signal),
    });
  }

  private file(vmId: string) {
    return join(vmDir(vmId), 'object-backup.json');
  }
  private syncFile(vmId: string) {
    return join(vmDir(vmId), 'object-backup-sync.json');
  }
  private async target(vmId: string) {
    return objectTargetSchema.nullable().parse(await readStore(this.file(vmId), () => null));
  }
  private async syncState(vmId: string) {
    return syncStateSchema.parse(await readStore(this.syncFile(vmId), () => ({ mirrored: {} })));
  }
  private async updateSync(vmId: string, update: (state: SyncState) => void) {
    return this.machines.locked(`object-backup-sync:${vmId}`, async () => {
      const result = await metadataFile(
        this.syncFile(vmId),
        () => ({ mirrored: {} }),
        syncStateSchema.parse,
      ).update(update);
      return result.value;
    });
  }
  private async markMirrored(vmId: string, backupId: string, checksum: string) {
    await this.updateSync(vmId, (state) => {
      state.mirrored[backupId] = checksum;
      state.lastAttemptAt = new Date().toISOString();
      state.lastSuccessAt = state.lastAttemptAt;
      delete state.lastError;
    });
  }
  /** Retry failed automatic transfers after five minutes; local backups remain usable on failure. */
  async tick(now = Date.now(), signal?: AbortSignal) {
    const active = signal
      ? AbortSignal.any([signal, this.automaticAbort.signal])
      : this.automaticAbort.signal;
    if (this.closed) return;
    const { backups, bundles, secrets } = this.services();
    if (!backups || !bundles || !secrets) return;
    for (const vmId of this.machines.records.keys()) {
      if (this.closed || active.aborted) return;
      try {
        const target = await this.target(vmId);
        if (!target?.autoUpload || backups.jobs.view(vmId)?.status === 'running') continue;
        const state = await this.syncState(vmId);
        if (state.lastError && state.lastAttemptAt && now - Date.parse(state.lastAttemptAt) < 300_000)
          continue;
        const items = (await backups.view(vmId)).items;
        const localIds = new Set(items.map((item) => item.id));
        if (Object.keys(state.mirrored).some((id) => !localIds.has(id)))
          await this.updateSync(vmId, (current) => {
            for (const id of Object.keys(current.mirrored))
              if (!localIds.has(id)) delete current.mirrored[id];
          });
        for (const item of items.slice().reverse()) {
          if (this.closed || active.aborted) return;
          if (state.mirrored[item.id] === item.checksum) continue;
          await this.action(vmId, { mode: 'upload', backupId: item.id }, 'run', active);
          state.mirrored[item.id] = item.checksum;
        }
      } catch (error) {
        if (this.closed || active.aborted) return;
        await this.updateSync(vmId, (state) => {
          state.lastAttemptAt = new Date(now).toISOString();
          state.lastError = String((error as Error).message || error).slice(0, 500);
        });
      }
    }
  }
  private async client(vmId: string, target: z.infer<typeof objectTargetSchema>, secrets: Secrets) {
    let credential: z.infer<typeof credentialSchema>;
    try {
      credential = credentialSchema.parse(JSON.parse(await secrets.value(vmId, target.credentialSecret)));
    } catch {
      throw new AppError('对象存储凭据必须是含 accessKeyId 和 secretAccessKey 的私密配置 JSON', 400);
    }
    return new S3Client({
      requestHandler: objectNetwork.requestHandler(),
      region: target.region,
      ...(target.endpoint ? { endpoint: target.endpoint } : {}),
      forcePathStyle: true,
      credentials: credential,
      // A create/complete response can be lost after committing remotely. The
      // operation reconciles that identity itself instead of replaying mutation.
      maxAttempts: 1,
    });
  }
  private base(target: z.infer<typeof objectTargetSchema>) {
    return `${target.prefix ? target.prefix + '/' : ''}sakura-backups/`;
  }
  private keys(
    target: z.infer<typeof objectTargetSchema>,
    sourceVmId: string,
    backupId: string,
    encrypted: boolean,
  ) {
    const base = `${this.base(target)}${sourceVmId}/${backupId}`;
    return { metadata: `${base}.json`, data: `${base}.sakura${encrypted ? '.enc' : ''}` };
  }
  private async remoteMetadata(
    client: S3Client,
    target: z.infer<typeof objectTargetSchema>,
    remoteId: string,
    signal: AbortSignal,
  ) {
    const [sourceVmId, backupId] = remoteId.split('/');
    uuid.parse(sourceVmId);
    uuid.parse(backupId);
    const key = this.keys(target, sourceVmId, backupId, false).metadata;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }), {
      abortSignal: signal,
    });
    if (!result.Body) throw new AppError('对象备份清单缺失或过大', 409);
    const source = result.Body as Readable,
      chunks: Buffer[] = [];
    let bytes = 0;
    try {
      if (result.ContentLength === undefined || result.ContentLength > 16384)
        throw new AppError('对象备份清单缺失或过大', 409);
      for await (const chunk of source) {
        signal.throwIfAborted();
        bytes += (chunk as Buffer).length;
        if (bytes > 16384) throw new AppError('对象备份清单超过 16 KiB', 409);
        chunks.push(chunk as Buffer);
      }
      if (bytes !== result.ContentLength) throw new AppError('对象备份清单长度不符', 409);
    } finally {
      source.destroy();
      await finished(source).catch(() => {});
    }
    const metadata = metadataSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (metadata.sourceVmId !== sourceVmId || metadata.backupId !== backupId)
      throw new AppError('对象备份清单与对象路径不匹配', 409);
    return metadata;
  }
  private async remoteHash(
    client: S3Client,
    target: z.infer<typeof objectTargetSchema>,
    metadata: Metadata,
    signal: AbortSignal,
    file?: string,
    lease?: StorageLease,
  ): Promise<void> {
    if (!lease)
      return storageRuntime.run(
        {
          owner: 'core:object-read',
          taskId: 'object-read:' + randomUUID(),
          label: 'Verify remote object',
          mode: file ? 'write' : 'read',
          paths: [file || DATA],
          ...(file ? { dynamicTemporary: [file] } : {}),
          buffers: 1024 ** 2,
          files: 3,
          signal,
        },
        (owned) => this.remoteHash(client, target, metadata, signal, file, owned),
      );
    lease.assertActive();
    if (file) await lease.reserveTemporary(file, metadata.bytes);
    const key = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted).data;
    const result = await client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }), {
      abortSignal: signal,
    });
    if (!result.Body) throw new AppError('远端备份对象长度不符', 409);
    const hash = createHash('sha256');
    let bytes = 0;
    const source = result.Body as Readable;
    try {
      if (result.ContentLength !== metadata.bytes) throw new AppError('远端备份对象长度不符', 409);
      if (file) {
        await pipeline(
          source,
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > metadata.bytes) return callback(new AppError('远端备份对象超过声明长度', 409));
              hash.update(chunk);
              callback(null, chunk);
            },
          }),
          createWriteStream(file, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
      } else
        for await (const chunk of source) {
          signal.throwIfAborted();
          bytes += (chunk as Buffer).length;
          if (bytes > metadata.bytes) throw new AppError('远端备份对象超过声明长度', 409);
          hash.update(chunk as Buffer);
        }
    } finally {
      source.destroy();
      await finished(source).catch(() => {});
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
    if (!configured && options.mode !== 'save')
      return {
        ready: false,
        executed: false,
        reason: '请先保存 S3/MinIO 目标；凭据需在当前实例的私密配置中保存为 JSON。',
      };
    const { backups, bundles, secrets } = this.services();
    if (!backups || !bundles || !secrets) {
      const reason = '请启用快照、备份策略与私密配置插件';
      if (action === 'check' || options.mode === 'status')
        return {
          ready: false,
          executed: false,
          reason,
          ...(configured ? { target: configured, sync: await this.syncState(vmId) } : {}),
        };
      throw new AppError(reason, 409);
    }
    if (options.mode === 'save') {
      if (!options.target) throw new AppError('请填写对象存储目标');
      const client = await this.client(vmId, options.target, secrets);
      try {
        await client.send(new HeadBucketCommand({ Bucket: options.target.bucket }), { abortSignal: signal });
        if (action === 'run')
          await this.machines.locked(`object-backup:${vmId}`, async () => {
            const previous = await this.target(vmId);
            await writeStore(this.file(vmId), options.target!);
            if (JSON.stringify(previous) !== JSON.stringify(options.target))
              await this.machines.locked(`object-backup-sync:${vmId}`, () =>
                writeStore(this.syncFile(vmId), { mirrored: {} }),
              );
          });
        return { ready: true, executed: action === 'run', target: options.target };
      } finally {
        client.destroy();
      }
    }
    const target = configured!;
    if (action === 'check' || options.mode === 'status') {
      const sync = await this.syncState(vmId);
      let statusClient: S3Client | undefined;
      try {
        statusClient = await this.client(vmId, target, secrets);
        await statusClient.send(new HeadBucketCommand({ Bucket: target.bucket }), { abortSignal: signal });
        return { ready: true, executed: false, target, sync };
      } catch (error) {
        if (signal.aborted) throw error;
        return {
          ready: false,
          executed: false,
          target,
          sync,
          reason: String((error as Error).message || error).slice(0, 500),
        };
      } finally {
        statusClient?.destroy();
      }
    }
    const client = await this.client(vmId, target, secrets);
    try {
      if (options.mode === 'list') {
        const entries: Array<{ remoteId: string; metadata: Metadata }> = [];
        let token: string | undefined;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: target.bucket,
              Prefix: this.base(target),
              ContinuationToken: token,
              MaxKeys: 1000,
            }),
            { abortSignal: signal },
          );
          for (const item of page.Contents || []) {
            const key = item.Key || '';
            if (!key.startsWith(this.base(target)) || !key.endsWith('.json')) continue;
            const remoteId = key.slice(this.base(target).length, -'.json'.length);
            const [sourceVmId, backupId, extra] = remoteId.split('/');
            if (extra || !uuid.safeParse(sourceVmId).success || !uuid.safeParse(backupId).success) continue;
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
            version: 1,
            sourceVmId: vmId,
            backupId: item.id,
            bytes: item.bytes,
            sha256: item.checksum,
            encrypted: Boolean(item.encrypted),
            createdAt: item.createdAt,
            ...(item.encrypted ? { passwordSecret: passwordName } : {}),
            ...(item.retainUntil ? { retainUntil: item.retainUntil } : {}),
          };
          const keys = this.keys(target, vmId, item.id, Boolean(item.encrypted));
          try {
            await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: keys.metadata }), {
              abortSignal: signal,
            });
            const existing = await this.remoteMetadata(client, target, `${vmId}/${item.id}`, signal);
            if (existing.sha256 !== metadata.sha256 || existing.bytes !== metadata.bytes)
              throw new AppError('远端同名备份与本机备份不一致', 409);
            await this.remoteHash(client, target, existing, signal);
            await this.markMirrored(vmId, item.id, item.checksum);
            return {
              ready: true,
              executed: false,
              remoteId: `${vmId}/${item.id}`,
              metadata: existing,
              message: '远端备份已存在并通过校验。',
            };
          } catch (error) {
            if (
              error instanceof AppError ||
              !['NotFound', 'NoSuchKey', '404'].includes((error as Error).name)
            )
              throw error;
          }
          await backups.withVerifiedFile(
            vmId,
            item.id,
            password,
            signal,
            async (_verifiedFile, lease, file) => {
              if ((await stat(file)).size !== item.bytes || (await fileHash(file, signal)) !== item.checksum)
                throw new AppError('本机备份与记录的校验值不符', 409);
              signal.throwIfAborted();
              let uploaded = false;
              try {
                signal.throwIfAborted();
                await uploadObjectFile(client, target.bucket, keys.data, file, item.bytes, signal, lease);
                uploaded = true;
                await this.remoteHash(client, target, metadata, signal, undefined, lease);
                await client.send(
                  new PutObjectCommand({
                    Bucket: target.bucket,
                    Key: keys.metadata,
                    Body: JSON.stringify(metadata),
                    ContentType: 'application/json',
                  }),
                  { abortSignal: signal },
                );
              } catch (error) {
                if (uploaded) {
                  try {
                    await withoutOperationContext(async () => {
                      const cleanupSignal = AbortSignal.timeout(30_000);
                      // A lost manifest PUT response may already have advertised
                      // the object. Withdraw its manifest before removing data.
                      for (const key of [keys.metadata, keys.data])
                        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }), {
                          abortSignal: cleanupSignal,
                        });
                    });
                  } catch (cleanup) {
                    lease.cleanupPending(cleanup);
                    throw cleanup;
                  }
                }
                throw error;
              } finally {
                /* uploadObjectFile settles every worker and closes its descriptor. */
              }
            },
            { extraBuffers: OBJECT_UPLOAD_BUFFERS, writes: false },
          );
          await this.markMirrored(vmId, item.id, item.checksum);
          return { ready: true, executed: true, remoteId: `${vmId}/${item.id}`, metadata };
        });
      }
      if (!options.remoteId) throw new AppError('请选择远端备份');
      const metadata = await this.remoteMetadata(client, target, options.remoteId, signal);
      if (options.mode === 'delete') {
        if (backupLocked(metadata))
          throw new AppError('备份在保留锁定期内，不能删除：' + metadata.retainUntil, 423, 'BACKUP_LOCKED');
        const keys = this.keys(target, metadata.sourceVmId, metadata.backupId, metadata.encrypted);
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.metadata }), {
          abortSignal: signal,
        });
        await client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: keys.data }), {
          abortSignal: signal,
        });
        if (metadata.sourceVmId === vmId)
          await this.updateSync(vmId, (state) => {
            delete state.mirrored[metadata.backupId];
          });
        return { ready: true, executed: true, remoteId: options.remoteId, deleted: true };
      }
      const tempRoot = join(DATA, 'object-backup-temp');
      return await storageRuntime.run(
        {
          owner: 'core:object-import',
          taskId: 'object-import:' + randomUUID(),
          label: 'Download and verify object backup',
          mode: 'write',
          paths: [DATA],
          dynamicTemporary: [DATA],
          buffers: 24 * 1024 ** 2,
          files: 10,
          signal,
        },
        async (lease) => {
          await mkdir(tempRoot, { recursive: true });
          const temp = await mkdtemp(join(tempRoot, 'download-'));
          const file = join(temp, `backup.sakura${metadata.encrypted ? '.enc' : ''}`);
          try {
            await this.remoteHash(client, target, metadata, signal, file, lease);
            let restored: { id: string; name: string } | undefined;
            if (metadata.encrypted) {
              const passwordName = options.passwordSecret || metadata.passwordSecret;
              if (!passwordName)
                throw new AppError('加密备份需要 passwordSecret 指向保存了备份密码的私密配置', 400);
              const password = await secrets.value(vmId, passwordName);
              await withDecrypted(
                file,
                password,
                async (plain) => {
                  await verifyBackup(plain, signal, lease);
                  if (options.mode === 'restore') {
                    if (!options.restoreName) throw new AppError('恢复需要新实例名称');
                    restored = await bundles.importExternal(
                      options.restoreName,
                      createReadStream(plain),
                      signal,
                      lease,
                    );
                  }
                },
                signal,
                lease.cleanupPending,
                lease,
              );
            } else {
              await verifyBackup(file, signal, lease);
              if (options.mode === 'restore') {
                if (!options.restoreName) throw new AppError('恢复需要新实例名称');
                restored = await bundles.importExternal(
                  options.restoreName,
                  createReadStream(file),
                  signal,
                  lease,
                );
              }
            }
            return {
              ready: true,
              executed: true,
              remoteId: options.remoteId,
              verified: true,
              ...(restored ? { restoredVmId: restored.id, restoredName: restored.name } : {}),
            };
          } finally {
            try {
              await rm(temp, { recursive: true, force: true });
            } catch (error) {
              lease.cleanupPending(error);
              throw error;
            }
          }
        },
      );
    } finally {
      client.destroy();
    }
  }
  async close() {
    this.closed = true;
    this.automaticAbort.abort();
    await this.schedule.close();
  }
}

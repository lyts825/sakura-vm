import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, open } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import { checkedId } from '../shared/paths.ts';
import type { Machines } from './machines.ts';
import { MAX_BUNDLE_MANIFEST, type Bundles } from './bundles.ts';
import { decodeTrustedBootArchive } from './trusted-boot-archive.ts';
import { Jobs } from './jobs.ts';
import { Secrets, secretName } from './secrets.ts';
import { fileHash, regularDirectory } from './local-store.ts';
import { metadataFile } from './metadata-store.ts';
import { StorageRuntime, storageRuntime, type StorageLease } from './storage-runtime.ts';
import { encryptFile, withDecrypted, passwordSchema } from './encrypted-backups.ts';
import { inMaintenance } from './automation-policy.ts';
import { backupBlocks } from './backup-blocks.ts';
import type { Writable } from 'node:stream';

export const backupPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(720).default(24),
    keep: z.number().int().min(1).max(30).default(7),
    maxGiB: z.number().min(1).max(512).default(32),
    lockDays: z.number().int().min(0).max(3650).optional(),
    deduplicate: z.boolean().optional(),
    bandwidthMiBps: z
      .number()
      .min(0)
      .max(10240)
      .refine((value) => value === 0 || value >= 0.1)
      .optional(),
    directory: z
      .string()
      .max(4096)
      .refine((v) => !v || isAbsolute(v), '需要本机绝对目录')
      .optional(),
    passwordSecret: secretName.optional(),
  })
  .strict()
  .refine(
    (value) => !value.deduplicate || (!value.directory && !value.passwordSecret),
    '块级去重仅用于本机未加密备份；请清空外部目录和加密密码引用',
  );
export type BackupPolicy = z.infer<typeof backupPolicySchema>;
export type BackupRecord = {
  id: string;
  createdAt: string;
  bytes: number;
  checksum: string;
  verifiedAt?: string;
  error?: string;
  directory?: string;
  encrypted?: boolean;
  passwordSecret?: string;
  retainUntil?: string;
  storage?: 'blocks';
};
type BackupState = { policy: BackupPolicy; items: BackupRecord[]; lastSuccess?: string };
export type BackupDownload =
  | { type: 'file'; path: string; name: string }
  | {
      type: 'stream';
      name: string;
      bytes: number;
      write: (output: Writable, signal: AbortSignal) => Promise<void>;
    };
export async function verifyBackup(file: string, signal: AbortSignal, lease?: StorageLease) {
  if (lease) {
    lease.assertActive();
    return verifyBackupContents(file, signal);
  }
  return storageRuntime.run(
    {
      owner: 'core:backup-verify',
      taskId: 'backup-verify:' + randomUUID(),
      label: 'Verify backup contents',
      mode: 'read',
      paths: [file],
      signal,
      buffers: 2 * MAX_BUNDLE_MANIFEST + 256 * 1024,
      files: 2,
    },
    () => verifyBackupContents(file, signal),
  );
}
async function verifyBackupContents(file: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const handle = await open(file, 'r');
  let length: number, expected: string;
  try {
    const readExactly = async (buffer: Buffer, position: number) => {
      let offset = 0;
      while (offset < buffer.length) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
        if (!bytesRead) throw new AppError('备份清单被截断');
        offset += bytesRead;
      }
    };
    const prefix = Buffer.alloc(12);
    await readExactly(prefix, 0);
    if (prefix.subarray(0, 8).toString() !== 'SAKURA01') throw new AppError('备份文件格式错误');
    length = prefix.readUInt32BE(8);
    if (length < 2 || length > MAX_BUNDLE_MANIFEST) throw new AppError('备份清单长度错误');
    const manifest = Buffer.alloc(length);
    await readExactly(manifest, 12);
    const metadata = JSON.parse(manifest.toString());
    expected = metadata.sha256;
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new AppError('备份校验信息错误');
    if (metadata.trustedBoot) decodeTrustedBootArchive(metadata.trustedBoot);
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  const disk = createReadStream(file, { start: 12 + length, signal });
  try {
    for await (const chunk of disk) {
      signal.throwIfAborted();
      hash.update(chunk);
    }
  } finally {
    disk.destroy();
    await finished(disk).catch(() => {});
  }
  if (hash.digest('hex') !== expected) throw new AppError('备份磁盘校验失败');
  const whole = createHash('sha256');
  const bytes = createReadStream(file, { signal });
  try {
    for await (const chunk of bytes) whole.update(chunk);
  } finally {
    bytes.destroy();
    await finished(bytes).catch(() => {});
  }
  return whole.digest('hex');
}
export class Backups {
  jobs = new Jobs('backups');
  private timer: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closed = false;
  private attempts = new Map<string, number>();
  constructor(
    private machines: Machines,
    private bundles: Bundles,
    private secrets = new Secrets(machines),
    private storage: StorageRuntime = storageRuntime,
  ) {
    this.timer = setInterval(() => {
      if (!this.ticking)
        this.ticking = this.tick().finally(() => {
          this.ticking = undefined;
        });
    }, 60000);
    this.timer.unref();
  }
  private directory(id: string) {
    return join(DATA, 'backups', checkedId(id));
  }
  private file(id: string, backupId: string, directory?: string, encrypted = false) {
    return join(
      directory ? join(directory, 'sakura-backups', checkedId(id)) : this.directory(id),
      checkedId(backupId) + (encrypted ? '.sakura.enc' : '.sakura'),
    );
  }
  private recordFile(id: string, item: BackupRecord) {
    return this.file(id, item.id, item.directory, item.encrypted);
  }
  private removeFile(id: string, item: BackupRecord) {
    return item.storage === 'blocks'
      ? backupBlocks().remove(id, item.id)
      : rm(this.recordFile(id, item), { force: true });
  }
  async downloadable(id: string, backupId: string): Promise<BackupDownload> {
    const state = await this.state(id),
      item = state.items.find((v) => v.id === checkedId(backupId));
    if (!item) throw new AppError('备份不存在', 404);
    if (item.storage === 'blocks') {
      const manifest = await this.blockManifest(id, item);
      return {
        type: 'stream',
        name: `${this.machines.get(id).name}-${item.id}.sakura`,
        bytes: manifest.bytes,
        write: (output: Writable, signal: AbortSignal) =>
          this.storage.run(
            {
              owner: 'core:backups',
              taskId: 'backup-download:' + randomUUID(),
              label: 'Stream content blocks',
              mode: 'read',
              paths: [DATA],
              signal,
              buffers: 36 * 1024 ** 2,
              files: 4,
            },
            async () => {
              try {
                await backupBlocks().writeTo(id, item.id, item.checksum, output, signal);
              } finally {
                output.destroy();
                await finished(output).catch(() => {});
              }
            },
          ),
      };
    }
    return {
      type: 'file',
      path: this.recordFile(id, item),
      name: `${this.machines.get(id).name}-${item.id}${item.encrypted ? '.sakura.enc' : '.sakura'}`,
    };
  }
  private async plain<T>(
    id: string,
    item: BackupRecord,
    password: string | undefined,
    signal: AbortSignal,
    work: (file: string) => Promise<T>,
    lease: StorageLease,
  ) {
    if (item.storage === 'blocks') {
      if (item.encrypted) throw new AppError('加密备份不能使用块存储');
      return backupBlocks().withFile(id, item.id, item.checksum, signal, work, lease.cleanupPending);
    }
    const file = this.recordFile(id, item);
    if (!item.encrypted) return work(file);
    const value = password || (item.passwordSecret ? await this.secrets.value(id, item.passwordSecret) : '');
    if (!value) throw new AppError('请输入这份备份的加密密码');
    return withDecrypted(file, value, work, signal, lease.cleanupPending);
  }
  private async withReadBudget<T>(
    id: string,
    item: BackupRecord,
    signal: AbortSignal,
    work: (lease: StorageLease) => Promise<T>,
    restore = false,
  ) {
    const file = this.recordFile(id, item);
    const bytes =
      item.storage === 'blocks'
        ? (await this.blockManifest(id, item, signal)).bytes
        : (await stat(file)).size;
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 129 * 1024 ** 3)
      throw new AppError('备份文件大小无效');
    const materialized = !!item.encrypted || item.storage === 'blocks';
    return this.storage.run(
      {
        owner: 'core:backups',
        taskId: 'backup-read:' + randomUUID(),
        label: restore ? 'Verify and restore backup' : 'Read and verify backup',
        mode: materialized || restore ? 'write' : 'read',
        paths: [file, DATA],
        signal,
        buffers: item.storage === 'blocks' ? 36 * 1024 ** 2 : 2 * MAX_BUNDLE_MANIFEST + 4 * 1024 ** 2,
        files: 8,
        temporary: [{ path: DATA, bytes: bytes * ((materialized ? 1 : 0) + (restore ? 2 : 0)) }],
      },
      work,
    );
  }
  private blockManifest(id: string, item: BackupRecord, signal?: AbortSignal) {
    return this.storage.run(
      {
        owner: 'core:backup-manifest',
        taskId: 'backup-manifest:' + randomUUID(),
        label: 'Read content block manifest',
        mode: 'read',
        paths: [DATA],
        signal,
        buffers: 32 * 1024 ** 2,
        files: 1,
      },
      () => backupBlocks().read(id, item.id, item.checksum),
    );
  }
  private async state(id: string): Promise<BackupState> {
    this.machines.get(id);
    return (await this.metadata(id).read()).value;
  }
  private metadata(id: string) {
    return metadataFile<BackupState>(join(this.directory(id), 'index.json'), () => ({
      policy: backupPolicySchema.parse({}),
      items: [],
    }));
  }
  private async saveState(id: string, state: BackupState) {
    await this.metadata(id).replace(state);
  }
  async view(id: string) {
    const state = await this.state(id);
    return {
      ...state,
      bytes: state.items.reduce((sum, v) => sum + v.bytes, 0),
      job: this.jobs.view(id),
      waitingForShutdown: state.policy.enabled && this.machines.live.has(id),
      maintenance: await inMaintenance(id),
    };
  }
  async policy(id: string, value: unknown) {
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id);
      state.policy = backupPolicySchema.parse(value);
      if (state.policy.directory) await regularDirectory(state.policy.directory);
      if (state.policy.passwordSecret)
        passwordSchema.parse(await this.secrets.value(id, state.policy.passwordSecret));
      await this.saveState(id, state);
      return state;
    });
  }
  async tick(now = Date.now()) {
    for (const id of this.machines.records.keys()) {
      if (this.closed || this.machines.live.has(id) || this.jobs.view(id)?.status === 'running') continue;
      try {
        if (await inMaintenance(id, now)) continue;
        const state = await this.state(id);
        if (
          state.policy.enabled &&
          now - (this.attempts.get(id) || 0) > 300000 &&
          (!state.lastSuccess || now - Date.parse(state.lastSuccess) >= state.policy.intervalHours * 3600000)
        ) {
          this.attempts.set(id, now);
          await this.run(id);
        }
      } catch {
        /* Per-machine failures are surfaced by the task history. */
      }
    }
  }
  async run(id: string, password?: string) {
    return this.machines.locked(`backups:${id}`, async () => {
      this.machines.requireStopped(id);
      const state = await this.state(id);
      const encryptionPassword =
        password ||
        (state.policy.passwordSecret ? await this.secrets.value(id, state.policy.passwordSecret) : undefined);
      if (encryptionPassword) passwordSchema.parse(encryptionPassword);
      if (encryptionPassword && state.policy.deduplicate)
        throw new AppError('加密备份不支持内容去重，请先关闭块级去重策略');
      if (state.policy.directory) await regularDirectory(state.policy.directory);
      return this.jobs.start(
        id,
        async (log, signal, update) => {
          const backupId = randomUUID(),
            encrypted = !!encryptionPassword,
            file = this.file(id, backupId, state.policy.directory, encrypted),
            temp = file + '.part',
            plainTemp = file + '.plain.part';
          return this.bundles.withExportBudget(
            id,
            signal,
            async (diskBytes, exportFile) => {
              const bundleBytes = Math.min(32 * 1024 ** 3, diskBytes + MAX_BUNDLE_MANIFEST + 12);
              return this.storage.run(
                {
                  owner: 'core:backups',
                  taskId: 'backup:' + backupId,
                  label: 'Create and verify backup',
                  mode: 'write',
                  paths: [join(vmDir(id), 'disk.qcow2'), file, DATA],
                  buffers: 2 * MAX_BUNDLE_MANIFEST + 4 * 1024 ** 2,
                  files: 8,
                  signal,
                  temporaryPhases: [
                    [
                      { path: DATA, bytes: diskBytes },
                      { path: file, bytes: bundleBytes },
                    ],
                    ...(encrypted
                      ? [
                          [
                            { path: DATA, bytes: bundleBytes },
                            { path: file, bytes: 2 * bundleBytes + 52 },
                          ],
                        ]
                      : []),
                    ...(state.policy.deduplicate
                      ? [
                          [
                            { path: DATA, bytes: bundleBytes },
                            { path: file, bytes: bundleBytes },
                          ],
                        ]
                      : []),
                  ],
                },
                async (lease) => {
                  await mkdir(this.directory(id), { recursive: true });
                  if (state.policy.directory)
                    await mkdir(join(state.policy.directory, 'sakura-backups', id), { recursive: true });
                  let published = false,
                    indexed = false;
                  try {
                    log('正在生成独立备份包…\n');
                    update('导出磁盘', 10);
                    const output = createWriteStream(encrypted ? plainTemp : temp, {
                      flags: 'wx',
                      mode: 0o600,
                    });
                    output.on('error', () => {});
                    try {
                      await exportFile(
                        output,
                        () => {},
                        (state.policy.bandwidthMiBps || 0) * 1024 ** 2,
                        lease.cleanupPending,
                      );
                    } finally {
                      output.destroy();
                      await finished(output).catch(() => {});
                    }
                    signal.throwIfAborted();
                    update('校验备份', 80);
                    await verifyBackup(encrypted ? plainTemp : temp, signal, lease);
                    if (encrypted) {
                      update('加密备份', 90);
                      await encryptFile(plainTemp, temp, encryptionPassword!, signal);
                      await withDecrypted(
                        temp,
                        encryptionPassword!,
                        (plain) => verifyBackup(plain, signal, lease),
                        signal,
                        lease.cleanupPending,
                      );
                    }
                    const checksum = await fileHash(temp, signal),
                      bytes = (await stat(temp)).size;
                    if (bytes > state.policy.maxGiB * 1024 ** 3)
                      throw new AppError('单个备份超过容量上限，请提高备份容量限制');
                    signal.throwIfAborted();
                    if (state.policy.deduplicate) {
                      update('校验并复用内容块', 95);
                      await backupBlocks().pack(id, backupId, temp, checksum, signal, lease.cleanupPending);
                    } else await rename(temp, file);
                    published = true;
                    const record: BackupRecord = {
                      id: backupId,
                      bytes,
                      checksum,
                      createdAt: new Date().toISOString(),
                      verifiedAt: new Date().toISOString(),
                      directory: state.policy.directory || undefined,
                      encrypted,
                      ...(state.policy.deduplicate ? { storage: 'blocks' as const } : {}),
                      passwordSecret: encrypted && !password ? state.policy.passwordSecret : undefined,
                      retainUntil: state.policy.lockDays
                        ? new Date(Date.now() + state.policy.lockDays * 86400000).toISOString()
                        : undefined,
                    };
                    state.items.unshift(record);
                    state.lastSuccess = record.createdAt;
                    // Publish the verified backup before pruning any previous good copy.
                    await this.saveState(id, state);
                    indexed = true;
                    while (
                      state.items.length > state.policy.keep ||
                      state.items.reduce((sum, v) => sum + v.bytes, 0) > state.policy.maxGiB * 1024 ** 3
                    ) {
                      const old = state.items.findLast((item) => item.id !== backupId && !backupLocked(item));
                      if (!old) {
                        log('保留期内的备份受到保护，暂时超过份数或总容量上限；到期后再清理。\n');
                        break;
                      }
                      state.items = state.items.filter((item) => item.id !== old.id);
                      await this.saveState(id, state);
                      await this.removeFile(id, old);
                    }
                    log(`备份已完成并校验，保留 ${state.items.length} 份。\n`);
                  } catch (error) {
                    try {
                      if (published && !indexed) {
                        if (state.policy.deduplicate) await backupBlocks().remove(id, backupId);
                        else await rm(file, { force: true });
                      }
                    } catch (cleanup) {
                      lease.cleanupPending(cleanup);
                      throw new AggregateError([error, cleanup], 'Backup cleanup is not confirmed');
                    }
                    throw error;
                  } finally {
                    const removed = await Promise.allSettled([
                      rm(temp, { force: true }),
                      rm(plainTemp, { force: true }),
                    ]);
                    const failed = removed
                      .filter((item) => item.status === 'rejected')
                      .map((item) => item.reason);
                    if (failed.length) {
                      const error = new AggregateError(
                        failed,
                        'Backup temporary-file cleanup is not confirmed',
                      );
                      lease.cleanupPending(error);
                      throw error;
                    }
                  }
                },
              );
            },
            this.storage,
          );
        },
        {
          title: encryptionPassword ? '创建加密备份' : '创建备份',
          vmId: id,
          action: encryptionPassword ? undefined : 'run',
        },
      );
    });
  }
  async operate(
    id: string,
    backupId: string,
    action: 'verify' | 'restore' | 'delete',
    name?: string,
    password?: string,
  ) {
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id),
        item = state.items.find((v) => v.id === backupId);
      if (!item) throw new AppError('备份不存在', 404);
      if (action === 'delete') {
        if (backupLocked(item))
          throw new AppError('备份在保留锁定期内，不能删除：' + item.retainUntil, 423, 'BACKUP_LOCKED');
        state.items = state.items.filter((v) => v !== item);
        await this.saveState(id, state);
        await this.removeFile(id, item);
        return { ok: true };
      }
      if (action === 'restore' && !/^[a-z][a-z0-9-]{0,31}$/.test(name || ''))
        throw new AppError('请输入新实例名称');
      return this.jobs.start(
        id,
        async (log, signal) => {
          return this.withReadBudget(
            id,
            item,
            signal,
            async (lease) => {
              try {
                if (
                  item.storage !== 'blocks' &&
                  (await fileHash(this.recordFile(id, item), signal)) !== item.checksum
                )
                  throw new AppError('备份包与记录的校验值不符');
                await this.plain(
                  id,
                  item,
                  password,
                  signal,
                  async (file) => {
                    await verifyBackup(file, signal, lease);
                    item.verifiedAt = new Date().toISOString();
                    delete item.error;
                    await this.saveState(id, state);
                    log('备份完整性校验通过。\n');
                    if (action === 'restore') {
                      const source = createReadStream(file, { signal });
                      try {
                        const vm = await this.bundles.import(
                          name!,
                          source,
                          signal,
                          undefined,
                          undefined,
                          lease.cleanupPending,
                        );
                        log(`已恢复为新实例 ${vm.name}。\n`);
                      } finally {
                        source.destroy();
                        await finished(source).catch(() => {});
                      }
                    }
                  },
                  lease,
                );
              } catch (error) {
                item.error = (error as Error).message;
                await this.saveState(id, state);
                throw error;
              }
            },
            action === 'restore',
          );
        },
        { title: action === 'verify' ? '校验备份' : '恢复备份为新实例', vmId: id },
      );
    });
  }
  /** Keep the selected backup and its content blocks stable throughout a reader's operation. */
  async withVerifiedFile<T>(
    id: string,
    backupId: string,
    password: string | undefined,
    signal: AbortSignal,
    work: (file: string) => Promise<T>,
  ) {
    if (this.closed) throw new AppError('备份服务正在关闭', 503);
    return this.machines.locked(`backups:${id}`, async () => {
      signal.throwIfAborted();
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id),
        item = state.items.find((value) => value.id === checkedId(backupId));
      if (!item) throw new AppError('备份不存在', 404);
      return this.withReadBudget(id, item, signal, async (lease) => {
        if (
          item.storage !== 'blocks' &&
          (await fileHash(this.recordFile(id, item), signal)) !== item.checksum
        )
          throw new AppError('备份包与记录的校验值不符');
        return this.plain(
          id,
          item,
          password,
          signal,
          async (file) => {
            const checksum = await verifyBackup(file, signal, lease);
            if (!item.encrypted && checksum !== item.checksum) throw new AppError('备份包与记录的校验值不符');
            signal.throwIfAborted();
            this.machines.requireUnlocked(id);
            return work(file);
          },
          lease,
        );
      });
    });
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.ticking;
    await this.jobs.close();
  }
}

export function backupLocked(item: Pick<BackupRecord, 'retainUntil'>, now = Date.now()) {
  return (
    !!item.retainUntil &&
    (!Number.isFinite(Date.parse(item.retainUntil)) || Date.parse(item.retainUntil) > now)
  );
}

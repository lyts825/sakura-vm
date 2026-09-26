import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, open } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, DATA, checkedId } from './model.ts';
import type { Machines } from './machines.ts';
import type { Bundles } from './bundles.ts';
import { Jobs } from './jobs.ts';
import { Secrets, secretName } from './secrets.ts';
import { fileHash, regularDirectory } from './local-store.ts';
import { encryptFile, withDecrypted, passwordSchema } from './encrypted-backups.ts';
import { inMaintenance } from './automation-policy.ts';

export const backupPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(720).default(24),
    keep: z.number().int().min(1).max(30).default(7),
    maxGiB: z.number().min(1).max(512).default(32),
    lockDays: z.number().int().min(0).max(3650).optional(),
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
  .strict();
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
};
type BackupState = { policy: BackupPolicy; items: BackupRecord[]; lastSuccess?: string };
export async function verifyBackup(file: string, signal: AbortSignal) {
  const handle = await open(file, 'r');
  let length: number, expected: string;
  try {
    const prefix = Buffer.alloc(12);
    await handle.read(prefix, 0, 12, 0);
    if (prefix.subarray(0, 8).toString() !== 'SAKURA01') throw new AppError('备份文件格式错误');
    length = prefix.readUInt32BE(8);
    if (length < 2 || length > 300000) throw new AppError('备份清单长度错误');
    const manifest = Buffer.alloc(length);
    await handle.read(manifest, 0, length, 12);
    expected = JSON.parse(manifest.toString()).sha256;
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new AppError('备份校验信息错误');
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { start: 12 + length, signal })) {
    signal.throwIfAborted();
    hash.update(chunk);
  }
  if (hash.digest('hex') !== expected) throw new AppError('备份磁盘校验失败');
  const whole = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) whole.update(chunk);
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
  async downloadable(id: string, backupId: string) {
    const state = await this.state(id),
      item = state.items.find((v) => v.id === checkedId(backupId));
    if (!item) throw new AppError('备份不存在', 404);
    return {
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
  ) {
    const file = this.recordFile(id, item);
    if (!item.encrypted) return work(file);
    const value = password || (item.passwordSecret ? await this.secrets.value(id, item.passwordSecret) : '');
    if (!value) throw new AppError('请输入这份备份的加密密码');
    return withDecrypted(file, value, work, signal);
  }
  private async state(id: string): Promise<BackupState> {
    this.machines.get(id);
    try {
      return JSON.parse(await readFile(join(this.directory(id), 'index.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { policy: backupPolicySchema.parse({}), items: [] };
    }
  }
  private async saveState(id: string, state: BackupState) {
    const dir = this.directory(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.json.tmp'), JSON.stringify(state), { mode: 0o600 });
    await rename(join(dir, 'index.json.tmp'), join(dir, 'index.json'));
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
      if (state.policy.directory) await regularDirectory(state.policy.directory);
      return this.jobs.start(
        id,
        async (log, signal, update) => {
          const backupId = randomUUID(),
            encrypted = !!encryptionPassword,
            file = this.file(id, backupId, state.policy.directory, encrypted),
            temp = file + '.part',
            plainTemp = file + '.plain.part';
          await mkdir(this.directory(id), { recursive: true });
          if (state.policy.directory)
            await mkdir(join(state.policy.directory, 'sakura-backups', id), { recursive: true });
          let published = false;
          try {
            log('正在生成独立备份包…\n');
            update('导出磁盘', 10);
            const output = createWriteStream(encrypted ? plainTemp : temp, { flags: 'wx', mode: 0o600 });
            output.on('error', () => {});
            try {
              await this.bundles.export(
                id,
                output,
                () => {},
                signal,
                (state.policy.bandwidthMiBps || 0) * 1024 ** 2,
              );
            } finally {
              output.destroy();
            }
            signal.throwIfAborted();
            update('校验备份', 80);
            await verifyBackup(encrypted ? plainTemp : temp, signal);
            if (encrypted) {
              update('加密备份', 90);
              await encryptFile(plainTemp, temp, encryptionPassword!, signal);
              await withDecrypted(temp, encryptionPassword!, (plain) => verifyBackup(plain, signal), signal);
            }
            const checksum = await fileHash(temp, signal),
              bytes = (await stat(temp)).size;
            if (bytes > state.policy.maxGiB * 1024 ** 3)
              throw new AppError('单个备份超过容量上限，请提高备份容量限制');
            signal.throwIfAborted();
            await rename(temp, file);
            published = true;
            const record: BackupRecord = {
              id: backupId,
              bytes,
              checksum,
              createdAt: new Date().toISOString(),
              verifiedAt: new Date().toISOString(),
              directory: state.policy.directory || undefined,
              encrypted,
              passwordSecret: encrypted && !password ? state.policy.passwordSecret : undefined,
              retainUntil: state.policy.lockDays
                ? new Date(Date.now() + state.policy.lockDays * 86400000).toISOString()
                : undefined,
            };
            state.items.unshift(record);
            state.lastSuccess = record.createdAt;
            // Publish the verified backup before pruning any previous good copy.
            await this.saveState(id, state);
            while (
              state.items.length > state.policy.keep ||
              state.items.reduce((sum, v) => sum + v.bytes, 0) > state.policy.maxGiB * 1024 ** 3
            ) {
              const old = state.items.findLast((item) => item.id !== backupId && !backupLocked(item));
              if (!old) {
                log('保留期内的备份受到保护，暂时超过份数或总容量上限；到期后再清理。\n');
                break;
              }
              await rm(this.recordFile(id, old), { force: true });
              state.items = state.items.filter((item) => item.id !== old.id);
              await this.saveState(id, state);
            }
            log(`备份已完成并校验，保留 ${state.items.length} 份。\n`);
          } catch (error) {
            if (published && !state.items.some((v) => v.id === backupId)) await rm(file, { force: true });
            throw error;
          } finally {
            await rm(temp, { force: true });
            await rm(plainTemp, { force: true });
          }
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
        await rm(this.recordFile(id, item), { force: true });
        state.items = state.items.filter((v) => v !== item);
        await this.saveState(id, state);
        return { ok: true };
      }
      if (action === 'restore' && !/^[a-z][a-z0-9-]{0,31}$/.test(name || ''))
        throw new AppError('请输入新实例名称');
      return this.jobs.start(
        id,
        async (log, signal) => {
          try {
            const checksum = await fileHash(this.recordFile(id, item), signal);
            if (checksum !== item.checksum) throw new AppError('备份包与记录的校验值不符');
            await this.plain(id, item, password, signal, (file) => verifyBackup(file, signal));
            item.verifiedAt = new Date().toISOString();
            delete item.error;
            await this.saveState(id, state);
            log('备份完整性校验通过。\n');
          } catch (error) {
            item.error = (error as Error).message;
            await this.saveState(id, state);
            throw error;
          }
          if (action === 'restore') {
            const vm = await this.plain(id, item, password, signal, (file) =>
              this.bundles.import(name!, createReadStream(file), signal),
            );
            log(`已恢复为新实例 ${vm.name}。\n`);
          }
        },
        { title: action === 'verify' ? '校验备份' : '恢复备份为新实例', vmId: id },
      );
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

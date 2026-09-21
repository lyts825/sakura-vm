import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError, DATA, checkedId } from './model.ts';
import type { Machines } from './machines.ts';
import type { Bundles } from './bundles.ts';
import { Jobs } from './jobs.ts';

export const backupPolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(720).default(24),
    keep: z.number().int().min(1).max(30).default(7),
    maxGiB: z.number().min(1).max(512).default(32),
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
  private file(id: string, backupId: string) {
    return join(this.directory(id), checkedId(backupId) + '.sakura');
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
    };
  }
  async policy(id: string, value: unknown) {
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id);
      state.policy = backupPolicySchema.parse(value);
      await this.saveState(id, state);
      return state;
    });
  }
  async tick(now = Date.now()) {
    for (const id of this.machines.records.keys()) {
      if (this.closed || this.machines.live.has(id) || this.jobs.view(id)?.status === 'running') continue;
      try {
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
  async run(id: string) {
    return this.machines.locked(`backups:${id}`, async () => {
      this.machines.requireStopped(id);
      const state = await this.state(id);
      return this.jobs.start(
        id,
        async (log, signal, update) => {
          const backupId = randomUUID(),
            file = this.file(id, backupId),
            temp = file + '.part';
          await mkdir(this.directory(id), { recursive: true });
          let published = false;
          try {
            log('正在生成独立备份包…\n');
            update('导出磁盘', 10);
            const output = createWriteStream(temp, { flags: 'wx', mode: 0o600 });
            output.on('error', () => {});
            try {
              await this.bundles.export(id, output, () => {}, signal);
            } finally {
              output.destroy();
            }
            signal.throwIfAborted();
            update('校验备份', 80);
            const checksum = await verifyBackup(temp, signal),
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
            };
            state.items.unshift(record);
            state.lastSuccess = record.createdAt;
            // Publish the verified backup before pruning any previous good copy.
            await this.saveState(id, state);
            while (
              state.items.length > state.policy.keep ||
              state.items.reduce((sum, v) => sum + v.bytes, 0) > state.policy.maxGiB * 1024 ** 3
            ) {
              const old = state.items.at(-1)!;
              await rm(this.file(id, old.id), { force: true });
              state.items.pop();
              await this.saveState(id, state);
            }
            log(`备份已完成并校验，保留 ${state.items.length} 份。\n`);
          } catch (error) {
            if (published && !state.items.some((v) => v.id === backupId)) await rm(file, { force: true });
            throw error;
          } finally {
            await rm(temp, { force: true });
          }
        },
        { title: '创建备份', vmId: id, action: 'run' },
      );
    });
  }
  async operate(id: string, backupId: string, action: 'verify' | 'restore' | 'delete', name?: string) {
    return this.machines.locked(`backups:${id}`, async () => {
      if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待备份操作完成', 409);
      const state = await this.state(id),
        item = state.items.find((v) => v.id === backupId);
      if (!item) throw new AppError('备份不存在', 404);
      if (action === 'delete') {
        await rm(this.file(id, backupId), { force: true });
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
            const checksum = await verifyBackup(this.file(id, backupId), signal);
            if (checksum !== item.checksum) throw new AppError('备份包与记录的校验值不符');
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
            const vm = await this.bundles.import(name!, createReadStream(this.file(id, backupId)), signal);
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

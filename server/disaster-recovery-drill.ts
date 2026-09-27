import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { Backups } from './backups.ts';
import type { Bundles } from './bundles.ts';
import { AppError, guestPath } from './model.ts';

const pathSchema = z.string().max(4096).refine((value) => {
  try { guestPath(value); return true; } catch { return false; }
}, '需要有效的客户机绝对路径');
export const disasterRecoveryInput = z.object({
  mode: z.enum(['status', 'run']).default('status'),
  backupId: z.uuid().optional(),
  probePath: pathSchema.optional(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((value) => !value.expectedSha256 || !!value.probePath,
  '指定预期 SHA-256 时必须指定检查文件路径');

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export class DisasterRecoveryDrill {
  constructor(private machines: Machines, private backups: Backups, private bundles: Bundles) {}

  async status(id: string) {
    const state = await this.backups.view(id);
    return { backups: state.items.map((item) => ({ id: item.id,
      createdAt: item.createdAt, bytes: item.bytes, encrypted: item.encrypted,
      storage: item.storage, verifiedAt: item.verifiedAt || null })) };
  }

  async run(id: string, input: unknown, action: 'check' | 'run', signal?: AbortSignal,
    log: (line: string) => void = () => {}) {
    const value = disasterRecoveryInput.parse(input);
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (action === 'check' || value.mode === 'status')
      return { ...(await this.status(id)), ready: true, executed: false };
    if (!value.backupId) throw new AppError('请选择要演练的备份', 400);
    const started = performance.now();
    const deadline = AbortSignal.timeout(360_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const name = 'drill-' + randomBytes(5).toString('hex');
    const path = value.probePath || '/workspace';
    let restoredId: string | undefined;
    let restoreMs: number | undefined;
    let bootMs: number | undefined;
    let probeSha256: string | undefined;
    let problem: string | undefined;
    let cleanupError: string | undefined;
    try {
      log(`正在校验备份 ${value.backupId} 并恢复临时实例…\n`);
      await this.backups.withVerifiedFile(id, value.backupId, undefined, combined,
        async (file) => {
          combined.throwIfAborted();
          const vm = await this.bundles.import(name, createReadStream(file), combined);
          restoredId = vm.id;
          restoreMs = Math.round(performance.now() - started);
          log(`备份已恢复到临时实例 ${name}；正在启动并检查。\n`);
          this.machines.requireUnlocked(id);
          const bootStarted = performance.now();
          await this.machines.start(vm.id);
          while (this.machines.state(vm.id) !== 'running') {
            combined.throwIfAborted();
            if (['stopped', 'error'].includes(this.machines.state(vm.id)))
              throw new AppError('恢复实例未能启动，请查看演练日志', 409);
            await delay(300, undefined, { signal: combined });
          }
          bootMs = Math.round(performance.now() - bootStarted);
          const command = value.expectedSha256
            ? `sha256sum -- ${quote(path)}` : `test -e ${quote(path)}`;
          const probe = await this.machines.exec(vm.id, command, 30_000, combined);
          combined.throwIfAborted();
          if (probe.code !== 0) throw new AppError(`恢复实例中无法验证 ${path}`, 409);
          if (value.expectedSha256) {
            probeSha256 = /^([a-f0-9]{64})\s/.exec(probe.stdout)?.[1];
            if (probeSha256 !== value.expectedSha256)
              throw new AppError(`恢复文件 ${path} 的 SHA-256 不匹配`, 409);
          }
          log(`恢复实例启动成功，路径 ${path} 检查通过。\n`);
        });
    } catch (error) {
      problem = deadline.aborted && !signal?.aborted ? '灾备演练超过 6 分钟' :
        String((error as Error).message || error);
      log(`演练失败：${problem}\n`);
    }
    if (restoredId) {
      try {
        await this.machines.stop(restoredId, true);
        await this.machines.delete(restoredId);
        log('临时恢复实例已清理。\n');
      } catch (error) {
        cleanupError = String((error as Error).message || error);
        log(`临时实例 ${name} 清理失败：${cleanupError}\n`);
      }
    }
    return { ready: !problem && !cleanupError, executed: true,
      backupId: value.backupId, probePath: path,
      ...(probeSha256 ? { probeSha256 } : {}),
      restoreMs: restoreMs ?? null, bootMs: bootMs ?? null,
      totalMs: Math.round(performance.now() - started),
      restoredName: name, temporaryVmId: restoredId || null,
      temporaryVmRemoved: !!restoredId && !cleanupError,
      ...(problem ? { error: problem } : {}),
      ...(cleanupError ? { cleanupError } : {}) };
  }
}

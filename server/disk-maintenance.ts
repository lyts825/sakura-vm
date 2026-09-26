import { randomUUID } from 'node:crypto';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, vmDir } from './model.ts';
import { readStore, regularDirectory, writeStore } from './local-store.ts';
import { distributions } from './images.ts';
import { guestTask } from './guest-task.ts';

export const diskMaintenancePolicySchema = z
  .object({
    enabled: z.boolean().default(false),
    intervalHours: z.number().int().min(1).max(8760).default(168),
    mode: z.enum(['trim', 'compact', 'both']).default('both'),
    compress: z.boolean().default(true),
  })
  .strict();
export type DiskMaintenancePolicy = z.infer<typeof diskMaintenancePolicySchema>;
export type DiskOperation = 'trim' | 'compact';
type Attempt = { startedAt: string; finishedAt?: string; error?: string; result?: Record<string, unknown> };
export type DiskMaintenanceState = {
  policy: DiskMaintenancePolicy;
  attempts: Partial<Record<DiskOperation, Attempt>>;
  successes: Partial<Record<DiskOperation, string>>;
};
const file = (id: string) => join(vmDir(id), 'disk-maintenance.json');
export async function diskMaintenanceState(id: string): Promise<DiskMaintenanceState> {
  const state = await readStore<DiskMaintenanceState>(file(id), () => ({
    policy: diskMaintenancePolicySchema.parse({}),
    attempts: {},
    successes: {},
  }));
  state.policy = diskMaintenancePolicySchema.parse(state.policy);
  return state;
}
export function diskMaintenanceDue(state: DiskMaintenanceState, status: string, now: number) {
  if (!state.policy.enabled) return null;
  const operation = status === 'running' ? 'trim' : status === 'stopped' ? 'compact' : null;
  if (!operation || (state.policy.mode !== 'both' && state.policy.mode !== operation)) return null;
  const attempt = Date.parse(state.attempts[operation]?.startedAt || ''),
    success = Date.parse(state.successes[operation] || '');
  if (Number.isFinite(attempt) && now - attempt < 300000) return null;
  return Number.isFinite(success) && now - success < state.policy.intervalHours * 3600000 ? null : operation;
}
export async function saveDiskMaintenancePolicy(machines: Machines, id: string, input: unknown) {
  return machines.locked('disk-maintenance:' + id, async () => {
    const vm = machines.get(id),
      policy = diskMaintenancePolicySchema.parse(input);
    if (policy.enabled && policy.mode !== 'compact' && !vm.hardware?.devices?.discard)
      throw new AppError('自动 TRIM 需要先在设备档案中启用 discard，并重新启动实例', 409);
    const state = await diskMaintenanceState(id);
    state.policy = policy;
    await writeStore(file(id), state);
    return state;
  });
}
const exists = async (path: string) =>
  lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });

/** Caller holds the VM lifecycle lock for the entire conversion and publication. */
async function compactDisk(
  machines: Machines,
  id: string,
  compress: boolean,
  signal: AbortSignal,
  log: (message: string) => void,
  update: (phase: string, progress?: number) => void,
) {
  const vm = machines.get(id);
  machines.requireStopped(id);
  if (vm.snapshots.length) throw new AppError('请先删除或导出内部快照后再整理磁盘', 409);
  if (vm.pendingResize) throw new AppError('请先启动并完成文件系统扩容，再停止实例整理磁盘', 409);
  await regularDirectory(vmDir(id));
  const source = join(vmDir(id), 'disk.qcow2'),
    temp = join(vmDir(id), '.disk.compact-' + randomUUID() + '.qcow2'),
    backup = join(vmDir(id), 'disk.qcow2.before-compact');
  if (await exists(backup))
    throw new AppError('发现上次整理保留的原磁盘，请先核验并处理 disk.qcow2.before-compact', 409);
  const before = await lstat(source);
  if (!before.isFile()) throw new AppError('实例磁盘必须是普通文件');
  const run = (args: string[]) => machines.engine.run('sakura-img', args, { timeoutMs: 1800000, signal });
  let linked = false,
    published = false;
  try {
    update('检查原磁盘', 5);
    await run(['check', '-f', 'qcow2', source]);
    update(compress ? '压缩并重建稀疏磁盘' : '重建稀疏磁盘', 10);
    await run([
      'convert',
      '-p',
      ...(compress ? ['-c'] : []),
      '-f',
      'qcow2',
      '-O',
      'qcow2',
      '-B',
      distributions[vm.distro || 'alpine'].file,
      '-F',
      'qcow2',
      source,
      temp,
    ]);
    update('校验整理后的磁盘内容', 75);
    await run(['check', '-f', 'qcow2', temp]);
    await run(['compare', '-f', 'qcow2', '-F', 'qcow2', source, temp]);
    const after = await lstat(temp);
    if (!after.isFile()) throw new AppError('转换结果不是普通磁盘文件');
    const handle = await open(temp, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    signal.throwIfAborted();
    // Keep a recovery hard link without ever removing the active disk pathname.
    await link(source, backup);
    linked = true;
    signal.throwIfAborted();
    update('发布已核验的磁盘', 90);
    await rename(temp, source);
    published = true;
    let recoveryCopy: string | undefined;
    try {
      await rm(backup);
    } catch {
      recoveryCopy = backup;
      log('磁盘已替换，但原磁盘恢复副本未能清理；下次整理前需处理该副本。\n');
    }
    log('磁盘整理完成，QCOW2 检查及逐扇区内容比较通过。\n');
    return { beforeBytes: before.size, afterBytes: after.size, compress, recoveryCopy };
  } finally {
    await rm(temp, { force: true });
    if (linked && !published) await rm(backup);
  }
}

export function runDiskMaintenance(
  machines: Machines,
  id: string,
  operation: DiskOperation,
  signal: AbortSignal,
  log: (message: string) => void = () => {},
  update: (phase: string, progress?: number) => void = () => {},
  now = Date.now(),
) {
  return machines.locked('disk-maintenance:' + id, () =>
    machines.locked(id, async () => {
      signal.throwIfAborted();
      const vm = machines.get(id),
        state = await diskMaintenanceState(id);
      const attempt: Attempt = { startedAt: new Date(now).toISOString() };
      state.attempts[operation] = attempt;
      await writeStore(file(id), state);
      try {
        let result: Record<string, unknown>;
        if (operation === 'compact')
          result = await compactDisk(machines, id, state.policy.compress, signal, log, update);
        else {
          if (machines.state(id) !== 'running') throw new AppError('TRIM 需要运行中的实例', 409);
          if (!vm.hardware?.devices?.discard)
            throw new AppError('请先在设备档案中启用 discard 并重新启动实例', 409);
          update('回收根文件系统未使用的块', 10);
          const trimmed = await guestTask(
            machines,
            id,
            "set -eu\ncommand -v fstrim >/dev/null || { echo '请先安装 fstrim（Alpine: util-linux；Debian/Ubuntu: util-linux）' >&2; exit 1; }\nsync\nfstrim -v /",
            signal,
            log,
            300000,
          );
          if (trimmed.code !== 0)
            throw new AppError(trimmed.stderr || trimmed.stdout || '根文件系统 TRIM 失败');
          result = { output: trimmed.stdout };
        }
        attempt.finishedAt = new Date().toISOString();
        attempt.result = result;
        state.successes[operation] = attempt.finishedAt;
        await writeStore(file(id), state);
        update('已完成', 100);
        return { operation, ...result };
      } catch (error) {
        attempt.finishedAt = new Date().toISOString();
        attempt.error = (error as Error).message;
        await writeStore(file(id), state);
        throw error;
      }
    }),
  );
}

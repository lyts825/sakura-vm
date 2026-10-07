/**
 * 模块职责：保存磁盘维护策略并执行 TRIM 或离线整理；替换前保留原磁盘恢复硬链接。
 * Module purpose: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 */
import { randomUUID } from 'node:crypto';
import { link, lstat, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { vmDir } from './paths.ts';
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
/**
 * 入口 / Entry: file.
 * 功能：在保存磁盘维护策略并执行 TRIM 或离线整理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `join(vmDir(id), 'disk-maintenance.json')` 供上层消费（`disk-maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-maintenance.ts`; this entry produces `join(vmDir(id), 'disk-maintenance.json')` for its caller. Module context: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 * 处理：通过 `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `join`, `vmDir`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: `join(vmDir(id), 'disk-maintenance.json')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const file = (id: string) => join(vmDir(id), 'disk-maintenance.json');
/**
 * 入口 / Entry: diskMaintenanceState.
 * 功能：在保存磁盘维护策略并执行 TRIM 或离线整理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `state` 供上层消费（`disk-maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-maintenance.ts`; this entry produces `state` for its caller. Module context: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 * 处理：通过 `readStore`, `file`, `diskMaintenancePolicySchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `readStore`, `file`, `diskMaintenancePolicySchema.parse`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string
 * 输出 / Returns: Promise<DiskMaintenanceState>；结果来自 / values from `state`.
 * 副作用 / Effects: 更新 / updates `state.policy`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function diskMaintenanceState(id: string): Promise<DiskMaintenanceState> {
  const state = await readStore<DiskMaintenanceState>(file(id), () => ({
    policy: diskMaintenancePolicySchema.parse({}),
    attempts: {},
    successes: {},
  }));
  state.policy = diskMaintenancePolicySchema.parse(state.policy);
  return state;
}
/**
 * 入口 / Entry: diskMaintenanceDue.
 * 功能：在保存磁盘维护策略并执行 TRIM 或离线整理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `null` / `Number.isFinite(success) && now - success < state.policy.intervalHours * 3600000 ? null : operation` 供上层消费（`disk-maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-maintenance.ts`; this entry produces `null` / `Number.isFinite(success) && now - success < state.policy.intervalHours * 3600000 ? null : operation` for its caller. Module context: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 * 分支 / Branches: `!state.policy.enabled`; `!operation || (state.policy.mode !== 'both' && state.policy.mode !== operation)`; `Number.isFinite(attempt) && now - attempt < 300000`.
 * 输入 / Inputs: state: DiskMaintenanceState; status: string; now: number
 * 输出 / Returns: `null`; `Number.isFinite(success) && now - success < state.policy.intervalHours * 3600000 ? null : operation`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function diskMaintenanceDue(state: DiskMaintenanceState, status: string, now: number) {
  if (!state.policy.enabled) return null;
  const operation = status === 'running' ? 'trim' : status === 'stopped' ? 'compact' : null;
  if (!operation || (state.policy.mode !== 'both' && state.policy.mode !== operation)) return null;
  const attempt = Date.parse(state.attempts[operation]?.startedAt || ''),
    success = Date.parse(state.successes[operation] || '');
  if (Number.isFinite(attempt) && now - attempt < 300000) return null;
  return Number.isFinite(success) && now - success < state.policy.intervalHours * 3600000 ? null : operation;
}
/**
 * 入口 / Entry: saveDiskMaintenancePolicy.
 * 功能：把本层请求转交 `machines.locked`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `machines.locked` and propagates the provider result or rejection.
 * 输入 / Inputs: machines: Machines; id: string; input: unknown
 * 输出 / Returns: `machines.locked('disk-maintenance:' + id, async () => { const vm = machines.get(id), policy = diskMaintenancePolicySchema.par…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function saveDiskMaintenancePolicy(machines: Machines, id: string, input: unknown) {
  /**
   * 入口 / Entry: saveDiskMaintenancePolicy.callback@51.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `state`.
   * 副作用 / Effects: `writeStore`; 更新 / updates `state.policy`.
   * 拒绝 / Refusals: 条件 / conditions `policy.enabled && policy.mode !== 'compact' && !vm.hardware?.devices?.discard`; 异常 / errors `new AppError('自动 TRIM 需要先在设备档案中启用 discard，并重新启动实例', 409)`.
   */
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
/**
 * 入口 / Entry: exists.
 * 功能：在保存磁盘维护策略并执行 TRIM 或离线整理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `lstat(path).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; })` 供上层消费（`disk-maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-maintenance.ts`; this entry produces `lstat(path).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; })` for its caller. Module context: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 * 处理：通过 `lstat().catch`, `lstat` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `lstat().catch`, `lstat`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: path: string
 * 输出 / Returns: `lstat(path).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const exists = async (path: string) =>
  lstat(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });

/** Caller holds the VM lifecycle lock for the entire conversion and publication. */
/**
 * 入口 / Entry: compactDisk.
 * 功能：在保存磁盘维护策略并执行 TRIM 或离线整理中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ beforeBytes: before.size, afterBytes: after.size, compress, recoveryCopy }` 供上层消费（`disk-maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `disk-maintenance.ts`; this entry produces `{ beforeBytes: before.size, afterBytes: after.size, compress, recoveryCopy }` for its caller. Module context: Stores maintenance policies and executes TRIM/offline compaction, retaining a recovery hard link before replacement.
 * 处理：通过 `machines.get`, `machines.requireStopped`, `regularDirectory`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.get`, `machines.requireStopped`, `regularDirectory`, `vmDir`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `linked && !published`.
 * 输入 / Inputs: machines: Machines; id: string; compress: boolean; signal: AbortSignal; log: (message: string) => void; update: (phase: string, progress?: number) => void
 * 输出 / Returns: `{ beforeBytes: before.size, afterBytes: after.size, compress, recoveryCopy }`.
 * 副作用 / Effects: `update`; `handle.close`; `rename`; `rm`; 更新 / updates `linked`, `published`, `recoveryCopy`.
 * 拒绝 / Refusals: 条件 / conditions `vm.diskEncryption`; `vm.snapshots.length`; `vm.pendingResize`; 异常 / errors `new AppError('加密磁盘暂不支持离线重建；可继续使用客户机 TRIM', 409)`; `new AppError('请先删除或导出内部快照后再整理磁盘', 409)`.
 * 收尾：退出 try 区域时始终执行 `await rm(temp, { force: true });`; `if (linked && !published) await rm(backup);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await rm(temp, { force: true });`; `if (linked && !published) await rm(backup);`; these steps also apply to exceptional exits.
 * 失败处理：catch 分支执行 `recoveryCopy = backup;`; `log('磁盘已替换，但原磁盘恢复副本未能清理；下次整理前需处理该副本。\n');`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `recoveryCopy = backup;`; `log('磁盘已替换，但原磁盘恢复副本未能清理；下次整理前需处理该副本。\n');`; these statements determine whether a failure is absorbed or rejected again.
 */
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
  if (vm.diskEncryption)
    throw new AppError('加密磁盘暂不支持离线重建；可继续使用客户机 TRIM', 409);
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
  /**
   * 入口 / Entry: compactDisk.run.
   * 功能：把本层请求转交 `machines.engine.run`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `machines.engine.run` and propagates the provider result or rejection.
   * 输入 / Inputs: args: string[]
   * 输出 / Returns: `machines.engine.run('sakura-img', args, { timeoutMs: 1800000, signal })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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

/**
 * 入口 / Entry: runDiskMaintenance.
 * 功能：把本层请求转交 `machines.locked`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `machines.locked` and propagates the provider result or rejection.
 * 输入 / Inputs: machines: Machines; id: string; operation: DiskOperation; signal: AbortSignal; log: (message: string) => void default=() => {}; update: (phase: string, progress?: number) => void default=() => {}; now: default=Date.now()
 * 输出 / Returns: `machines.locked('disk-maintenance:' + id, () => machines.locked(id, async () => { signal.throwIfAborted(); const vm = machine…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function runDiskMaintenance(
  machines: Machines,
  id: string,
  operation: DiskOperation,
  signal: AbortSignal,
  log: (message: string) => void = () => {},
  update: (phase: string, progress?: number) => void = () => {},
  now = Date.now(),
) {
  /**
   * 入口 / Entry: runDiskMaintenance.callback@157.
   * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（machines.locked）。
   * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (machines.locked).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ operation, ...result }`.
   * 副作用 / Effects: `writeStore`; `update`; 更新 / updates `state.attempts[operation]`, `result`, `attempt.finishedAt`, `attempt.result`.
   * 拒绝 / Refusals: 条件 / conditions `machines.state(id) !== 'running'`; `!vm.hardware?.devices?.discard`; `trimmed.code !== 0`; 异常 / errors `new AppError('TRIM 需要运行中的实例', 409)`; `new AppError('请先在设备档案中启用 discard 并重新启动实例', 409)`.
   * 失败处理：catch 分支执行 `attempt.finishedAt = new Date().toISOString();`; `attempt.error = (error as Error).message;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `attempt.finishedAt = new Date().toISOString();`; `attempt.error = (error as Error).message;`; these statements determine whether a failure is absorbed or rejected again.
   */
  return machines.locked('disk-maintenance:' + id, () =>
    machines.locked(id,
    /**
     * 中文功能：先持久记录维护尝试，再执行 compact 或运行中且启用 discard 的根分区 TRIM；成功/失败都保存结束时间与结果。
     * English: Persists the maintenance attempt before compact or root TRIM on a running discard-enabled VM, saving completion time/results on success or failure.
     * 所属 / Owner: runDiskMaintenance.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     */
    async () => {
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

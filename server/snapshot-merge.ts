/**
 * 模块职责：规划并应用快照文件合并，校验目标父目录和文件类型以保护现有目录结构。
 * Module purpose: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
 */
import type { BundlesV1 } from './service-contracts/v1.ts';
import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { DATA, vmDir } from './paths.ts';
import type { VmSnapshotMergePort } from './vm-ports.ts';
import { Bundles } from './bundles.ts';
import { Jobs } from './jobs.ts';
import { quote } from './shell.ts';
import { rescueSetup } from './rescue.ts';
import { parseSnapshotManifest, snapshotManifestCommand } from './snapshot-diff.ts';
import type { SnapshotDiffFile } from '../shared/snapshot-diff.ts';
import { snapshotMergeInputSchema } from '../shared/snapshot-merge.ts';

const SCAN_TIMEOUT_MS = 10 * 60_000;
const MAX_CHANGES = 200;
const MAX_BYTES = 64 * 1024 * 1024;

/**
 * 入口 / Entry: same.
 * 功能：从当前输入或状态计算 `a?.type === b?.type && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes && a?.target === b?.target`，供调用方后续验证或使用。
 * Purpose: Computes `a?.type === b?.type && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes && a?.target === b?.target` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: a: SnapshotDiffFile optional; b: SnapshotDiffFile optional
 * 输出 / Returns: `a?.type === b?.type && a?.sha256 === b?.sha256 && a?.bytes === b?.bytes && a?.target === b?.target`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function same(a?: SnapshotDiffFile, b?: SnapshotDiffFile) {
  return a?.type === b?.type && a?.sha256 === b?.sha256 &&
    a?.bytes === b?.bytes && a?.target === b?.target;
}

/** Paths changed on both sides to different content are never auto-resolved. */
/**
 * 入口 / Entry: planSnapshotMerge.
 * 功能：在规划并应用快照文件合并中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ apply: apply.filter((entry) => !conflicts.includes(entry.path)), conflicts: [...new Set(conflicts)].sort(), already }` 供上层消费（`snapshot-merge.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `snapshot-merge.ts`; this entry produces `{ apply: apply.filter((entry) => !conflicts.includes(entry.path)), conflicts: [...new Set(conflicts)].sort(), already }` for its caller. Module context: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
 * 处理：通过 `inline.sort`, `base.keys`, `branch.keys`, `base.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.sort`, `base.keys`, `branch.keys`, `base.get`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `same(previous, incoming)`; `same(incoming, current)`; `same(previous, current)`.
 * 输入 / Inputs: base: Map<string, SnapshotDiffFile>; branch: Map<string, SnapshotDiffFile>; target: Map<string, SnapshotDiffFile>
 * 输出 / Returns: `{ apply: apply.filter((entry) => !conflicts.includes(entry.path)), conflicts: [...new Set(conflicts)].sort(), already }`.
 * 副作用 / Effects: `already.push`; `apply.push`; `conflicts.push`; `path.startsWith`; `entry.path.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function planSnapshotMerge(base: Map<string, SnapshotDiffFile>,
  branch: Map<string, SnapshotDiffFile>, target: Map<string, SnapshotDiffFile>) {
  const apply: { path: string; file?: SnapshotDiffFile }[] = [];
  const conflicts: string[] = [];
  const already: string[] = [];
  for (const path of [...new Set([...base.keys(), ...branch.keys()])].sort()) {
    const previous = base.get(path), incoming = branch.get(path), current = target.get(path);
    if (same(previous, incoming)) continue;
    if (same(incoming, current)) already.push(path);
    else if (same(previous, current)) apply.push({ path, file: incoming });
    else conflicts.push(path);
  }
  // A file/symlink replacing a parent directory cannot be merged with a child.
  const incomingPaths = new Set([...branch.keys(), ...target.keys()]);
  for (const entry of apply) {
    for (const path of incomingPaths) {
      if (path.startsWith(entry.path + '/') || entry.path.startsWith(path + '/')) {
        const occupant = branch.get(path) || target.get(path);
        if (occupant?.type === 'symlink' || path.startsWith(entry.path + '/')) {
          conflicts.push(entry.path);
          break;
        }
      }
    }
  }
  return { apply: apply.filter((entry) => !conflicts.includes(entry.path)),
    conflicts: [...new Set(conflicts)].sort(), already };
}

/**
 * 入口 / Entry: mergeFileCommand.
 * 功能：在规划并应用快照文件合并中，执行此领域的具体处理步骤并返回其结果；本入口产生 `lines.join('\n')` 供上层消费（`snapshot-merge.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `snapshot-merge.ts`; this entry produces `lines.join('\n')` for its caller. Module context: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
 * 处理：通过 `path.slice().split`, `path.slice`, `relative.slice`, `lines.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `path.slice().split`, `path.slice`, `relative.slice`, `lines.push`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `file`.
 * 输入 / Inputs: path: string; file: SnapshotDiffFile optional
 * 输出 / Returns: `lines.join('\n')`.
 * 副作用 / Effects: `lines.push`; 更新 / updates `current`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function mergeFileCommand(path: string, file?: SnapshotDiffFile) {
  const relative = path.slice(1).split('/');
  const parents = relative.slice(0, -1);
  let current = '/mnt/target';
  const lines = ['set -eu'];
  for (const component of parents) {
    current += '/' + component;
    lines.push(`test ! -L ${quote(current)} || { echo '目标父目录为符号链接' >&2; exit 1; }`);
    lines.push(`test -d ${quote(current)} || mkdir ${quote(current)}`);
  }
  const dest = '/mnt/target' + path;
  lines.push(`test ! -d ${quote(dest)} || { echo '目标路径是目录' >&2; exit 1; }`);
  lines.push(`rm -f ${quote(dest)}`);
  if (file) {
    const source = '/mnt/compare' + path;
    lines.push(`test ${file.type === 'symlink' ? '-L' : '-f'} ${quote(source)}`);
    lines.push(`cp -a ${quote(source)} ${quote(dest)}`);
  }
  return lines.join('\n');
}

export class SnapshotMerge {
  readonly jobs = new Jobs('snapshot-merge');
  private closed = false;
  /**
   * 入口 / Entry: SnapshotMerge.constructor.
   * 功能：建立 SnapshotMerge 的规划并应用快照文件合并上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SnapshotMerge context for this module's responsibility: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: VmSnapshotMergePort; bundles: BundlesV1
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: VmSnapshotMergePort, private bundles: BundlesV1) {}

  /**
   * 入口 / Entry: SnapshotMerge.view.
   * 功能：在规划并应用快照文件合并中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ ...(vm.branchOrigin ? { branchOrigin: vm.branchOrigin } : {}), ...(sourceName ? { sourceName } : {}), runs: this.jobs.list(…` 供上层消费（`SnapshotMerge`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SnapshotMerge`; this entry produces `{ ...(vm.branchOrigin ? { branchOrigin: vm.branchOrigin } : {}), ...(sourceName ? { sourceName } : {}), runs: this.jobs.list(…` for its caller. Module context: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
   * 处理：通过 `this.machines.get`, `this.machines.records.get`, `this.jobs.list().filter().slice`, `this.jobs.list().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.records.get`, `this.jobs.list().filter().slice`, `this.jobs.list().filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ ...(vm.branchOrigin ? { branchOrigin: vm.branchOrigin } : {}), ...(sourceName ? { sourceName } : {}), runs: this.jobs.list(…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string) {
    const vm = this.machines.get(id);
    const sourceName = vm.branchOrigin ? this.machines.records.get(vm.branchOrigin.sourceVmId)?.name : undefined;
    return { ...(vm.branchOrigin ? { branchOrigin: vm.branchOrigin } : {}),
      ...(sourceName ? { sourceName } : {}),
      runs: this.jobs.list().filter((job) => job.vmId === id).slice(0, 20),
      ...(this.jobs.persistenceError ? { persistenceError: this.jobs.persistenceError } : {}) };
  }

  /**
   * 入口 / Entry: SnapshotMerge.run.
   * 功能：为分支和目标计算快照文件合并计划，并应用经过限制的变更。
   * Purpose: Computes snapshot file merge plans for branches/targets and applies bounded changes.
   * 设计：克隆和只读比较先形成三方证据，目标父路径及冲突核对后修改；失败保留原数据与诊断结果。
   * Design: Clones/read-only comparison establish three-way evidence before target/conflict checks and mutations; failure preserves source data/evidence.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.jobs.start(id, async (log, signal, update, saveResult) => { const root = join(DATA, 'plugins', 'snapshots'); await mkdir…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!sourceId`; `branch.diskEncryption || target.diskEncryption`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('仅能合并从快照克隆且保留基线的实例', 409)`.
   */
  run(id: string, raw: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const input = snapshotMergeInputSchema.parse(raw);
    const branch = this.machines.get(id);
    const sourceId = branch.branchOrigin?.sourceVmId;
    if (!sourceId) throw new AppError('仅能合并从快照克隆且保留基线的实例', 409);
    const target = this.machines.get(sourceId);
    if (branch.diskEncryption || target.diskEncryption)
      throw new AppError('加密实例暂不支持离线文件合并', 409);
    if (branch.sandbox || target.sandbox) throw new AppError('临时实例不能合并', 409);
    for (const vmId of [id, sourceId]) {
      this.machines.requireUnlocked(vmId);
      this.machines.requireStopped(vmId);
      if (this.machines.isBusy(vmId)) throw new AppError('实例正在执行其他操作', 409);
    }
    /**
     * 入口 / Entry: SnapshotMerge.run.callback@107.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update; saveResult
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `mkdir`; `update`; `execute`; `saveResult`; `this.machines.delete`; 更新 / updates `derivative`, `targetDisk`, `published`.
     * 拒绝 / Refusals: 条件 / conditions `dirname(temp) !== resolve(root) || !basename(temp).startsWith('merge-')`; 异常 / errors `new AppError('临时目录超出合并目录，拒绝清理', 500)`.
     * 收尾：退出 try 区域时始终执行 `if (derivative && !published) await this.machines.delete(derivative);`; `if (dirname(temp) !== resolve(root) || !basename(temp).startsWith('merge-')) throw new AppError('临时目录超出合并目录，拒绝清理', 500);`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (derivative && !published) await this.machines.delete(derivative);`; `if (dirname(temp) !== resolve(root) || !basename(temp).startsWith('merge-')) throw new AppError('临时目录超出合并目录，拒绝清理', 500);`; these steps also apply to exceptional exits.
     */
    return this.jobs.start(id, async (log, signal, update, saveResult) => {
      const root = join(DATA, 'plugins', 'snapshots');
      await mkdir(root, { recursive: true });
      const temp = await mkdtemp(join(root, 'merge-'));
      let derivative: string | undefined;
      let published = false;
      try {
        let targetDisk: string;
        if (input.mode === 'apply') {
          update('克隆目标实例，原实例保持不变');
          derivative = (await this.bundles.clone(sourceId, input.name!, undefined, signal)).id;
          targetDisk = join(vmDir(derivative), 'disk.qcow2');
        } else {
          targetDisk = join(temp, 'target.qcow2');
          /**
           * 入口 / Entry: SnapshotMerge.run.callback@121.
           * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
           * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          await this.machines.locked(sourceId, async () => {
            this.machines.requireStopped(sourceId);
            this.machines.requireUnlocked(sourceId);
            signal.throwIfAborted();
            await copyFile(join(vmDir(sourceId), 'disk.qcow2'), targetDisk);
          });
        }
        /**
         * 入口 / Entry: SnapshotMerge.run.callback@129.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.withRescue）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.withRescue).
         * 输入 / Inputs: rescueId; active
         * 输出 / Returns: `plan`.
         * 副作用 / Effects: `update`; `this.machines.exec`; `manifests.push`.
         * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; `listed.code !== 0`; `plan.apply.length > MAX_CHANGES || bytes > MAX_BYTES`; 异常 / errors `new AppError(prepared.stderr || `${role}磁盘挂载失败`, 409)`; `new AppError(listed.stderr || `${role}文件清单失败`, 409)`.
         */
        /**
         * 入口 / Entry: SnapshotMerge.run.execute.
         * 功能：在规划并应用快照文件合并中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.machines.withRescue(id, signal, update, async (rescueId, active) => { const mounts = ['source', 'compare', 'target'] as …` 供上层消费（`SnapshotMerge`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `SnapshotMerge`; this entry produces `this.machines.withRescue(id, signal, update, async (rescueId, active) => { const mounts = ['source', 'compare', 'target'] as …` for its caller. Module context: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
         * 处理：通过 `this.machines.withRescue`, `join`, `vmDir` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.machines.withRescue`, `join`, `vmDir`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.machines.withRescue(id, signal, update, async (rescueId, active) => { const mounts = ['source', 'compare', 'target'] as …`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const execute = async () => this.machines.withRescue(id, signal, update,
          /**
           * 中文功能：在救援系统挂载源/对比/目标，扫描完整清单并限制变更数量与字节；apply 且无冲突时逐项更新后 sync/umount。
           * English: Mounts source/compare/target in rescue, scans complete manifests and bounds changes/bytes, applying only conflict-free apply plans before sync/unmount.
           * 所属 / Owner: SnapshotMerge.run.execute.
           * 输入 / Inputs: rescueId; active.
           */
          async (rescueId, active) => {
            const mounts = ['source', 'compare', 'target'] as const;
            for (const role of mounts) {
              update(`挂载${role}磁盘`);
              const prepared = await this.machines.exec(rescueId,
                rescueSetup(input.partition, role, role === 'target' && input.mode === 'apply'),
                30_000, active);
              if (prepared.code !== 0)
                throw new AppError(prepared.stderr || `${role}磁盘挂载失败`, 409);
            }
            const manifests: Map<string, SnapshotDiffFile>[] = [];
            for (const role of mounts) {
              update(`扫描${role}文件`);
              const listed = await this.machines.exec(rescueId,
                snapshotManifestCommand(`/mnt/${role}`, input.path), SCAN_TIMEOUT_MS, active);
              if (listed.code !== 0)
                throw new AppError(listed.stderr || `${role}文件清单失败`, 409);
              manifests.push(parseSnapshotManifest(listed.stdout, `/mnt/${role}`));
            }
            const plan = planSnapshotMerge(manifests[0], manifests[1], manifests[2]);
            const bytes = plan.apply.reduce((sum, entry) => sum + (entry.file?.bytes || 0), 0);
            if (plan.apply.length > MAX_CHANGES || bytes > MAX_BYTES)
              throw new AppError(`一次最多合并 ${MAX_CHANGES} 个文件、${MAX_BYTES / 1048576} MiB`, 413);
            if (input.mode === 'apply' && plan.conflicts.length === 0) {
              update(`应用 ${plan.apply.length} 项文件变更`);
              for (const entry of plan.apply) {
                active.throwIfAborted();
                const changed = await this.machines.exec(rescueId,
                  mergeFileCommand(entry.path, entry.file), 30_000, active);
                if (changed.code !== 0)
                  throw new AppError(changed.stderr || `合并失败：${entry.path}`, 409);
              }
              const synced = await this.machines.exec(rescueId, 'sync; umount /mnt/target',
                30_000, active);
              if (synced.code !== 0) throw new AppError(synced.stderr || '合并磁盘同步失败', 409);
            }
            return plan;
          }, (message) => log(message), join(vmDir(id), 'branch-base.qcow2'),
          join(vmDir(id), 'disk.qcow2'), { file: targetDisk, writable: input.mode === 'apply' });
        const plan = derivative
          ? await this.machines.locked(derivative, execute)
          : await execute();
        const result = { mode: input.mode, branchVmId: id, targetVmId: sourceId,
          snapshotId: branch.branchOrigin!.snapshotId, path: input.path,
          applied: plan.apply.map((entry) => entry.path), conflicts: plan.conflicts,
          already: plan.already, ...(derivative && !plan.conflicts.length ? { mergedVmId: derivative } : {}),
          checkedAt: new Date().toISOString() };
        if (derivative && !plan.conflicts.length) {
          await this.machines.recordMerge(derivative, {
            branchVmId: id, targetVmId: sourceId,
            snapshotId: branch.branchOrigin!.snapshotId, path: input.path,
            mergedAt: result.checkedAt, appliedFiles: plan.apply.length,
          });
          published = true;
        }
        await saveResult(result);
        log(plan.conflicts.length
          ? `发现 ${plan.conflicts.length} 项冲突，未生成合并实例。\n`
          : `可应用 ${plan.apply.length} 项，已存在 ${plan.already.length} 项。\n`);
      } finally {
        if (derivative && !published) await this.machines.delete(derivative);
        if (dirname(temp) !== resolve(root) || !basename(temp).startsWith('merge-'))
          throw new AppError('临时目录超出合并目录，拒绝清理', 500);
        await rm(temp, { recursive: true, force: true });
      }
    }, { vmId: id, title: branch.name + ' · 快照分支合并', action: 'snapshot-merge' });
  }

  /**
   * 入口 / Entry: SnapshotMerge.close.
   * 功能：在规划并应用快照文件合并中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`SnapshotMerge`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SnapshotMerge`; the outcome is recorded in `this.closed`. Module context: Plans/applies snapshot file merges after checking target parents/types to protect existing directory structure.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() { this.closed = true; await this.jobs.close(); }
}

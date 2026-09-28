import { copyFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { AppError, DATA, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import { Bundles } from './bundles.ts';
import { Jobs } from './jobs.ts';
import { quote } from './files.ts';
import { rescueSetup } from './rescue.ts';
import { parseSnapshotManifest, snapshotManifestCommand } from './snapshot-diff.ts';
import type { SnapshotDiffFile } from '../shared/snapshot-diff.ts';
import { snapshotMergeInputSchema, type SnapshotMergeInput } from '../shared/snapshot-merge.ts';

const SCAN_TIMEOUT_MS = 10 * 60_000;
const MAX_CHANGES = 200;
const MAX_BYTES = 64 * 1024 * 1024;

function same(a?: SnapshotDiffFile, b?: SnapshotDiffFile) {
  return a?.type === b?.type && a?.sha256 === b?.sha256 &&
    a?.bytes === b?.bytes && a?.target === b?.target;
}

/** Paths changed on both sides to different content are never auto-resolved. */
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
  constructor(private machines: Machines, private bundles: Bundles) {}

  view(id: string) {
    const vm = this.machines.get(id);
    const sourceName = vm.branchOrigin ? this.machines.records.get(vm.branchOrigin.sourceVmId)?.name : undefined;
    return { ...(vm.branchOrigin ? { branchOrigin: vm.branchOrigin } : {}),
      ...(sourceName ? { sourceName } : {}),
      runs: this.jobs.list().filter((job) => job.vmId === id).slice(0, 20),
      ...(this.jobs.persistenceError ? { persistenceError: this.jobs.persistenceError } : {}) };
  }

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
          await this.machines.locked(sourceId, async () => {
            this.machines.requireStopped(sourceId);
            this.machines.requireUnlocked(sourceId);
            signal.throwIfAborted();
            await copyFile(join(vmDir(sourceId), 'disk.qcow2'), targetDisk);
          });
        }
        const execute = async () => this.machines.withRescue(id, signal, update,
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

  async close() { this.closed = true; await this.jobs.close(); }
}

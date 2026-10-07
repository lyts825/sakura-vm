/**
 * 模块职责：汇集存储诊断、磁盘整理及扩容维护，返回脱敏报告并协调客户机维护动作。
 * Module purpose: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
 */
import { networkFor } from './network/index.ts';
import { stat, statfs, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA } from './paths.ts';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { distributions } from './images.ts';
import { Jobs } from './jobs.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';
import { guestTask } from './guest-task.ts';
import {
  diskMaintenanceDue,
  diskMaintenanceState,
  runDiskMaintenance,
  saveDiskMaintenancePolicy,
  type DiskOperation,
} from './disk-maintenance.ts';
import { inMaintenance } from './automation-policy.ts';
import { backupBlocks } from './backup-blocks.ts';

const { createServer } = networkFor('core:maintenance');

export type DiagnosticCheck = {
  name: string;
  status: 'ok' | 'warning' | 'error' | 'skip';
  detail: string;
  suggestion?: string;
};
/**
 * 入口 / Entry: redact.
 * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `text .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[密钥已隐藏]') .replace( /(["']?(?:token…` 供上层消费（`maintenance.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `maintenance.ts`; this entry produces `text .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[密钥已隐藏]') .replace( /(["']?(?:token…` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
 * 处理：通过 `text.replace().replace().replace().replace().replace().replace`, `text.replace().replace().replace().replace().replace`, `text.replace().replace().replace().replace`, `text.replace().replace().replace` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `text.replace().replace().replace().replace().replace().replace`, `text.replace().replace().replace().replace().replace`, `text.replace().replace().replace().replace`, `text.replace().replace().replace`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `text .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[密钥已隐藏]') .replace( /(["']?(?:token…`.
 * 副作用 / Effects: `text.replace().replace().replace().replace().replace().replace`; `text.replace().replace().replace().replace().replace`; `text.replace().replace().replace().replace`; `text.replace().replace().replace`; `text.replace().replace`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function redact(text: string) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[密钥已隐藏]')
    .replace(
      /(["']?(?:token|password|secret|authorization|api[_-]?key)["']?\s*[:=]\s*)(["'])(.*?)\2/gi,
      '$1[已隐藏]',
    )
    .replace(/(authorization["'\s:=]+)(?:Bearer|Basic)\s+[^\s,"']+/gi, '$1[已隐藏]')
    .replace(/(token|password|secret|authorization|api[_-]?key)(["'\s:=]+)[^\s,"']+/gi, '$1$2[已隐藏]')
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[凭证已隐藏]@')
    .replace(/[A-Za-z]:[\\/][^\r\n"<>]+/g, '[本机路径已隐藏]');
}
/**
 * 入口 / Entry: hostPortIssue.
 * 功能：从当前输入或状态计算 `new Promise((resolve) => { const server = createServer(); server.once('error', (error: NodeJS.ErrnoException) => resolve(erro…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise((resolve) => { const server = createServer(); server.once('error', (error: NodeJS.ErrnoException) => resolve(erro…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: port: number
 * 输出 / Returns: Promise<string | null>；结果来自 / values from `new Promise((resolve) => { const server = createServer(); server.once('error', (error: NodeJS.ErrnoException) => resolve(erro…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function hostPortIssue(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code || error.message));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => resolve(error ? error.message : null));
    });
  });
}
export const growFilesystem = String.raw`set -eu
root=$(awk '$2=="/" { print $1; exit }' /proc/mounts)
root=$(readlink -f "$root")
case "$root" in /dev/vda) part='';; /dev/vda[0-9]*) part=$(cat /sys/class/block/$(basename "$root")/partition);; *) echo '当前根分区布局不支持自动扩容' >&2; exit 1;; esac
kind=$(awk '$2=="/" { print $3; exit }' /proc/mounts)
case "$kind" in ext4|ext3|ext2) ;; *) echo '当前文件系统不支持自动扩容' >&2; exit 1;; esac
if command -v apk >/dev/null; then apk add --no-cache --timeout 30 cloud-utils-growpart e2fsprogs-extra; else export DEBIAN_FRONTEND=noninteractive; apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update; apt-get -y install cloud-guest-utils e2fsprogs; fi
if [ -n "$part" ]; then
  output=$(growpart /dev/vda "$part" 2>&1) || { echo "$output"; echo "$output" | grep -q NOCHANGE || exit 1; }
  echo "$output"
fi
resize2fs "$root"
df -h /
disk_sectors=$(cat /sys/class/block/vda/size)
root_kib=$(df -Pk / | awk 'NR==2 { print $2 }')
[ "$root_kib" -gt $((disk_sectors * 512 / 1024 * 80 / 100)) ] || { echo '文件系统容量尚未达到磁盘容量的 80%，请检查分区布局' >&2; exit 1; }`;
export class Maintenance {
  jobs = new Jobs('maintenance');
  private reports = new Map<string, { createdAt: string; checks: DiagnosticCheck[]; log: string }>();
  /**
   * 入口 / Entry: Maintenance.onChange.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; the calls and state transitions below complete the operation. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.records.values`, `this.machines.state`, `this.resizeAttempted.has`, `this.resizeAttempted.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.records.values`, `this.machines.state`, `this.resizeAttempted.has`, `this.resizeAttempted.add`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `vm.pendingResize && this.machines.state(vm.id) === 'running' && !this.resizeAttempted.has(vm.id)`; `!this.machines.live.has(vm.id)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.resizeAttempted.add`; `this.resizeAttempted.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private onChange = () => {
    for (const vm of this.machines.records.values()) {
      if (vm.pendingResize && this.machines.state(vm.id) === 'running' && !this.resizeAttempted.has(vm.id)) {
        this.resizeAttempted.add(vm.id);
        this.finishResize(vm.id);
      }
      if (!this.machines.live.has(vm.id)) this.resizeAttempted.delete(vm.id);
    }
  };
  private resizeAttempted = new Set<string>();
  private closed = false;
  private ticking?: Promise<void>;
  private timer?: ScheduleHandle;
  private initialized = false;
  /**
   * 入口 / Entry: Maintenance.constructor.
   * 功能：建立 Maintenance 的汇集存储诊断、磁盘整理及扩容维护上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Maintenance context for this module's responsibility: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; options: { deferInitialization?: boolean } default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, options: { deferInitialization?: boolean } = {}) {
    if (!options.deferInitialization) this.init();
  }
  /**
   * 入口 / Entry: Maintenance.init.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，初始化并核对当前领域状态；本入口产生 `void` 供上层消费（`Maintenance`）。
   * Purpose: Initializes and verifies current domain state in `Maintenance`; this entry produces `void` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.on`, `scheduler.register`, `this.machines.off` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.on`, `scheduler.register`, `this.machines.off`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.initialized`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.timer`, `this.initialized`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('磁盘维护服务已关闭', 503)`; `error`.
   * 失败处理：catch 分支执行 `this.machines.off('change', this.onChange);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.machines.off('change', this.onChange);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  init() {
    if (this.closed) throw new AppError('磁盘维护服务已关闭', 503);
    if (this.initialized) return;
    try {
      this.machines.on('change', this.onChange);
      this.timer = scheduler.register({ owner: 'plugin:maintenance', label: '磁盘维护检查', intervalMs: 60000,
        overlap: 'skip', backoff: { initialMs: 60000, maxMs: 600000 },
        /**
         * 入口 / Entry: Maintenance.init.run.
         * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.tick()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: () => this.tick() });
      this.initialized = true;
    } catch (error) {
      this.machines.off('change', this.onChange);
      throw error;
    }
  }
  /**
   * 入口 / Entry: Maintenance.storage.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ total: filesystem.blocks * filesystem.bsize, available: filesystem.bavail * filesystem.bsize, images, backupBytes, deduplic…` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `{ total: filesystem.blocks * filesystem.bsize, available: filesystem.bavail * filesystem.bsize, images, backupBytes, deduplic…` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `statfs`, `Promise.all`, `this.machines.list`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `statfs`, `Promise.all`, `this.machines.list`, `join`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)`; `file.isFile() && /\.sakura(?:\.enc)?$/.test(file.name)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ total: filesystem.blocks * filesystem.bsize, available: filesystem.bavail * filesystem.bsize, images, backupBytes, deduplic…`.
   * 副作用 / Effects: 更新 / updates `backupBytes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async storage() {
    const filesystem = await statfs(DATA);
    const images = await Promise.all(
      Object.entries(distributions).map(async ([id, info]) => ({
        id,
        name: info.name,
        bytes: (await stat(info.file).catch(() => null))?.size || 0,
      })),
    );
    const machines = await this.machines.list();
    const backupRoot = join(DATA, 'backups');
    let backupBytes = 0;
    for (const dir of await readdir(backupRoot, { withFileTypes: true }).catch(() => [])) {
      if (!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)) continue;
      for (const file of await readdir(join(backupRoot, dir.name), { withFileTypes: true }))
        if (file.isFile() && /\.sakura(?:\.enc)?$/.test(file.name))
          backupBytes += (await stat(join(backupRoot, dir.name, file.name))).size;
    }
    return {
      total: filesystem.blocks * filesystem.bsize,
      available: filesystem.bavail * filesystem.bsize,
      images,
      backupBytes,
      deduplicatedBackups: await backupBlocks().inspect(),
      machines: machines.map((v) => ({
        id: v.id,
        name: v.name,
        bytes: v.diskBytes,
        capacity: v.diskGiB,
        snapshots: v.snapshots.length,
        pendingResize: !!v.pendingResize,
      })),
      warning: filesystem.bavail / filesystem.blocks < 0.1 ? 'Sakura 所在磁盘剩余空间不足 10%' : '',
    };
  }
  /**
   * 入口 / Entry: Maintenance.compact.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.diskRun(id, 'compact')` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `this.diskRun(id, 'compact')` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.requireStopped`, `this.diskRun` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.requireStopped`, `this.diskRun`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.diskRun(id, 'compact')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  compact(id: string) {
    this.machines.requireStopped(id);
    return this.diskRun(id, 'compact');
  }
  /**
   * 入口 / Entry: Maintenance.diskView.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await diskMaintenanceState(id)), job: this.jobs.view(id), maintenance: await inMaintenance(id), }` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `{ ...(await diskMaintenanceState(id)), job: this.jobs.view(id), maintenance: await inMaintenance(id), }` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.get`, `diskMaintenanceState`, `this.jobs.view`, `inMaintenance` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `diskMaintenanceState`, `this.jobs.view`, `inMaintenance`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ ...(await diskMaintenanceState(id)), job: this.jobs.view(id), maintenance: await inMaintenance(id), }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async diskView(id: string) {
    this.machines.get(id);
    return {
      ...(await diskMaintenanceState(id)),
      job: this.jobs.view(id),
      maintenance: await inMaintenance(id),
    };
  }
  /**
   * 入口 / Entry: Maintenance.diskPolicy.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `saveDiskMaintenancePolicy(this.machines, id, input)` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `saveDiskMaintenancePolicy(this.machines, id, input)` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.jobs.view`, `saveDiskMaintenancePolicy` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.view`, `saveDiskMaintenancePolicy`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `saveDiskMaintenancePolicy(this.machines, id, input)`.
   * 副作用 / Effects: `saveDiskMaintenancePolicy`.
   * 拒绝 / Refusals: 条件 / conditions `this.jobs.view(id)?.status === 'running'`; 异常 / errors `new AppError('请等待磁盘维护任务完成', 409)`.
   */
  diskPolicy(id: string, input: unknown) {
    if (this.jobs.view(id)?.status === 'running') throw new AppError('请等待磁盘维护任务完成', 409);
    return saveDiskMaintenancePolicy(this.machines, id, input);
  }
  /**
   * 入口 / Entry: Maintenance.diskRun.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( id, async (log, signal, update, saveResult) => { await saveResult(await runDiskMaintenance(this.machines, id…` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `this.jobs.start( id, async (log, signal, update, saveResult) => { await saveResult(await runDiskMaintenance(this.machines, id…` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.get`, `this.machines.requireUnlocked`, `this.jobs.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireUnlocked`, `this.jobs.start`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; operation: DiskOperation
   * 输出 / Returns: `this.jobs.start( id, async (log, signal, update, saveResult) => { await saveResult(await runDiskMaintenance(this.machines, id…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  diskRun(id: string, operation: DiskOperation) {
    this.machines.get(id);
    this.machines.requireUnlocked(id);
    return this.jobs.start(
      id,
      async (log, signal, update, saveResult) => {
        await saveResult(await runDiskMaintenance(this.machines, id, operation, signal, log, update));
      },
      { title: operation === 'trim' ? '回收 Linux 未使用块' : '压缩与整理磁盘', vmId: id, action: operation },
    );
  }
  /**
   * 入口 / Entry: Maintenance.tick.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.resolve()` / `this.ticking` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `Promise.resolve()` / `this.ticking` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `Promise.resolve`, `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `this.ticking`.
   * 输入 / Inputs: now: default=Date.now()
   * 输出 / Returns: Promise<void>；结果来自 / values from `Promise.resolve()`; `this.ticking`.
   * 副作用 / Effects: 更新 / updates `this.ticking`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  tick(now = Date.now()): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.ticking) return this.ticking;
    /**
     * 入口 / Entry: Maintenance.tick.callback@168.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
     */
    this.ticking = (async () => {
      for (const vm of this.machines.records.values()) {
        if (this.closed) break;
        if (this.jobs.view(vm.id)?.status === 'running' || this.machines.isBusy(vm.id)) continue;
        try {
          if (await inMaintenance(vm.id, now)) continue;
          const state = await diskMaintenanceState(vm.id),
            operation = diskMaintenanceDue(state, this.machines.state(vm.id), now);
          if (!operation || (operation === 'compact' && (vm.snapshots.length || vm.pendingResize))) continue;
          this.diskRun(vm.id, operation);
        } catch {
          /* Failed jobs retain their error; unavailable/locked VMs wait for the next tick. */
        }
      }
    })().finally(() => {
      this.ticking = undefined;
    });
    return this.ticking;
  }
  /**
   * 入口 / Entry: Maintenance.report.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.reports.get(id) || null` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `this.reports.get(id) || null` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.get`, `this.reports.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.reports.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.reports.get(id) || null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  report(id: string) {
    this.machines.get(id);
    return this.reports.get(id) || null;
  }
  /**
   * 入口 / Entry: Maintenance.diagnose.
   * 功能：登记诊断任务，组合宿主存储、实例、网络与客户机检查并返回脱敏报告。
   * Purpose: Registers diagnostics that combine host storage/VM/network/guest checks into a redacted report.
   * 设计：单项失败保留检查结论而不终止全部诊断；输出按既有脱敏规则过滤，检查本身不擅自修复配置。
   * Design: Individual failures remain report entries; redaction applies and observation does not silently repair configuration.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.jobs.start( id, async (log, signal) => { const checks: DiagnosticCheck[] = []; const add = (check: DiagnosticCheck) => {…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  diagnose(id: string) {
    const vm = this.machines.get(id);
    /**
     * 入口 / Entry: Maintenance.diagnose.callback@195.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `add`; `this.machines.exec`; `this.reports.set`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 失败处理：catch 分支执行 `signal.throwIfAborted();`; `add({ name, status: 'error', detail: redact((error as Error).message), suggestion });`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `signal.throwIfAborted();`; `add({ name, status: 'error', detail: redact((error as Error).message), suggestion });`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      id,
      async (log, signal) => {
        const checks: DiagnosticCheck[] = [];
        /**
         * 入口 / Entry: Maintenance.diagnose.add.
         * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Maintenance`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; the calls and state transitions below complete the operation. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
         * 处理：通过 `checks.push`, `log` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `checks.push`, `log`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: check: DiagnosticCheck
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `checks.push`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const add = (check: DiagnosticCheck) => {
          checks.push(check);
          log(`${check.name}：${check.detail}${check.suggestion ? `；${check.suggestion}` : ''}\n`);
        };
        add({
          name: '虚拟化加速',
          status: this.machines.engine.whpxAvailable ? 'ok' : 'warning',
          detail: this.machines.engine.whpxAvailable ? 'WHPX 可用' : '当前使用兼容模式',
          suggestion: this.machines.engine.whpxAvailable
            ? undefined
            : '可在 Windows 可选功能启用 Windows Hypervisor Platform 后重启系统',
        });
        const space = await statfs(DATA);
        add({
          name: '主机磁盘空间',
          status: space.bavail / space.blocks < 0.1 ? 'warning' : 'ok',
          detail: `剩余 ${((space.bavail * space.bsize) / 1024 ** 3).toFixed(1)} GiB`,
          suggestion: space.bavail / space.blocks < 0.1 ? '清理不再需要的备份或实例' : undefined,
        });
        if (this.machines.state(id) !== 'running')
          add({
            name: 'Linux 检查',
            status: 'skip',
            detail: '启动实例后可检查 SSH、DNS、HTTPS 与 Linux 磁盘',
          });
        else {
          const commands = [
            ['SSH', 'printf connected', '请检查启动日志，停止后重新启动实例'],
            ['DNS', 'getent hosts example.com', '检查主机网络、VPN 和 Linux 的 /etc/resolv.conf'],
            [
              'HTTPS',
              'if command -v curl >/dev/null; then curl -fsSIL --max-time 10 https://example.com >/dev/null; else wget -q --spider -T 10 https://example.com; fi',
              '检查代理、DNS、证书与系统时间',
            ],
            [
              'Linux 磁盘',
              "df -Pk / | awk 'NR==2 {print $5; if ($5+0 >= 90) exit 1}'",
              '清理项目缓存或在关机后扩容磁盘',
            ],
          ];
          for (const [name, command, suggestion] of commands) {
            signal.throwIfAborted();
            try {
              const result = await this.machines.exec(id, command, 15000, signal);
              add({
                name,
                status: result.code === 0 ? 'ok' : 'error',
                detail: result.code === 0 ? '检查通过' : redact((result.stderr || result.stdout).slice(-300)),
                suggestion: result.code ? suggestion : undefined,
              });
            } catch (error) {
              signal.throwIfAborted();
              add({ name, status: 'error', detail: redact((error as Error).message), suggestion });
            }
          }
        }
        for (const port of vm.forwards) {
          signal.throwIfAborted();
          const conflicts = [...this.machines.records.values()].filter(
            (other) =>
              other.id !== id &&
              this.machines.live.has(other.id) &&
              other.forwards.some((f) => f.host === port.host),
          );
          const hostIssue =
            !conflicts.length && !this.machines.live.has(id) ? await hostPortIssue(port.host) : null;
          add({
            name: `端口 ${port.host}`,
            status: conflicts.length || hostIssue ? 'error' : 'ok',
            detail: conflicts.length
              ? '被其他运行实例使用'
              : hostIssue
                ? `Windows 端口不可用（${redact(hostIssue)}）`
                : `转发到 Linux ${port.guest}`,
            suggestion:
              conflicts.length || hostIssue ? '关闭占用端口的程序或在服务面板修改 Windows 端口' : undefined,
          });
        }
        this.reports.set(id, {
          createdAt: new Date().toISOString(),
          checks,
          log: redact((this.machines.logs.get(id) || '').slice(-8192)),
        });
      },
      { title: '一键故障诊断', vmId: id, action: 'diagnose' },
    );
  }
  /**
   * 入口 / Entry: Maintenance.resize.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( id, async (log, signal) => { log('创建扩容前快照并扩大磁盘…\n'); await this.machines.resize(id, size, signal); log('磁盘已扩…` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `this.jobs.start( id, async (log, signal) => { log('创建扩容前快照并扩大磁盘…\n'); await this.machines.resize(id, size, signal); log('磁盘已扩…` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.get`, `this.machines.requireStopped`, `this.jobs.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireStopped`, `this.jobs.start`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; size: number
   * 输出 / Returns: `this.jobs.start( id, async (log, signal) => { log('创建扩容前快照并扩大磁盘…\n'); await this.machines.resize(id, size, signal); log('磁盘已扩…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  resize(id: string, size: number) {
    this.machines.get(id);
    this.machines.requireStopped(id);
    return this.jobs.start(
      id,
      async (log, signal) => {
        log('创建扩容前快照并扩大磁盘…\n');
        await this.machines.resize(id, size, signal);
        log('磁盘已扩大，下次启动会自动扩展 Linux 分区和文件系统。\n');
      },
      { title: '磁盘扩容', vmId: id },
    );
  }
  /**
   * 入口 / Entry: Maintenance.finishResize.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.jobs.start( id, async (log, signal) => { const result = await guestTask(this.machines, id, growFilesystem, signal, log);…` 供上层消费（`Maintenance`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Maintenance`; this entry produces `void` / `this.jobs.start( id, async (log, signal) => { const result = await guestTask(this.machines, id, growFilesystem, signal, log);…` for its caller. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.jobs.view`, `this.machines.get`, `this.jobs.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.view`, `this.machines.get`, `this.jobs.start`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.jobs.view(id)?.status === 'running'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`; `this.jobs.start( id, async (log, signal) => { const result = await guestTask(this.machines, id, growFilesystem, signal, log);…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `!this.machines.get(id).pendingResize`; 异常 / errors `new AppError('没有待完成的文件系统扩容')`.
   */
  finishResize(id: string) {
    if (this.jobs.view(id)?.status === 'running') return;
    if (!this.machines.get(id).pendingResize) throw new AppError('没有待完成的文件系统扩容');
    /**
     * 入口 / Entry: Maintenance.finishResize.callback@302.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.code !== 0`; 异常 / errors `new AppError(result.stderr || '文件系统扩容失败，可重试或手动扩容')`.
     */
    return this.jobs.start(
      id,
      async (log, signal) => {
        const result = await guestTask(this.machines, id, growFilesystem, signal, log);
        if (result.code !== 0) throw new AppError(result.stderr || '文件系统扩容失败，可重试或手动扩容');
        await this.machines.completeResize(id);
        log('分区与文件系统扩容完成。\n');
      },
      { title: '扩展 Linux 文件系统', vmId: id, action: 'finish-resize' },
    );
  }
  /**
   * 入口 / Entry: Maintenance.close.
   * 功能：在汇集存储诊断、磁盘整理及扩容维护中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Maintenance`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Maintenance`; the outcome is recorded in `this.closed`. Module context: Collects storage diagnostics, compaction and resize work, returning redacted reports and coordinating guest maintenance.
   * 处理：通过 `this.machines.off`, `this.timer.close`, `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.timer.close`, `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.machines.off('change', this.onChange);
    await this.timer?.close();
    await this.ticking;
    await this.jobs.close();
  }
}

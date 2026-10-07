/**
 * 模块职责：从实例备份中提取选定文件并保存产物；磁盘读取与输出共用同一 I/O 操作预算。
 * Module purpose: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
 */
import type { BackupsV1, BundlesV1 } from './service-contracts/v1.ts';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { backupRecoverySchema } from '../shared/backup-recovery.ts';
import type { SandboxExecution } from '../shared/sandbox.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';

import { Jobs } from './jobs.ts';
import { type JobView } from '../shared/contracts/jobs.ts';
import { SandboxArtifacts } from './sandbox-artifacts.ts';
import { rescueSetup } from './rescue.ts';

export class BackupRecovery {
  private closed = false;
  /**
   * 入口 / Entry: BackupRecovery.lockdown.
   * 功能：在从实例备份中提取选定文件并保存产物中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`BackupRecovery`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupRecovery`; the calls and state transitions below complete the operation. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.jobs.cancel` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.cancel`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private lockdown = (id: string) => {
    this.jobs.cancel(id);
  };
  /**
   * 入口 / Entry: BackupRecovery.constructor.
   * 功能：建立 BackupRecovery 的从实例备份中提取选定文件并保存产物上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the BackupRecovery context for this module's responsibility: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; backups: BackupsV1; bundles: BundlesV1; jobs: default=new Jobs('backup-recovery'); artifacts: default=new SandboxArtifacts(machines, join(DATA, 'plugins', 'b…
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(
    private machines: Machines,
    private backups: BackupsV1,
    private bundles: BundlesV1,
    readonly jobs = new Jobs('backup-recovery'),
    private artifacts = new SandboxArtifacts(machines, join(DATA, 'plugins', 'backups', 'recovered-files')),
  ) {
    machines.on('incident-lockdown', this.lockdown);
  }
  /**
   * 入口 / Entry: BackupRecovery.init.
   * 功能：在从实例备份中提取选定文件并保存产物中，初始化并核对当前领域状态；完成下述调用及状态处理（`BackupRecovery`）。
   * Purpose: Initializes and verifies current domain state in `BackupRecovery`; the calls and state transitions below complete the operation. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.artifacts.prune`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.artifacts.prune`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    await this.artifacts.prune(this.jobs.list());
  }
  /**
   * 入口 / Entry: BackupRecovery.source.
   * 功能：在从实例备份中提取选定文件并保存产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vm` 供上层消费（`BackupRecovery`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupRecovery`; this entry produces `vm` for its caller. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.machines.get`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `vm`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `vm.sandbox`; 异常 / errors `new AppError('文件恢复服务正在关闭', 503)`; `new AppError('请选择普通实例的备份', 409)`.
   */
  private source(id: string) {
    if (this.closed) throw new AppError('文件恢复服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (vm.sandbox) throw new AppError('请选择普通实例的备份', 409);
    return vm;
  }
  /**
   * 入口 / Entry: BackupRecovery.view.
   * 功能：在从实例备份中提取选定文件并保存产物中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` 供上层消费（`BackupRecovery`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `BackupRecovery`; this entry produces `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` for its caller. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.source`, `this.jobs.list().filter().slice`, `this.jobs.list().filter`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.source`, `this.jobs.list().filter().slice`, `this.jobs.list().filter`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string) {
    this.source(id);
    return {
      runs: this.jobs
        .list()
        .filter((job) => job.vmId === id)
        .slice(0, 20),
      persistenceError: this.jobs.persistenceError,
    };
  }
  /**
   * 入口 / Entry: BackupRecovery.artifact.
   * 功能：在从实例备份中提取选定文件并保存产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.artifacts.download(job, artifact)` 供上层消费（`BackupRecovery`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BackupRecovery`; this entry produces `this.artifacts.download(job, artifact)` for its caller. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.source`, `this.jobs.get`, `z.uuid().parse`, `z.uuid` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.source`, `this.jobs.get`, `z.uuid().parse`, `z.uuid`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; run: string; artifact: string
   * 输出 / Returns: `this.artifacts.download(job, artifact)`.
   * 副作用 / Effects: `this.artifacts.download`.
   * 拒绝 / Refusals: 条件 / conditions `!job || job.vmId !== id`; 异常 / errors `new AppError('文件恢复记录不存在', 404)`.
   */
  async artifact(id: string, run: string, artifact: string) {
    this.source(id);
    const job = this.jobs.get(z.uuid().parse(run));
    if (!job || job.vmId !== id) throw new AppError('文件恢复记录不存在', 404);
    return this.artifacts.download(job, artifact);
  }
  /**
   * 入口 / Entry: BackupRecovery.run.
   * 功能：校验选定备份和提取路径，登记恢复任务并在只读救援环境中收集文件产物。
   * Purpose: Validates the backup/extraction request and registers recovery work that collects files from a read-only rescue environment.
   * 设计：备份验证、磁盘读取和产物输出共享 I/O 额度；任务与额外截止信号组合，收尾不重复申请自身持有的预算。
   * Design: Verification, disk access and artifact output share I/O admission; task/deadline signals combine without recursively acquiring the held budget.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `job`.
   * 副作用 / Effects: `this.jobs.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  run(id: string, input: unknown) {
    const vm = this.source(id);
    this.machines.requireStopped(id);
    const config = backupRecoverySchema.parse(input);
    const execution: SandboxExecution = {
      command: '提取备份 ' + config.backupId + ' 中的选定文件',
      cwd: '/mnt/source',
      timeoutSeconds: 120,
      requestedArtifacts: config.paths,
      artifacts: [],
      timings: {},
    };
    /**
     * 入口 / Entry: BackupRecovery.run.callback@73.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update; result
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `AbortSignal.any`; `update`; `clearTimeout`; 更新 / updates `execution.outcome`, `execution.exitCode`, `execution.timings.totalMs`, `config.password`.
     * 拒绝 / Refusals: 条件 / conditions `deadline.signal.aborted && !signal.aborted`; 异常 / errors `new AppError('文件恢复超过 30 分钟，已终止临时系统', 408)`; `error`.
     * 收尾：退出 try 区域时始终执行 `clearTimeout(timer);`; `config.password = undefined;`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `clearTimeout(timer);`; `config.password = undefined;`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `execution.outcome = signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'failed';`; `if (deadline.signal.aborted && !signal.aborted) throw new AppError('文件恢复超过 30 分钟，已终止临时系统', 408);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `execution.outcome = signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'failed';`; `if (deadline.signal.aborted && !signal.aborted) throw new AppError('文件恢复超过 30 分钟，已终止临时系统', 408);`; these statements determine whether a failure is absorbed or rejected again.
     */
    const job: JobView = this.jobs.start(
      id,
      async (log, signal, update, result) => {
        const started = performance.now();
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(), 30 * 60_000);
        const combined = AbortSignal.any([signal, deadline.signal]);
        log('备份：' + config.backupId + '\n选定文件：\n' + config.paths.join('\n') + '\n');
        try {
          update('校验并准备备份磁盘');
          /**
           * 入口 / Entry: BackupRecovery.run.callback@90.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.bundles.withDisk）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.bundles.withDisk).
           * 输入 / Inputs: disk; diskEncryption
           * 输出 / Returns: `this.machines.withRescue( id, combined, update, async (rescueId, lifetime) => { log('备份与磁盘校验通过；在临时系统中只读读取。\n'); const prepare…`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `diskEncryption`; 异常 / errors `new AppError('加密实例备份暂不支持只读文件提取；可恢复为新实例并录入磁盘口令', 409)`.
           */
          await this.backups.withVerifiedFile(
            id,
            config.backupId,
            config.password,
            combined,
            (file, lease) =>
              this.bundles.withDisk(
                createReadStream(file),
                combined,
                /**
                 * 中文功能：拒绝加密磁盘的只读文件提取，在临时救援实例挂载指定分区并收集选定产物，组合救援寿命与两分钟期限。
                 * English: Refuses readonly extraction from encrypted disks, mounts the partition in a temporary rescue VM and collects selected artifacts under rescue lifetime and a two-minute deadline.
                 * 所属 / Owner: BackupRecovery.run.job.
                 * 输入 / Inputs: disk; diskEncryption.
                 */
                (disk, diskEncryption) => {
                  if (diskEncryption)
                    throw new AppError('加密实例备份暂不支持只读文件提取；可恢复为新实例并录入磁盘口令', 409);
                  /**
                   * 入口 / Entry: BackupRecovery.run.callback@97.
                   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.withRescue）。
                   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.withRescue).
                   * 输入 / Inputs: rescueId; lifetime
                   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
                   * 副作用 / Effects: `this.machines.exec`; `update`; `AbortSignal.any`; `AbortSignal.timeout`.
                   * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; 异常 / errors `new AppError('备份分区无法只读挂载，请检查分区编号和文件系统', 409)`.
                   */
                  return this.machines.withRescue(
                    id,
                    combined,
                    update,
                    async (rescueId, lifetime) => {
                      log('备份与磁盘校验通过；在临时系统中只读读取。\n');
                      const prepared = await this.machines.exec(
                        rescueId,
                        rescueSetup(config.partition),
                        30000,
                        lifetime,
                        log,
                      );
                      if (prepared.code !== 0)
                        throw new AppError('备份分区无法只读挂载，请检查分区编号和文件系统', 409);
                      update('提取选定文件');
                      const transfer = AbortSignal.any([lifetime, AbortSignal.timeout(120000)]);
                      await this.artifacts.collect(
                        rescueId,
                        job.id!,
                        '/mnt/source',
                        config.paths,
                        (artifact) => {
                          execution.artifacts.push(artifact);
                          log('已提取：' + artifact.path + '（' + artifact.bytes + ' 字节）\n');
                        },
                        transfer,
                        lease,
                      );
                      transfer.throwIfAborted();
                    },
                    log,
                    disk,
                  );
                },
                lease,
              ),
            // Disk extraction and selected artifact output belong to one I/O
            // operation. Acquiring another writer inside it would wait on itself.
            { extraBuffers: 1024 ** 2, writePaths: this.artifacts.storagePaths() },
          );
          combined.throwIfAborted();
          execution.outcome = 'success';
          execution.exitCode = 0;
          execution.timings.totalMs = Math.round(performance.now() - started);
          await result({
            backupId: config.backupId,
            partition: config.partition,
            files: execution.artifacts,
            elapsedMs: execution.timings.totalMs,
          });
        } catch (error) {
          execution.outcome = signal.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'failed';
          if (deadline.signal.aborted && !signal.aborted)
            throw new AppError('文件恢复超过 30 分钟，已终止临时系统', 408);
          throw error;
        } finally {
          clearTimeout(timer);
          config.password = undefined;
          execution.timings.totalMs = Math.round(performance.now() - started);
          await this.artifacts.prune(this.jobs.list());
        }
      },
      { vmId: id, title: vm.name + ' · 备份文件恢复', action: 'backup-file-recovery', execution },
    );
    return job;
  }
  /**
   * 入口 / Entry: BackupRecovery.close.
   * 功能：在从实例备份中提取选定文件并保存产物中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`BackupRecovery`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BackupRecovery`; the outcome is recorded in `this.closed`. Module context: Extracts selected backup files into managed artifacts; disk reads and artifact writes share one I/O admission.
   * 处理：通过 `this.machines.off`, `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.off`, `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.machines.off('incident-lockdown', this.lockdown);
    await this.jobs.close();
  }
}

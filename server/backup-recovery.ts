import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { backupRecoverySchema } from '../shared/backup-recovery.ts';
import type { SandboxExecution } from '../shared/sandbox.ts';
import { AppError, DATA } from './model.ts';
import type { Machines } from './machines.ts';
import type { Backups } from './backups.ts';
import type { Bundles } from './bundles.ts';
import { Jobs, type JobView } from './jobs.ts';
import { SandboxArtifacts } from './sandbox-artifacts.ts';
import { rescueSetup } from './rescue.ts';

export class BackupRecovery {
  private closed = false;
  private lockdown = (id: string) => {
    this.jobs.cancel(id);
  };
  constructor(
    private machines: Machines,
    private backups: Backups,
    private bundles: Bundles,
    readonly jobs = new Jobs('backup-recovery'),
    private artifacts = new SandboxArtifacts(machines, join(DATA, 'plugins', 'backups', 'recovered-files')),
  ) {
    machines.on('incident-lockdown', this.lockdown);
  }
  async init() {
    await this.artifacts.prune(this.jobs.list());
  }
  private source(id: string) {
    if (this.closed) throw new AppError('文件恢复服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (vm.sandbox) throw new AppError('请选择普通实例的备份', 409);
    return vm;
  }
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
  async artifact(id: string, run: string, artifact: string) {
    this.source(id);
    const job = this.jobs.get(z.uuid().parse(run));
    if (!job || job.vmId !== id) throw new AppError('文件恢复记录不存在', 404);
    return this.artifacts.download(job, artifact);
  }
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
          await this.backups.withVerifiedFile(id, config.backupId, config.password, combined, (file) =>
            this.bundles.withDisk(createReadStream(file), combined, (disk, diskEncryption) => {
              if (diskEncryption)
                throw new AppError('加密实例备份暂不支持只读文件提取；可恢复为新实例并录入磁盘口令', 409);
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
                  );
                  transfer.throwIfAborted();
                },
                log,
                disk,
              );
            }),
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
  async close() {
    this.closed = true;
    this.machines.off('incident-lockdown', this.lockdown);
    await this.jobs.close();
  }
}

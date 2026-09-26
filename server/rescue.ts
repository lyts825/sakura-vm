import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, DATA } from './model.ts';
import { Jobs, type JobView } from './jobs.ts';
import { SandboxArtifacts } from './sandbox-artifacts.ts';
import { quote } from './files.ts';
import { rescueRunSchema } from '../shared/rescue.ts';
import type { SandboxExecution } from '../shared/sandbox.ts';

/** Only supported filesystems receive an automatic mount; never replay a journal. */
export function rescueSetup(partition: number | null) {
  return `set -eu
device=
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  for serial in /sys/block/vd*/serial; do
    if test "$(cat "$serial" 2>/dev/null || true)" = sakura-source; then
      device=/dev/$(basename "$(dirname "$serial")")
      break
    fi
  done
  test -z "$device" || break
  sleep 1
done
test -n "$device" || { echo '未发现救援磁盘' >&2; exit 1; }
test "$(cat /sys/block/$(basename "$device")/ro)" = 1 || { echo '救援磁盘不是只读设备' >&2; exit 1; }
printf '%s\n' "$device" > /run/sakura-source-device
mkdir -p /workspace /mnt/source
echo "源磁盘：$device（QEMU 只读）"
cat /proc/partitions
${
  partition === null
    ? "echo '仅检查分区，未自动挂载文件系统'"
    : `target="$device"${partition || ''}
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  test -b "$target" && break
  sleep 1
done
test -b "$target" || { echo '所选分区不存在，请选择仅检查分区后查看磁盘布局' >&2; exit 1; }
kind=$(blkid "$target" | sed -n 's/.* TYPE="\\([^"]*\\)".*/\\1/p')
case "$kind" in
  ext2) options=ro ;;
  ext3|ext4) options=ro,noload ;;
  *) echo "自动挂载仅支持 ext2/ext3/ext4，检测到：$kind。请选择仅检查分区后手动诊断。" >&2; exit 1 ;;
esac
mount -t "$kind" -o "$options" "$target" /mnt/source
echo '源分区已只读挂载到 /mnt/source（不重放日志）'`
}
`;
}

export class Rescue {
  private closed = false;
  constructor(
    private machines: Machines,
    readonly jobs = new Jobs('rescue'),
    private artifacts = new SandboxArtifacts(
      machines,
      join(DATA, 'plugins', 'snapshots', 'rescue-artifacts'),
    ),
  ) {}
  async init() {
    await this.artifacts.prune(this.jobs.list());
  }
  private source(id: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (vm.sandbox) throw new AppError('救援目标必须是普通实例', 409);
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
    z.uuid().parse(run);
    const job = this.jobs.get(run);
    if (!job || job.vmId !== id) throw new AppError('救援执行记录不存在', 404);
    return this.artifacts.download(job, artifact);
  }
  run(id: string, input: unknown) {
    const vm = this.source(id);
    this.machines.requireStopped(id);
    if (this.machines.isBusy(id)) throw new AppError('实例正在执行其他操作', 409);
    const config = rescueRunSchema.parse(input);
    const execution: SandboxExecution = {
      command: config.command,
      cwd: '/workspace',
      timeoutSeconds: config.timeoutSeconds,
      requestedArtifacts: config.artifacts,
      artifacts: [],
      timings: {},
    };
    const job: JobView = this.jobs.start(
      id,
      async (log, signal, update) => {
        const started = performance.now();
        log('独立临时救援系统；网络隔离；源磁盘只读。\n命令：' + config.command + '\n');
        try {
          await this.machines.withRescue(
            id,
            signal,
            update,
            async (rescueId, lifetime) => {
              execution.timings.bootMs = Math.round(performance.now() - started);
              update('检查源磁盘与挂载分区');
              const prepared = await this.machines.exec(
                rescueId,
                rescueSetup(config.partition),
                30000,
                lifetime,
                log,
              );
              if (prepared.code !== 0) throw new AppError('救援磁盘准备失败，请查看日志并调整分区选择', 409);
              const timeout = new AbortController();
              const timer = setTimeout(() => timeout.abort(), config.timeoutSeconds * 1000);
              const combined = AbortSignal.any([lifetime, timeout.signal]);
              const commandAt = performance.now();
              try {
                update('执行救援命令');
                const result = await this.machines.exec(
                  rescueId,
                  'cd /workspace && exec sh -c ' + quote(config.command),
                  config.timeoutSeconds * 1000,
                  combined,
                  log,
                );
                execution.timings.commandMs = Math.round(performance.now() - commandAt);
                execution.exitCode = result.code;
                log('\n退出码：' + result.code + '\n');
                update('保存明确选择的救援产物');
                await this.artifacts.collect(
                  rescueId,
                  job.id!,
                  '/workspace',
                  config.artifacts,
                  (artifact) => {
                    execution.artifacts.push(artifact);
                    update('已保存产物：' + artifact.path);
                  },
                  combined,
                );
                combined.throwIfAborted();
                if (result.code !== 0) throw new AppError('救援命令执行失败，退出码 ' + result.code);
              } catch (error) {
                if (timeout.signal.aborted && !lifetime.aborted) {
                  execution.outcome = 'timeout';
                  throw new AppError('救援命令超时，已终止临时系统', 408);
                }
                throw error;
              } finally {
                clearTimeout(timer);
              }
            },
            log,
          );
          execution.outcome = 'success';
        } catch (error) {
          execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';
          throw error;
        } finally {
          execution.timings.totalMs = Math.round(performance.now() - started);
          await this.artifacts.prune(this.jobs.list());
        }
      },
      { vmId: id, title: vm.name + ' · 只读救援', action: 'rescue-run', execution },
    );
    return job;
  }
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}

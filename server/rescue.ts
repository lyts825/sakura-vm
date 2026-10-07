/**
 * 模块职责：准备受控救援磁盘与文件产物，按明确的访问模式运行客户机救援操作。
 * Module purpose: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
 */
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { Jobs } from './jobs.ts';
import { type JobView } from '../shared/contracts/jobs.ts';
import { SandboxArtifacts } from './sandbox-artifacts.ts';
import { quote } from './shell.ts';
import { rescueRunSchema } from '../shared/rescue.ts';
import type { SandboxExecution } from '../shared/sandbox.ts';

/** Only supported filesystems receive an automatic mount; never replay a journal. */
/**
 * 入口 / Entry: rescueSetup.
 * 功能：从当前输入或状态计算 ``set -eu device= for attempt in 1 2 3 4 5 6 7 8 9 10; do for serial in /sys/block/vd* /serial; do if test "$(cat "$serial" 2>…`，供调用方后续验证或使用。
 * Purpose: Computes ``set -eu device= for attempt in 1 2 3 4 5 6 7 8 9 10; do for serial in /sys/block/vd* /serial; do if test "$(cat "$serial" 2>…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: partition: number | null; role: 'source' | 'compare' | 'target' default='source'; writable: default=false
 * 输出 / Returns: ``set -eu device= for attempt in 1 2 3 4 5 6 7 8 9 10; do for serial in /sys/block/vd* /serial; do if test "$(cat "$serial" 2>…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function rescueSetup(partition: number | null,
  role: 'source' | 'compare' | 'target' = 'source', writable = false) {
  const mountPoint = `/mnt/${role}`;
  return `set -eu
device=
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  for serial in /sys/block/vd*/serial; do
    if test "$(cat "$serial" 2>/dev/null || true)" = sakura-${role}; then
      device=/dev/$(basename "$(dirname "$serial")")
      break
    fi
  done
  test -z "$device" || break
  sleep 1
done
test -n "$device" || { echo '未发现救援磁盘' >&2; exit 1; }
test "$(cat /sys/block/$(basename "$device")/ro)" = ${writable ? '0' : '1'} || { echo '救援磁盘访问模式不符' >&2; exit 1; }
printf '%s\n' "$device" > /run/sakura-${role}-device
mkdir -p /workspace ${mountPoint}
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
  ext2) options=${writable ? 'rw' : 'ro'} ;;
  ext3|ext4) options=${writable ? 'rw' : 'ro,noload'} ;;
  *) echo "自动挂载仅支持 ext2/ext3/ext4，检测到：$kind。请选择仅检查分区后手动诊断。" >&2; exit 1 ;;
esac
mount -t "$kind" -o "$options" "$target" ${mountPoint}
echo '磁盘已${writable ? '读写' : '只读'}挂载到 ${mountPoint}'`
}
`;
}

export class Rescue {
  private closed = false;
  /**
   * 入口 / Entry: Rescue.constructor.
   * 功能：建立 Rescue 的准备受控救援磁盘与文件产物上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Rescue context for this module's responsibility: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; jobs: default=new Jobs('rescue'); artifacts: default=new SandboxArtifacts( machines, join(DATA, 'plugins', '…
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    readonly jobs = new Jobs('rescue'),
    private artifacts = new SandboxArtifacts(
      machines,
      join(DATA, 'plugins', 'snapshots', 'rescue-artifacts'),
    ),
  ) {}
  /**
   * 入口 / Entry: Rescue.init.
   * 功能：在准备受控救援磁盘与文件产物中，初始化并核对当前领域状态；完成下述调用及状态处理（`Rescue`）。
   * Purpose: Initializes and verifies current domain state in `Rescue`; the calls and state transitions below complete the operation. Module context: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
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
   * 入口 / Entry: Rescue.source.
   * 功能：在准备受控救援磁盘与文件产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vm` 供上层消费（`Rescue`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Rescue`; this entry produces `vm` for its caller. Module context: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
   * 处理：通过 `this.machines.get`, `this.machines.requireUnlocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.requireUnlocked`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `vm`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `vm.sandbox`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('救援目标必须是普通实例', 409)`.
   */
  private source(id: string) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    const vm = this.machines.get(id);
    this.machines.requireUnlocked(id);
    if (vm.sandbox) throw new AppError('救援目标必须是普通实例', 409);
    return vm;
  }
  /**
   * 入口 / Entry: Rescue.view.
   * 功能：在准备受控救援磁盘与文件产物中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` 供上层消费（`Rescue`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Rescue`; this entry produces `{ runs: this.jobs .list() .filter((job) => job.vmId === id) .slice(0, 20), persistenceError: this.jobs.persistenceError, }` for its caller. Module context: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
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
   * 入口 / Entry: Rescue.artifact.
   * 功能：在准备受控救援磁盘与文件产物中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.artifacts.download(job, artifact)` 供上层消费（`Rescue`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Rescue`; this entry produces `this.artifacts.download(job, artifact)` for its caller. Module context: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
   * 处理：通过 `this.source`, `z.uuid().parse`, `z.uuid`, `this.jobs.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.source`, `z.uuid().parse`, `z.uuid`, `this.jobs.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; run: string; artifact: string
   * 输出 / Returns: `this.artifacts.download(job, artifact)`.
   * 副作用 / Effects: `this.artifacts.download`.
   * 拒绝 / Refusals: 条件 / conditions `!job || job.vmId !== id`; 异常 / errors `new AppError('救援执行记录不存在', 404)`.
   */
  async artifact(id: string, run: string, artifact: string) {
    this.source(id);
    z.uuid().parse(run);
    const job = this.jobs.get(run);
    if (!job || job.vmId !== id) throw new AppError('救援执行记录不存在', 404);
    return this.artifacts.download(job, artifact);
  }
  /**
   * 入口 / Entry: Rescue.run.
   * 功能：校验停止实例与救援动作，登记有期限的受管救援任务并收集产物。
   * Purpose: Validates a stopped VM/rescue request, runs deadline-bound managed rescue work and collects artifacts.
   * 设计：原磁盘访问模式和锁保持到附件退出，失败先关闭救援资源；文件提取仍核对路径、大小与产物边界。
   * Design: Original disk modes/locks last through attachment exit; failures close rescue resources and extraction obeys path/size/artifact bounds.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `job`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.isBusy(id)`; 异常 / errors `new AppError('实例正在执行其他操作', 409)`.
   */
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
    /**
     * 入口 / Entry: Rescue.run.callback@111.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.jobs.start）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.jobs.start).
     * 输入 / Inputs: log; signal; update
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `execution.outcome`, `execution.timings.totalMs`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 收尾：退出 try 区域时始终执行 `execution.timings.totalMs = Math.round(performance.now() - started);`; `await this.artifacts.prune(this.jobs.list());`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `execution.timings.totalMs = Math.round(performance.now() - started);`; `await this.artifacts.prune(this.jobs.list());`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 `execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `execution.outcome ||= signal.aborted ? 'cancelled' : 'failed';`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const job: JobView = this.jobs.start(
      id,
      async (log, signal, update) => {
        const started = performance.now();
        log('独立临时救援系统；网络隔离；源磁盘只读。\n命令：' + config.command + '\n');
        try {
          /**
           * 入口 / Entry: Rescue.run.callback@119.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.machines.withRescue）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.machines.withRescue).
           * 输入 / Inputs: rescueId; lifetime
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `update`; `this.machines.exec`; `setTimeout`; `AbortSignal.any`; `clearTimeout`; 更新 / updates `execution.timings.bootMs`, `execution.timings.commandMs`, `execution.exitCode`, `execution.outcome`.
           * 拒绝 / Refusals: 条件 / conditions `prepared.code !== 0`; `result.code !== 0`; `timeout.signal.aborted && !lifetime.aborted`; 异常 / errors `new AppError('救援磁盘准备失败，请查看日志并调整分区选择', 409)`; `new AppError('救援命令执行失败，退出码 ' + result.code)`.
           * 收尾：退出 try 区域时始终执行 `clearTimeout(timer);`；这些步骤也适用于异常退出。
           * Finalization: Leaving the try region always executes `clearTimeout(timer);`; these steps also apply to exceptional exits.
           * 失败处理：catch 分支执行 `if (timeout.signal.aborted && !lifetime.aborted) { execution.outcome = 'timeout'; throw new AppError('救援命令超时，已终止临时系统', 408); …`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
           * Failure handling: Catch paths execute `if (timeout.signal.aborted && !lifetime.aborted) { execution.outcome = 'timeout'; throw new AppError('救援命令超时，已终止临时系统', 408); …`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
           */
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
  /**
   * 入口 / Entry: Rescue.close.
   * 功能：在准备受控救援磁盘与文件产物中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`Rescue`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Rescue`; the outcome is recorded in `this.closed`. Module context: Prepares controlled rescue disks/artifacts and executes rescue with explicit guest disk access modes.
   * 处理：通过 `this.jobs.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.jobs.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.jobs.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.jobs.close();
  }
}

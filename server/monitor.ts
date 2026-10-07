/**
 * 模块职责：汇总有限数量的实例与任务状态，监控快照不包含命令、日志、路径和凭证。
 * Module purpose: Collects bounded VM/job status without command text, logs, paths or credentials in the public snapshot.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { hostname } from 'node:os';
import type { VmAccess as Machines } from './vm-access.ts';

/** 只发布状态及有限标识；任务标题、命令、结果和原日志可能含敏感信息，因此不进入快照。 */
/**
 * 入口 / Entry: monitorSnapshot.
 * 功能：在汇总有限数量的实例与任务状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ version: 1, capturedAt: new Date().toISOString(), host: hostname(), totalVms: vms.length, totalJobs: jobs.length, vms: vms …` 供上层消费（`monitor.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `monitor.ts`; this entry produces `{ version: 1, capturedAt: new Date().toISOString(), host: hostname(), totalVms: vms.length, totalJobs: jobs.length, vms: vms …` for its caller. Module context: Collects bounded VM/job status without command text, logs, paths or credentials in the public snapshot.
 * 处理：通过 `machines.list`, `stores.flatMap().sort`, `stores.flatMap`, `hostname` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `machines.list`, `stores.flatMap().sort`, `stores.flatMap`, `hostname`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: machines: Pick<Machines, 'list'>; stores: Pick<JobsV1, 'list'>[]
 * 输出 / Returns: `{ version: 1, capturedAt: new Date().toISOString(), host: hostname(), totalVms: vms.length, totalJobs: jobs.length, vms: vms …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function monitorSnapshot(machines: Pick<Machines, 'list'>, stores: Pick<JobsV1, 'list'>[]) {
  const vms = await machines.list();
  const jobs = stores
    .flatMap((store) => store.list())
    .sort(
      (left, right) => (Date.parse(right.startedAt || '') || 0) - (Date.parse(left.startedAt || '') || 0),
    );
  /**
   * 入口 / Entry: monitorSnapshot.label.
   * 功能：从当前输入或状态计算 `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'`，供调用方后续验证或使用。
   * Purpose: Computes `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const label = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,80}$/.test(value) ? value : 'task';
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    host: hostname(),
    totalVms: vms.length,
    totalJobs: jobs.length,
    vms: vms
      .slice(0, 100)
      .map((vm) => ({ id: vm.id, name: vm.name, status: vm.status, cpus: vm.cpus, memoryMiB: vm.memoryMiB })),
    jobs: jobs
      .slice(0, 100)
      .map((job) => ({
        id: job.id,
        vmId: job.vmId,
        scope: label(job.scope),
        action: label(job.action),
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      })),
  };
}

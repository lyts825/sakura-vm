/**
 * 模块职责：校验在线迁移输入并生成步骤计划，明确源目标硬件和磁盘一致性要求。
 * Module purpose: Validates migration requests and plans source/target hardware and disk consistency steps.
 */
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { qmp } from './qmp.ts';
import { readLiveMigrationProjects } from './live-migration-projects.ts';

export const liveMigrationInput = z.object({
  targetHostId: z.uuid().optional(),
  transferId: z.uuid().optional(),
  targetName: z.string().trim().min(1).max(32)
    .regex(/^[a-z][a-z0-9-]*$/).optional(),
}).strict();

type Score = Awaited<ReturnType<HostPeersV1['score']>>;
type Query = typeof qmp;

/**
 * 入口 / Entry: planLiveMigration.
 * 功能：校验源实例、目标评分和硬件配置，返回在线迁移步骤及阻塞项。
 * Purpose: Validates source/target scoring/hardware and returns migration steps plus blockers.
 * 设计：计划只描述可执行前提，不启动目标或移动磁盘；来源、目标及见证条件分别记录便于执行时复核。
 * Design: Planning has no target-start/disk-transfer effects and records source/target/witness conditions for execution-time rechecks.
 * 输入 / Inputs: machines: Machines; scoreHosts: (input: { cpus: number; memoryMiB: number }) => Promise<Score>; id: string; raw: unknown; signal: AbortSignal optional; query: Query default=qmp; executionAvailable: default=false
 * 输出 / Returns: `{ ready: executionAvailable && blockers.length === 0, executed: false, planned: true, sourceVmId: id, targetHostId: target?.i…`.
 * 副作用 / Effects: `blockers.push`; 更新 / updates `score`, `qemu`, `migration`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `blockers.push(`无法读取主机资源：${(error as Error).message}`);`; `blockers.push(`项目配置：${(error as Error).message}`);`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `blockers.push(`无法读取主机资源：${(error as Error).message}`);`; `blockers.push(`项目配置：${(error as Error).message}`);`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function planLiveMigration(machines: Machines,
  scoreHosts: (input: { cpus: number; memoryMiB: number }) => Promise<Score>,
  id: string, raw: unknown, signal?: AbortSignal, query: Query = qmp,
  executionAvailable = false) {
  const vm = machines.get(id);
  const options = liveMigrationInput.safeParse(raw);
  const blockers: string[] = [];
  const steps = [
    '在目标主机创建相同体系结构、固件、CPU 和内存配置的暂停虚拟机',
    '在线复制并持续同步实例磁盘，校验目标基础镜像与源端脏块',
    '通过认证的迁移通道预复制内存与设备状态',
    '冻结源实例，完成剩余状态传输并取得唯一切换栅栏',
    '启动目标实例并验证客户机、磁盘与端口转发后释放源实例',
  ];
  if (!options.success)
    blockers.push('目标主机 ID 无效。');
  signal?.throwIfAborted();
  let score: Score | null = null;
  try { score = await scoreHosts({ cpus: vm.cpus, memoryMiB: vm.memoryMiB }); }
  catch (error) { blockers.push(`无法读取主机资源：${(error as Error).message}`); }
  const candidates = score?.candidates.filter((item) => item.source === 'peer')
    .map(({ id, name, eligible, reasons, status }) => ({ id, name, eligible,
      reasons, platform: status?.platform, arch: status?.arch })) || [];
  const local = score?.candidates.find((item) => item.source === 'local');
  /**
   * 入口 / Entry: planLiveMigration.compatible.
   * 功能：从当前输入或状态计算 `item.eligible && !!item.status && !!local?.status && item.status.platform === local.status.platform && item.status.arch === l…`，供调用方后续验证或使用。
   * Purpose: Computes `item.eligible && !!item.status && !!local?.status && item.status.platform === local.status.platform && item.status.arch === l…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: item: NonNullable<Score>['candidates'][number]
   * 输出 / Returns: `item.eligible && !!item.status && !!local?.status && item.status.platform === local.status.platform && item.status.arch === l…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  const compatible = (item: NonNullable<Score>['candidates'][number]) =>
    item.eligible && !!item.status && !!local?.status &&
    item.status.platform === local.status.platform &&
    item.status.arch === local.status.arch;
  const target = options.data?.targetHostId
    ? score?.candidates.find((item) => item.source === 'peer' &&
        item.id === options.data.targetHostId)
    : score?.candidates.find((item) => item.source === 'peer' && compatible(item)) ||
      score?.candidates.find((item) => item.source === 'peer');
  if (!target && !options.data?.targetHostId)
    blockers.push('尚无已配对的目标主机。');
  if (options.data?.targetHostId && !target)
    blockers.push('目标主机未配对或已移除。');
  if (target && !target.eligible)
    blockers.push(...target.reasons.map((reason) => `目标主机：${reason}`));
  if (target?.status && local?.status &&
      (target.status.platform !== local.status.platform ||
       target.status.arch !== local.status.arch))
    blockers.push('目标主机平台或体系结构与源主机不一致。');
  if (executionAvailable) {
    if (vm.liveMigrationFence || vm.haPromotion || vm.haRetirement)
      blockers.push('来源实例已有切换栅栏或故障接管记录。');
    if (vm.architecture === 'aarch64' || vm.firmware === 'uefi' ||
        vm.hardware?.devices?.graphics === 'virgl' || vm.diskEncryption ||
        vm.sandbox || vm.snapshots?.length || vm.pendingResize || vm.branchOrigin)
      blockers.push('此实例的硬件、磁盘或快照配置尚不能安全在线迁移。');
    if (machines.live.get(id)?.accelerator !== 'tcg')
      blockers.push('当前仅支持由 TCG 运行的来源实例。');
    try { await readLiveMigrationProjects(id); }
    catch (error) { blockers.push(`项目配置：${(error as Error).message}`); }
  }
  let qemu: unknown = null;
  let migration: unknown = null;
  if (machines.state(id) !== 'running' || !machines.live.get(id)) {
    blockers.push('源实例必须处于运行且就绪的状态。');
  } else {
    const port = machines.live.get(id)!.qmpPort;
    try {
      signal?.throwIfAborted();
      const status = await query(port, 'query-status', undefined, 5000) as
        { status?: string; running?: boolean };
      if (status?.status !== 'running' || status.running !== true)
        blockers.push(`源 QEMU 当前状态为 ${status?.status || '未知'}，不能开始迁移。`);
      qemu = await query(port, 'query-version', undefined, 5000);
      migration = await query(port, 'query-migrate', undefined, 5000);
      const migrationStatus = (migration as { status?: string })?.status;
      if (migrationStatus && !['none', 'completed', 'failed', 'cancelled'].includes(migrationStatus))
        blockers.push(`源 QEMU 已存在迁移任务：${migrationStatus}。`);
    } catch (error) {
      signal?.throwIfAborted();
      blockers.push(`源 QMP 检查失败：${(error as Error).message}`);
    }
  }
  if (!executionAvailable) {
    blockers.push('服务尚未把目标准备接口与来源迁移任务串成可执行的跨主机流程。');
    blockers.push('服务尚未把已验证的磁盘脏块同步与内存预复制接入跨主机执行流程。');
    blockers.push('服务尚未把持久切换栅栏、目标客户机就绪与故障恢复接入执行流程。');
  }
  return {
    ready: executionAvailable && blockers.length === 0,
    executed: false, planned: true, sourceVmId: id,
    targetHostId: target?.id || options.data?.targetHostId || null,
    checkedAt: new Date().toISOString(), qemu, migration,
    candidates, blockers, steps,
    reason: blockers[0],
    message: executionAvailable
      ? '检查通过后可运行在线迁移；切换后目标客户机就绪才会停止并封锁来源实例。'
      : '这是只读迁移计划；不会传输磁盘、启动目标或停止源实例。',
  };
}

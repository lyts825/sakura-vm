/**
 * 模块职责：声明并检查 HA 接管策略，核对已配对目标、实例状态与接管前置条件。
 * Module purpose: Declares/checks HA policies against paired targets, VM state and failover prerequisites.
 */
import type { HostPeersV1, SnapshotReplicationsV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';

export const haFailoverOptions = z.object({
  targetHostId: z.uuid().optional(),
  failureThreshold: z.number().int().min(2).max(10).default(3),
  maxReplicaAgeMinutes: z.number().int().min(1).max(10080).default(1440),
  autoProcessFailover: z.boolean().default(false),
  autoHostFailover: z.boolean().default(false),
}).strict();

/**
 * 入口 / Entry: checkHaFailover.
 * 功能：核对故障接管策略、目标配对、副本及见证前提，形成可执行性报告。
 * Purpose: Checks policy, pairing, replicas and witness prerequisites to report failover eligibility.
 * 设计：此入口用于检查与预览；没有完成隔离和原副本验证时不得根据可达性推断可安全接管。
 * Design: This checks/previews eligibility; reachability alone is not safe promotion without fencing and original replica verification.
 * 输入 / Inputs: machines: Machines; peers: HostPeersV1; replications: SnapshotReplicationsV1 | undefined; id: string; raw: unknown; enabled: boolean; signal: AbortSignal optional; processObserved: default=false; failureSuspected: default=false
 * 输出 / Returns: `{ ready: false, executed: false, checkedAt: new Date().toISOString(), localProcessReady, hostPlanReady, processObservedInSess…`.
 * 副作用 / Effects: `blockers.push`; 更新 / updates `target`, `compatible`, `receiptVerified`, `standbyStatus`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 失败处理：catch 分支执行 `blockers.push(`目标主机资源观测失败：${(error as Error).message}`);`; `signal?.throwIfAborted();`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `blockers.push(`目标主机资源观测失败：${(error as Error).message}`);`; `signal?.throwIfAborted();`; these statements determine whether a failure is absorbed or rejected again.
 */
export async function checkHaFailover(machines: Machines, peers: HostPeersV1,
  replications: SnapshotReplicationsV1 | undefined, id: string, raw: unknown,
  enabled: boolean, signal?: AbortSignal, processObserved = false,
  failureSuspected = false) {
  const policy = haFailoverOptions.parse(raw);
  const vm = machines.get(id);
  const sourceState = machines.state(id);
  const blockers: string[] = [];
  if (!enabled) blockers.push('接管策略已禁用。');
  if (!policy.targetHostId) blockers.push('尚未选择已配对的目标主机。');
  if (sourceState !== 'running') blockers.push(`源实例当前为 ${sourceState}，没有运行中的主实例可监测。`);
  signal?.throwIfAborted();
  let target: Awaited<ReturnType<HostPeersV1['score']>>['candidates'][number] | undefined;
  let compatible = false;
  try {
    const score = await peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    target = score.candidates.find((item) => item.source === 'peer' &&
      item.id === policy.targetHostId);
    const local = score.candidates.find((item) => item.source === 'local');
    compatible = !!target?.status && !!local?.status &&
      target.status.platform === local.status.platform &&
      target.status.arch === local.status.arch;
    if (target?.status && local?.status &&
        !compatible)
      blockers.push('目标主机平台或体系结构与源主机不一致。');
  } catch (error) { blockers.push(`目标主机资源观测失败：${(error as Error).message}`); }
  if (policy.targetHostId && !target) blockers.push('目标主机未配对或当前没有资源观测。');
  if (target && !target.eligible)
    blockers.push(...target.reasons.map((reason) => `目标主机：${reason}`));
  const peer = peers.view().outbound.find((item) => item.remoteId === policy.targetHostId);
  const replicas = replications?.view().entries.filter((entry) =>
    entry.vmId === id && entry.peerId === peer?.id && entry.status === 'replicated' &&
    !!entry.remoteVmId && !!entry.sha256) || [];
  /**
   * 入口 / Entry: checkHaFailover.snapshotAt.
   * 功能：从当前输入或状态计算 `vm.snapshots.find((item) => item.id === snapshotId)?.createdAt || ''`，供调用方后续验证或使用。
   * Purpose: Computes `vm.snapshots.find((item) => item.id === snapshotId)?.createdAt || ''` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: snapshotId: string
   * 输出 / Returns: `vm.snapshots.find((item) => item.id === snapshotId)?.createdAt || ''`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const snapshotAt = (snapshotId: string) =>
    vm.snapshots.find((item) => item.id === snapshotId)?.createdAt || '';
  const latest = replicas.sort((a, b) =>
    snapshotAt(b.snapshotId).localeCompare(snapshotAt(a.snapshotId)) ||
    b.createdAt.localeCompare(a.createdAt))[0];
  const snapshot = vm.snapshots.find((item) => item.id === latest?.snapshotId);
  const ageMinutes = snapshot ? Math.max(0,
    Math.ceil((Date.now() - Date.parse(snapshot.createdAt)) / 60_000)) : null;
  let receiptVerified = false;
  let standbyStatus: Awaited<ReturnType<HostPeersV1['checkReplicaActivation']>>['status'] | null = null;
  if (latest && peer) {
    try {
      signal?.throwIfAborted();
      const receipt = await peers.importStatus(peer.id, latest.transferId);
      signal?.throwIfAborted();
      receiptVerified = !!receipt && !!latest.remoteVmId && !!latest.sha256 &&
        receipt.id === latest.remoteVmId &&
        receipt.sha256 === latest.sha256 && receipt.sourceVmId === id &&
        receipt.snapshotId === latest.snapshotId;
      if (!receiptVerified) blockers.push('目标副本回执缺失或与已校验记录不一致。');
    } catch (error) {
      signal?.throwIfAborted();
      blockers.push(`无法复核目标副本回执：${(error as Error).message}`);
    }
  }
  if (!replications) blockers.push('快照复制服务尚未启用。');
  else if (!latest) blockers.push('目标主机没有已校验的实例副本。');
  else if (ageMinutes === null) blockers.push('来源快照已不存在，无法计算副本数据时效。');
  else if (ageMinutes > policy.maxReplicaAgeMinutes)
    blockers.push(`副本数据已超过 ${policy.maxReplicaAgeMinutes} 分钟时效上限。`);
  if ((policy.autoProcessFailover || policy.autoHostFailover) &&
      latest?.remoteVmId && latest.sha256 &&
      peer && receiptVerified) {
    try {
      signal?.throwIfAborted();
      const inspected = await peers.checkReplicaActivation(peer.id, {
        transferId: latest.transferId, remoteVmId: latest.remoteVmId,
        sha256: latest.sha256, sourceVmId: id, snapshotId: latest.snapshotId,
      });
      signal?.throwIfAborted();
      standbyStatus = inspected.status;
      if (standbyStatus !== 'stopped')
        blockers.push(`故障副本当前为 ${standbyStatus}，须停机后才能自动接管。`);
    } catch (error) {
      signal?.throwIfAborted();
      blockers.push(`目标故障副本启动预检失败：${(error as Error).message}`);
    }
  }
  if (!policy.autoHostFailover) {
    blockers.push('未启用独立见证节点接管；宿主失联不会自动启动副本。');
    blockers.push('仅本机确认 QEMU 进程退出时可使用持久栅栏启动副本。');
  }
  const localProcessReady = enabled && policy.autoProcessFailover &&
    processObserved && failureSuspected &&
    (sourceState === 'error' || sourceState === 'stopped') &&
    !machines.live.has(id) && !vm.haPromotion && !!target?.eligible &&
    compatible && !!latest?.remoteVmId && !!latest?.sha256 &&
    receiptVerified && standbyStatus === 'stopped' &&
    ageMinutes !== null && ageMinutes <= policy.maxReplicaAgeMinutes;
  const hostPlanReady = enabled && policy.autoHostFailover &&
    sourceState === 'running' && !vm.haPromotion && !!target?.eligible &&
    compatible && !!latest?.remoteVmId && !!latest.sha256 &&
    receiptVerified && standbyStatus === 'stopped' &&
    ageMinutes !== null && ageMinutes <= policy.maxReplicaAgeMinutes;
  return {
    ready: false, executed: false, checkedAt: new Date().toISOString(),
    localProcessReady, hostPlanReady, processObservedInSession: processObserved,
    failureSuspected,
    policy, source: { vmId: id, state: sourceState },
    target: target ? { hostId: target.id, name: target.name,
      eligible: target.eligible, reasons: target.reasons,
      observedAt: target.observedAt } : null,
    replica: latest ? { transferId: latest.transferId, peerId: latest.peerId,
      snapshotId: latest.snapshotId, remoteVmId: latest.remoteVmId,
      sha256: latest.sha256, replicatedAt: latest.updatedAt, ageMinutes,
      receiptVerified, standbyStatus } : null,
    blockers, reason: blockers[0],
    message: policy.autoHostFailover
      ? '独立见证节点须确认带外隔离、应用健康与流量切换，才会完成宿主失联接管。'
      : '开启本机进程故障接管后，达到故障阈值且 QEMU 已退出时将持久封锁来源并尝试启动已校验目标；宿主失联不会触发。',
  };
}

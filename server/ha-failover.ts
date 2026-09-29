import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';

export const haFailoverOptions = z.object({
  targetHostId: z.uuid().optional(),
  failureThreshold: z.number().int().min(2).max(10).default(3),
  maxReplicaAgeMinutes: z.number().int().min(1).max(10080).default(1440),
  autoProcessFailover: z.boolean().default(false),
}).strict();

export async function checkHaFailover(machines: Machines, peers: HostPeers,
  replications: SnapshotReplications | undefined, id: string, raw: unknown,
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
  let target: Awaited<ReturnType<HostPeers['score']>>['candidates'][number] | undefined;
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
  const snapshotAt = (snapshotId: string) =>
    vm.snapshots.find((item) => item.id === snapshotId)?.createdAt || '';
  const latest = replicas.sort((a, b) =>
    snapshotAt(b.snapshotId).localeCompare(snapshotAt(a.snapshotId)) ||
    b.createdAt.localeCompare(a.createdAt))[0];
  const snapshot = vm.snapshots.find((item) => item.id === latest?.snapshotId);
  const ageMinutes = snapshot ? Math.max(0,
    Math.ceil((Date.now() - Date.parse(snapshot.createdAt)) / 60_000)) : null;
  let receiptVerified = false;
  let standbyStatus: Awaited<ReturnType<HostPeers['checkReplicaActivation']>>['status'] | null = null;
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
  if (policy.autoProcessFailover && latest?.remoteVmId && latest.sha256 &&
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
  blockers.push('尚无独立见证节点与源主机栅栏，网络分区时不能安全地自动启动副本。');
  blockers.push('宿主失联接管仍缺目标健康确认与流量切换；仅本机确认 QEMU 进程退出时可使用持久栅栏启动副本。');
  const localProcessReady = enabled && policy.autoProcessFailover &&
    processObserved && failureSuspected &&
    (sourceState === 'error' || sourceState === 'stopped') &&
    !machines.live.has(id) && !vm.haPromotion && !!target?.eligible &&
    compatible && !!latest?.remoteVmId && !!latest?.sha256 &&
    receiptVerified && standbyStatus === 'stopped' &&
    ageMinutes !== null && ageMinutes <= policy.maxReplicaAgeMinutes;
  return {
    ready: false, executed: false, checkedAt: new Date().toISOString(),
    localProcessReady, processObservedInSession: processObserved,
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
    message: '开启本机进程故障接管后，达到故障阈值且 QEMU 已退出时将持久封锁来源并尝试启动已校验目标；宿主失联不会触发。',
  };
}

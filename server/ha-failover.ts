import { z } from 'zod';
import type { Machines } from './machines.ts';
import type { HostPeers } from './host-peers.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';

export const haFailoverOptions = z.object({
  targetHostId: z.uuid().optional(),
  failureThreshold: z.number().int().min(2).max(10).default(3),
  maxReplicaAgeMinutes: z.number().int().min(1).max(10080).default(1440),
}).strict();

export async function checkHaFailover(machines: Machines, peers: HostPeers,
  replications: SnapshotReplications | undefined, id: string, raw: unknown,
  enabled: boolean, signal?: AbortSignal) {
  const policy = haFailoverOptions.parse(raw);
  const vm = machines.get(id);
  const sourceState = machines.state(id);
  const blockers: string[] = [];
  if (!enabled) blockers.push('接管策略已禁用。');
  if (!policy.targetHostId) blockers.push('尚未选择已配对的目标主机。');
  if (sourceState !== 'running') blockers.push(`源实例当前为 ${sourceState}，没有运行中的主实例可监测。`);
  signal?.throwIfAborted();
  let target: Awaited<ReturnType<HostPeers['score']>>['candidates'][number] | undefined;
  try {
    const score = await peers.score({ cpus: vm.cpus, memoryMiB: vm.memoryMiB });
    target = score.candidates.find((item) => item.source === 'peer' &&
      item.id === policy.targetHostId);
    const local = score.candidates.find((item) => item.source === 'local');
    if (target?.status && local?.status &&
        (target.status.platform !== local.status.platform ||
         target.status.arch !== local.status.arch))
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
  blockers.push('尚无独立见证节点与源主机栅栏，网络分区时不能安全地自动启动副本。');
  blockers.push('故障接管尚未实现目标健康确认与流量切换；受控启动目前仅用于已移除源实例的冷迁移。');
  return {
    ready: false, executed: false, checkedAt: new Date().toISOString(),
    policy, source: { vmId: id, state: sourceState },
    target: target ? { hostId: target.id, name: target.name,
      eligible: target.eligible, reasons: target.reasons,
      observedAt: target.observedAt } : null,
    replica: latest ? { snapshotId: latest.snapshotId, remoteVmId: latest.remoteVmId,
      sha256: latest.sha256, replicatedAt: latest.updatedAt, ageMinutes,
      receiptVerified } : null,
    blockers, reason: blockers[0],
    message: '仅保存策略并检查健康与副本证据；不会自动启动目标或停止源实例。',
  };
}

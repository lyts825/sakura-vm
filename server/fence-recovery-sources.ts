/**
 * 模块职责：提供 HA 与在线迁移栅栏恢复来源；完成证明不足时保留原栅栏等待核验。
 */
import { createHash } from 'node:crypto';
import { liveMigrationFenceSchema, type HaPromotion, type LiveMigrationFence, type VMRecord } from '../shared/contracts/vm.ts';
import type { RecoverySource } from './recovery-catalog.ts';
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { migrationDigest, migrationFenceIdentity } from './live-migration-proof.ts';

const digest = (ticket: object) => createHash('sha256').update(JSON.stringify(
  Object.entries(ticket).filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
)).digest('hex');
const identityDigest = (promotion: HaPromotion) => {
  const { status: _status, updatedAt: _updatedAt, error: _error, ...identity } = promotion;
  return digest(identity);
};
const ticketId = (promotion: HaPromotion) => `ha-promotion:${promotion.transferId}:${identityDigest(promotion)}`;
const resourceId = (vmId: string, promotion: HaPromotion) => `ha-promotion:${vmId}:${identityDigest(promotion)}`;

/**
 * Discover durable local fences still awaiting the original target's acceptance.
 * Accepted promotions, replica retirement and witness enrollment are normal authority records.
 * No VM or fence is changed here; the HA protocol remains responsible for recovery and rejoin.
 *
 */
export function haPromotionRecoverySource(records: () => readonly VMRecord[]): RecoverySource {
  return {
    id: 'ha-promotion',
    discover: () => records().flatMap(vm => {
      const promotion = vm.haPromotion;
      if (!promotion || promotion.status !== 'fenced') return [];
      return [{
        binding: { domain: 'ha-promotion', ticketId: ticketId(promotion), owner: 'domain:ha-failover', vmId: vm.id },
        ticketRevision: digest(promotion),
        resourceIds: [resourceId(vm.id, promotion)],
        actions: [],
      }];
    }),
    confirmed: record => {
      if (record.binding.domain !== 'ha-promotion') return false;
      const vm = records().find(candidate => candidate.id === record.binding.vmId);
      const promotion = vm?.haPromotion;
      // Accepted is persisted only after the original HA protocol checks the target is running.
      // Match immutable identity as well as transfer id; absence and replacement prove nothing.
      return !!vm && !!promotion && promotion.status === 'accepted' && !promotion.error &&
        record.binding.ticketId === ticketId(promotion) && record.resourceIds.length === 1 &&
        record.resourceIds[0] === resourceId(vm.id, promotion);
    },
  };
}

type MigrationRecoveryPorts = {
  records(): readonly VMRecord[];
  peers(): Pick<HostPeersV1, 'view'> | undefined;
  confirm(id: string, fence: LiveMigrationFence): Promise<LiveMigrationFence>;
  canConfirm(id: string, fence: LiveMigrationFence): boolean;
  confirmed(id: string, fence: LiveMigrationFence): boolean;
};
const migrationTicketId = (fence: LiveMigrationFence) => `live-migration:${fence.transferId}:${migrationFenceIdentity(fence)}`;
const migrationResource = (id: string, fence: LiveMigrationFence) => `live-migration:${id}:${migrationFenceIdentity(fence)}`;
const migrationResources = (id: string, fence: LiveMigrationFence) =>
  [...new Set([migrationResource(id, fence), ...(fence.origin?.resourceIds || [])])].sort();
const migrationBinding = (id: string, fence: LiveMigrationFence) => ({
  domain: 'live-migration-fence', ticketId: migrationTicketId(fence),
  owner: fence.origin?.owner || 'domain:live-migration', vmId: id,
  pluginId: fence.origin?.pluginId, pluginInstanceId: fence.origin?.pluginInstanceId,
  pluginGeneration: fence.origin?.pluginGeneration, artifactDigest: fence.origin?.artifactDigest,
  operationId: fence.origin?.operationId,
});

/** This action verifies original receipts; it never removes a source fence or invents native exit evidence. */
export function liveMigrationRecoverySource(ports: MigrationRecoveryPorts): RecoverySource {
  return {
    id: 'live-migration-fence',
    discover: () => ports.records().flatMap(vm => {
      const fence = vm.liveMigrationFence;
      if (!fence || fence.completion) return [];
      const verifiable = !!fence.peerId && !!fence.sessionId && !!fence.sourceHostId &&
        !!fence.projectsDigest && !!fence.sourceProcessId && ports.canConfirm(vm.id, fence);
      return [{
        binding: migrationBinding(vm.id, fence),
        ticketRevision: migrationDigest(fence), resourceIds: migrationResources(vm.id, fence),
        error: verifiable ? '可安全终止原来源进程并核验原会话；来源栅栏继续保留。' :
          '迁移完成状态待核验；原会话或来源原进程退出证明不足，无法判断成功或失败。来源栅栏继续保留。',
        actions: verifiable && ports.peers() ? [{ id: 'verify-completion', title: '核验原迁移完成状态' }] : [],
      }];
    }),
    recover: async (candidate, action) => {
      if (action !== 'verify-completion') throw new AppError('不支持此迁移恢复动作', 403);
      const check = captureOperationCheck();
      await check();
      const vm = ports.records().find(record => record.id === candidate.binding.vmId);
      const fence = vm?.liveMigrationFence;
      if (!vm || !fence || candidate.binding.ticketId !== migrationTicketId(fence) ||
        candidate.ticketRevision !== migrationDigest(fence))
        throw new AppError('原迁移票据已变化或不可用', 409, 'RECOVERY_STALE');
      const original = structuredClone(fence), peers = ports.peers();
      if (!peers || !original.peerId || !ports.canConfirm(vm.id, original))
        throw new AppError('原迁移会话或来源退出证明不可用', 409);
      await ports.confirm(vm.id, original);
    },
    confirmed: record => {
      const vm = ports.records().find(candidate => candidate.id === record.binding.vmId);
      const parsed = liveMigrationFenceSchema.safeParse(vm?.liveMigrationFence);
      if (!vm || !parsed.success || !parsed.data.completion || parsed.data.completion.sourceVmId !== vm.id ||
        !ports.confirmed(vm.id, parsed.data)) return false;
      return migrationDigest(record.binding) === migrationDigest(migrationBinding(vm.id, parsed.data)) &&
        migrationDigest(record.resourceIds) === migrationDigest(migrationResources(vm.id, parsed.data));
    },
  };
}

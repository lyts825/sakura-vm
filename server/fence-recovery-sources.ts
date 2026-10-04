import { createHash } from 'node:crypto';
import type { HaPromotion, VMRecord } from '../shared/contracts/vm.ts';
import type { RecoverySource } from './recovery-catalog.ts';

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
 * liveMigrationFence has no durable completion receipt on the source. Successful migrations retain
 * it too, so it cannot be indexed as a pending recovery using this read-only record port.
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

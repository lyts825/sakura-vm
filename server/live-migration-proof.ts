/**
 * 模块职责：提供在线迁移完成证明端口；来源进程退出无法确认时继续保留来源栅栏。
 */
import { createHash } from 'node:crypto';
import type { LiveMigrationFence } from '../shared/contracts/vm.ts';
import type { LiveMigrationTargetStatus } from '../shared/contracts/live-migration.ts';
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { vmHostIdentity } from './vm-reference.ts';
import { pluginAuthority } from './plugin-authority.ts';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
export const migrationDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// A public HostPeers method cannot assert native source exit with a JSON boolean.
// Only this original-owner proof closure can mint an in-process request receipt.
const stoppedRequests = new WeakSet<object>();
export const isLiveMigrationStoppedRequest = (value: unknown) =>
  !!value && typeof value === 'object' && stoppedRequests.has(value);
export function migrationFenceIdentity(fence: LiveMigrationFence) {
  const { sourceStopped: _stopped, completion: _completion, ...identity } = fence;
  return migrationDigest(identity);
}

/** System-only port: callers cannot supply a target proof or a fence-release operation. */
export type LiveMigrationCompletionPort = {
  stop(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
  canConfirm(id: string, expected: LiveMigrationFence): boolean;
  confirmed(id: string, expected: LiveMigrationFence): boolean;
  confirm(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
};
type ProofOwner = {
  stopLiveMigrationSource(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
  canConfirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence): boolean;
  isLiveMigrationCompletionDurable(id: string, expected: LiveMigrationFence): boolean;
  confirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence,
    inspect: () => Promise<LiveMigrationTargetStatus>): Promise<LiveMigrationFence>;
};
export function createLiveMigrationCompletionPort(owner: ProofOwner,
  peers: () => Pick<HostPeersV1, 'view' | 'inspectLiveTarget'> & Partial<Pick<HostPeersV1, 'completeLiveTarget'>>): LiveMigrationCompletionPort {
  if (pluginAuthority() || vmHostIdentity(owner) !== owner)
    throw new AppError('迁移证明端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
  return {
    stop: (id, expected) => owner.stopLiveMigrationSource(id, expected),
    canConfirm: (id, expected) => owner.canConfirmLiveMigrationCompletion(id, expected),
    confirmed: (id, expected) => owner.isLiveMigrationCompletionDurable(id, expected),
    confirm: async (id, expected) => {
      if (!owner.canConfirmLiveMigrationCompletion(id, expected))
        throw new AppError('原来源进程退出回执不可用，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED');
      const stopped = expected.sourceStopped ? expected : await owner.stopLiveMigrationSource(id, expected);
      return owner.confirmLiveMigrationCompletion(id, stopped, async () => {
        const check = captureOperationCheck();
        await check();
        const original = peers(), view = original.view();
        if (!expected.peerId || view.hostId !== expected.sourceHostId ||
          !view.outbound.some(peer => peer.id === expected.peerId && peer.remoteId === expected.targetHostId))
          throw new AppError('原配对主机身份已变化', 409, 'LIVE_MIGRATION_TARGET_UNCONFIRMED');
        let result = await original.inspectLiveTarget(expected.peerId,
          { targetVmId: expected.targetVmId, transferId: expected.transferId });
        // The private source owner has already published native exit evidence before any target cold recovery.
        if ((result.status !== 'running' || result.originStatus !== 'ready') && original.completeLiveTarget) {
          const request = Object.freeze({
            targetVmId: expected.targetVmId, transferId: expected.transferId,
            sessionId: expected.sessionId, sourceStopped: true,
          });
          stoppedRequests.add(request);
          try { result = await original.completeLiveTarget(expected.peerId, request); }
          finally { stoppedRequests.delete(request); }
          const deadline = Date.now() + 120_000;
          while (result.status !== 'running' || result.originStatus !== 'ready') {
            await check();
            if (Date.now() >= deadline) throw new AppError('原迁移目标恢复就绪超时；来源栅栏继续保留', 504);
            await new Promise(resolve => setTimeout(resolve, 1000));
            result = await original.inspectLiveTarget(expected.peerId, {
              targetVmId: expected.targetVmId, transferId: expected.transferId,
            });
          }
        }
        await check();
        if (peers() !== original) throw new AppError('原迁移核验服务已变化', 409);
        return result;
      });
    },
  };
}

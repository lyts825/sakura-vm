/**
 * 模块职责：捕获恢复票据的原操作归属并计算修订摘要，供恢复动作匹配原始证据。
 */
import { createHash } from 'node:crypto';
import { recoveryOriginSchema, type RecoveryOrigin } from '../shared/contracts/domain-recovery.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';

/** Identity capture only: domain callers receive no authority, scope, handler or resource object. */
export function captureRecoveryOrigin(resourceIds: readonly string[] = []): RecoveryOrigin | undefined {
  const identity = resourceContext(), instance = pluginAuthority();
  if (!identity && !instance) return undefined;
  return recoveryOriginSchema.parse({
    owner: identity?.owner || instance!.owner, pluginId: instance?.pluginId || identity?.pluginId,
    pluginInstanceId: instance?.identity || identity?.pluginInstanceId,
    pluginGeneration: instance?.generation || identity?.pluginGeneration,
    artifactDigest: instance?.artifactDigest, operationId: identity?.operationId,
    resourceIds: [...new Set(resourceIds)],
  });
}
export const recoveryTicketRevision = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

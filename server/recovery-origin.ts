/**
 * 模块职责：捕获恢复票据的原操作归属并计算修订摘要，供恢复动作匹配原始证据。
 * Module purpose: Captures recovery-ticket origin and computes revisions used to match actions with original evidence.
 */
import { createHash } from 'node:crypto';
import { recoveryOriginSchema, type RecoveryOrigin } from '../shared/contracts/domain-recovery.ts';
import { resourceContext } from './host-runtime/context.ts';
import { pluginAuthority } from './plugin-authority.ts';

/** Identity capture only: domain callers receive no authority, scope, handler or resource object. */
/**
 * 入口 / Entry: captureRecoveryOrigin.
 * 功能：在捕获恢复票据的原操作归属并计算修订摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `recoveryOriginSchema.parse({ owner: identity?.owner || instance!.owner, pluginId: instance?.pluginId || identity?.pluginId, p…` 供上层消费（`recovery-origin.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-origin.ts`; this entry produces `undefined` / `recoveryOriginSchema.parse({ owner: identity?.owner || instance!.owner, pluginId: instance?.pluginId || identity?.pluginId, p…` for its caller. Module context: Captures recovery-ticket origin and computes revisions used to match actions with original evidence.
 * 处理：通过 `resourceContext`, `pluginAuthority`, `recoveryOriginSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `resourceContext`, `pluginAuthority`, `recoveryOriginSchema.parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!identity && !instance`.
 * 输入 / Inputs: resourceIds: readonly string[] default=[]
 * 输出 / Returns: RecoveryOrigin | undefined；结果来自 / values from `undefined`; `recoveryOriginSchema.parse({ owner: identity?.owner || instance!.owner, pluginId: instance?.pluginId || identity?.pluginId, p…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
/**
 * 入口 / Entry: recoveryTicketRevision.
 * 功能：在捕获恢复票据的原操作归属并计算修订摘要中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(value)).digest('hex')` 供上层消费（`recovery-origin.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-origin.ts`; this entry produces `createHash('sha256').update(JSON.stringify(value)).digest('hex')` for its caller. Module context: Captures recovery-ticket origin and computes revisions used to match actions with original evidence.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: string；结果来自 / values from `createHash('sha256').update(JSON.stringify(value)).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const recoveryTicketRevision = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

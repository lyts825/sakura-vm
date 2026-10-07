/**
 * 模块职责：提供在线迁移完成证明端口；来源进程退出无法确认时继续保留来源栅栏。
 * Module purpose: Provides completion proof authority; unconfirmed original source exit retains the source fence.
 */
import { createHash } from 'node:crypto';
import type { LiveMigrationFence } from '../shared/contracts/vm.ts';
import type { LiveMigrationTargetStatus } from '../shared/contracts/live-migration.ts';
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { vmHostIdentity } from './vm-reference.ts';
import { pluginAuthority } from './plugin-authority.ts';

/**
 * 入口 / Entry: canonical.
 * 功能：在提供在线迁移完成证明端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value.map(canonical)` / `Object.fromEntries(Object.entries(value) .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -…` 供上层消费（`live-migration-proof.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-proof.ts`; this entry produces `value.map(canonical)` / `Object.fromEntries(Object.entries(value) .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -…` for its caller. Module context: Provides completion proof authority; unconfirmed original source exit retains the source fence.
 * 处理：通过 `value.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `value.map`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `Array.isArray(value)`; `value && typeof value === 'object'`.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: unknown；结果来自 / values from `value.map(canonical)`; `Object.fromEntries(Object.entries(value) .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -…`; `value`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
/**
 * 入口 / Entry: migrationDigest.
 * 功能：在提供在线迁移完成证明端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')` 供上层消费（`live-migration-proof.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-proof.ts`; this entry produces `createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')` for its caller. Module context: Provides completion proof authority; unconfirmed original source exit retains the source fence.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash`, `canonical` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`, `canonical`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const migrationDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// A public HostPeers method cannot assert native source exit with a JSON boolean.
// Only this original-owner proof closure can mint an in-process request receipt.
const stoppedRequests = new WeakSet<object>();
/**
 * 入口 / Entry: isLiveMigrationStoppedRequest.
 * 功能：从当前输入或状态计算 `!!value && typeof value === 'object' && stoppedRequests.has(value)`，供调用方后续验证或使用。
 * Purpose: Computes `!!value && typeof value === 'object' && stoppedRequests.has(value)` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `!!value && typeof value === 'object' && stoppedRequests.has(value)`.
 * 副作用 / Effects: `stoppedRequests.has`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const isLiveMigrationStoppedRequest = (value: unknown) =>
  !!value && typeof value === 'object' && stoppedRequests.has(value);
/**
 * 入口 / Entry: migrationFenceIdentity.
 * 功能：把本层请求转交 `migrationDigest`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `migrationDigest` and propagates the provider result or rejection.
 * 输入 / Inputs: fence: LiveMigrationFence
 * 输出 / Returns: `migrationDigest(identity)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function migrationFenceIdentity(fence: LiveMigrationFence) {
  const { sourceStopped: _stopped, completion: _completion, ...identity } = fence;
  return migrationDigest(identity);
}

/** System-only port: callers cannot supply a target proof or a fence-release operation. */
export type LiveMigrationCompletionPort = {
  /**
   * 签名 / Signature: LiveMigrationCompletionPort.stop.
   * 功能：为提供在线迁移完成证明端口声明 stop 的输入与结果契约，所属容器为 LiveMigrationCompletionPort。
   * Purpose: Declares the input/result contract for stop in LiveMigrationCompletionPort. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  stop(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
  /**
   * 签名 / Signature: LiveMigrationCompletionPort.canConfirm.
   * 功能：为提供在线迁移完成证明端口声明 canConfirm 的输入与结果契约，所属容器为 LiveMigrationCompletionPort。
   * Purpose: Declares the input/result contract for canConfirm in LiveMigrationCompletionPort. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  canConfirm(id: string, expected: LiveMigrationFence): boolean;
  /**
   * 签名 / Signature: LiveMigrationCompletionPort.confirmed.
   * 功能：为提供在线迁移完成证明端口声明 confirmed 的输入与结果契约，所属容器为 LiveMigrationCompletionPort。
   * Purpose: Declares the input/result contract for confirmed in LiveMigrationCompletionPort. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirmed(id: string, expected: LiveMigrationFence): boolean;
  /**
   * 签名 / Signature: LiveMigrationCompletionPort.confirm.
   * 功能：为提供在线迁移完成证明端口声明 confirm 的输入与结果契约，所属容器为 LiveMigrationCompletionPort。
   * Purpose: Declares the input/result contract for confirm in LiveMigrationCompletionPort. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirm(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
};
type ProofOwner = {
  /**
   * 签名 / Signature: ProofOwner.stopLiveMigrationSource.
   * 功能：为提供在线迁移完成证明端口声明 stopLiveMigrationSource 的输入与结果契约，所属容器为 ProofOwner。
   * Purpose: Declares the input/result contract for stopLiveMigrationSource in ProofOwner. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  stopLiveMigrationSource(id: string, expected: LiveMigrationFence): Promise<LiveMigrationFence>;
  /**
   * 签名 / Signature: ProofOwner.canConfirmLiveMigrationCompletion.
   * 功能：为提供在线迁移完成证明端口声明 canConfirmLiveMigrationCompletion 的输入与结果契约，所属容器为 ProofOwner。
   * Purpose: Declares the input/result contract for canConfirmLiveMigrationCompletion in ProofOwner. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  canConfirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence): boolean;
  /**
   * 签名 / Signature: ProofOwner.isLiveMigrationCompletionDurable.
   * 功能：为提供在线迁移完成证明端口声明 isLiveMigrationCompletionDurable 的输入与结果契约，所属容器为 ProofOwner。
   * Purpose: Declares the input/result contract for isLiveMigrationCompletionDurable in ProofOwner. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  isLiveMigrationCompletionDurable(id: string, expected: LiveMigrationFence): boolean;
  /**
   * 签名 / Signature: ProofOwner.confirmLiveMigrationCompletion.
   * 功能：为提供在线迁移完成证明端口声明 confirmLiveMigrationCompletion 的输入与结果契约，所属容器为 ProofOwner。
   * Purpose: Declares the input/result contract for confirmLiveMigrationCompletion in ProofOwner. Module responsibility: Provides completion proof authority; unconfirmed original source exit retains the source fence.
   * 输入 / Inputs: id: string; expected: LiveMigrationFence; inspect: () => Promise<LiveMigrationTargetStatus>
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirmLiveMigrationCompletion(id: string, expected: LiveMigrationFence,
    inspect:
    /**
     * 中文功能：读取原目标会话状态，供来源迁移完成证明的检查输入。
     * English: Reads the original target-session status as input to source migration-completion proof checks.
     * 所属 / Owner: ProofOwner.confirmLiveMigrationCompletion.inspect.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `Promise<LiveMigrationTargetStatus>`.
     */
    () => Promise<LiveMigrationTargetStatus>): Promise<LiveMigrationFence>;
};
/**
 * 入口 / Entry: createLiveMigrationCompletionPort.
 * 功能：在提供在线迁移完成证明端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ stop: (id, expected) => owner.stopLiveMigrationSource(id, expected), canConfirm: (id, expected) => owner.canConfirmLiveMigr…` 供上层消费（`live-migration-proof.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-proof.ts`; this entry produces `{ stop: (id, expected) => owner.stopLiveMigrationSource(id, expected), canConfirm: (id, expected) => owner.canConfirmLiveMigr…` for its caller. Module context: Provides completion proof authority; unconfirmed original source exit retains the source fence.
 * 处理：通过 `pluginAuthority`, `vmHostIdentity` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `pluginAuthority`, `vmHostIdentity`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: owner: ProofOwner; peers: () => Pick<HostPeersV1, 'view' | 'inspectLiveTarget'> & Partial<Pick<HostPeersV1, 'co…
 * 输出 / Returns: LiveMigrationCompletionPort；结果来自 / values from `{ stop: (id, expected) => owner.stopLiveMigrationSource(id, expected), canConfirm: (id, expected) => owner.canConfirmLiveMigr…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `pluginAuthority() || vmHostIdentity(owner) !== owner`; 异常 / errors `new AppError('迁移证明端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY')`.
 */
export function createLiveMigrationCompletionPort(owner: ProofOwner,
  peers: () => Pick<HostPeersV1, 'view' | 'inspectLiveTarget'> & Partial<Pick<HostPeersV1, 'completeLiveTarget'>>): LiveMigrationCompletionPort {
  if (pluginAuthority() || vmHostIdentity(owner) !== owner)
    throw new AppError('迁移证明端口仅允许系统装配', 403, 'LIVE_MIGRATION_SYSTEM_ONLY');
  return {
    /**
     * 入口 / Entry: createLiveMigrationCompletionPort.stop.
     * 功能：把本层请求转交 `owner.stopLiveMigrationSource`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `owner.stopLiveMigrationSource` and propagates the provider result or rejection.
     * 输入 / Inputs: id; expected
     * 输出 / Returns: `owner.stopLiveMigrationSource(id, expected)`.
     * 副作用 / Effects: `owner.stopLiveMigrationSource`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    stop: (id, expected) => owner.stopLiveMigrationSource(id, expected),
    /**
     * 入口 / Entry: createLiveMigrationCompletionPort.canConfirm.
     * 功能：把本层请求转交 `owner.canConfirmLiveMigrationCompletion`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `owner.canConfirmLiveMigrationCompletion` and propagates the provider result or rejection.
     * 输入 / Inputs: id; expected
     * 输出 / Returns: `owner.canConfirmLiveMigrationCompletion(id, expected)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    canConfirm: (id, expected) => owner.canConfirmLiveMigrationCompletion(id, expected),
    /**
     * 入口 / Entry: createLiveMigrationCompletionPort.confirmed.
     * 功能：把本层请求转交 `owner.isLiveMigrationCompletionDurable`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `owner.isLiveMigrationCompletionDurable` and propagates the provider result or rejection.
     * 输入 / Inputs: id; expected
     * 输出 / Returns: `owner.isLiveMigrationCompletionDurable(id, expected)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirmed: (id, expected) => owner.isLiveMigrationCompletionDurable(id, expected),
    /**
     * 入口 / Entry: createLiveMigrationCompletionPort.confirm.
     * 功能：在提供在线迁移完成证明端口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `owner.confirmLiveMigrationCompletion(id, stopped, async () => { const check = captureOperationCheck(); await check(); const o…` 供上层消费（`live-migration-proof.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `live-migration-proof.ts`; this entry produces `owner.confirmLiveMigrationCompletion(id, stopped, async () => { const check = captureOperationCheck(); await check(); const o…` for its caller. Module context: Provides completion proof authority; unconfirmed original source exit retains the source fence.
     * 处理：通过 `owner.canConfirmLiveMigrationCompletion`, `owner.stopLiveMigrationSource`, `owner.confirmLiveMigrationCompletion` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `owner.canConfirmLiveMigrationCompletion`, `owner.stopLiveMigrationSource`, `owner.confirmLiveMigrationCompletion`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: id; expected
     * 输出 / Returns: `owner.confirmLiveMigrationCompletion(id, stopped, async () => { const check = captureOperationCheck(); await check(); const o…`.
     * 副作用 / Effects: `owner.stopLiveMigrationSource`.
     * 拒绝 / Refusals: 条件 / conditions `!owner.canConfirmLiveMigrationCompletion(id, expected)`; 异常 / errors `new AppError('原来源进程退出回执不可用，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED')`.
     */
    confirm: async (id, expected) => {
      if (!owner.canConfirmLiveMigrationCompletion(id, expected))
        throw new AppError('原来源进程退出回执不可用，保持栅栏等待核验', 409, 'LIVE_MIGRATION_SOURCE_UNCONFIRMED');
      const stopped = expected.sourceStopped ? expected : await owner.stopLiveMigrationSource(id, expected);
      /**
       * 入口 / Entry: createLiveMigrationCompletionPort.callback@57.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（owner.confirmLiveMigrationCompletion）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (owner.confirmLiveMigrationCompletion).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `result`.
       * 副作用 / Effects: `stoppedRequests.add`; `stoppedRequests.delete`; 更新 / updates `result`.
       * 拒绝 / Refusals: 条件 / conditions `!expected.peerId || view.hostId !== expected.sourceHostId || !view.outbound.some(peer => peer.id === expected.peerId && peer.…`; `(result.status !== 'running' || result.originStatus !== 'ready') && original.completeLiveTarget`; `Date.now() >= deadline`; 异常 / errors `new AppError('原配对主机身份已变化', 409, 'LIVE_MIGRATION_TARGET_UNCONFIRMED')`; `new AppError('原迁移目标恢复就绪超时；来源栅栏继续保留', 504)`.
       * 收尾：退出 try 区域时始终执行 `stoppedRequests.delete(request);`；这些步骤也适用于异常退出。
       * Finalization: Leaving the try region always executes `stoppedRequests.delete(request);`; these steps also apply to exceptional exits.
       */
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

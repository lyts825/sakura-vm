/**
 * 模块职责：提供 HA 与在线迁移栅栏恢复来源；完成证明不足时保留原栅栏等待核验。
 * Module purpose: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
 */
import { createHash } from 'node:crypto';
import { liveMigrationFenceSchema, type HaPromotion, type LiveMigrationFence, type VMRecord } from '../shared/contracts/vm.ts';
import type { RecoverySource } from './recovery-catalog.ts';
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { AppError } from '../shared/errors.ts';
import { captureOperationCheck } from './operation-context.ts';
import { migrationDigest, migrationFenceIdentity } from './live-migration-proof.ts';

/**
 * 入口 / Entry: digest.
 * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify( Object.entries(ticket).filter(([, value]) => value !== undefined) .sort(([left], …` 供上层消费（`fence-recovery-sources.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `createHash('sha256').update(JSON.stringify( Object.entries(ticket).filter(([, value]) => value !== undefined) .sort(([left], …` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: ticket: object
 * 输出 / Returns: `createHash('sha256').update(JSON.stringify( Object.entries(ticket).filter(([, value]) => value !== undefined) .sort(([left], …`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (ticket: object) => createHash('sha256').update(JSON.stringify(
  Object.entries(ticket).filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
)).digest('hex');
/**
 * 入口 / Entry: identityDigest.
 * 功能：把本层请求转交 `digest`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `digest` and propagates the provider result or rejection.
 * 输入 / Inputs: promotion: HaPromotion
 * 输出 / Returns: `digest(identity)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const identityDigest = (promotion: HaPromotion) => {
  const { status: _status, updatedAt: _updatedAt, error: _error, ...identity } = promotion;
  return digest(identity);
};
/**
 * 入口 / Entry: ticketId.
 * 功能：从当前输入或状态计算 ``ha-promotion:${promotion.transferId}:${identityDigest(promotion)}``，供调用方后续验证或使用。
 * Purpose: Computes ``ha-promotion:${promotion.transferId}:${identityDigest(promotion)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: promotion: HaPromotion
 * 输出 / Returns: ``ha-promotion:${promotion.transferId}:${identityDigest(promotion)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const ticketId = (promotion: HaPromotion) => `ha-promotion:${promotion.transferId}:${identityDigest(promotion)}`;
/**
 * 入口 / Entry: resourceId.
 * 功能：从当前输入或状态计算 ``ha-promotion:${vmId}:${identityDigest(promotion)}``，供调用方后续验证或使用。
 * Purpose: Computes ``ha-promotion:${vmId}:${identityDigest(promotion)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: vmId: string; promotion: HaPromotion
 * 输出 / Returns: ``ha-promotion:${vmId}:${identityDigest(promotion)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const resourceId = (vmId: string, promotion: HaPromotion) => `ha-promotion:${vmId}:${identityDigest(promotion)}`;

/**
 * Discover durable local fences still awaiting the original target's acceptance.
 * Accepted promotions, replica retirement and witness enrollment are normal authority records.
 * No VM or fence is changed here; the HA protocol remains responsible for recovery and rejoin.
 *
 */
/**
 * 入口 / Entry: haPromotionRecoverySource.
 * 功能：从当前输入或状态计算 `{ id: 'ha-promotion', discover: () => records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: 'ha-promotion', discover: () => records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: records: () => readonly VMRecord[]
 * 输出 / Returns: RecoverySource；结果来自 / values from `{ id: 'ha-promotion', discover: () => records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function haPromotionRecoverySource(records: () => readonly VMRecord[]): RecoverySource {
  return {
    id: 'ha-promotion',
    /**
     * 入口 / Entry: haPromotionRecoverySource.discover.
     * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion.status !== 'fenced') return []; retur…` 供上层消费（`fence-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion.status !== 'fenced') return []; retur…` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
     * 处理：通过 `records().flatMap`, `records` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `records().flatMap`, `records`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `records().flatMap(vm => { const promotion = vm.haPromotion; if (!promotion || promotion.status !== 'fenced') return []; retur…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: haPromotionRecoverySource.confirmed.
     * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `!!vm && !!promotion && promotion.status === 'accepted' && !promotion.error && record.binding.ticketId === ticketId(promotion)…` 供上层消费（`fence-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `false` / `!!vm && !!promotion && promotion.status === 'accepted' && !promotion.error && record.binding.ticketId === ticketId(promotion)…` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
     * 处理：通过 `records().find`, `records`, `ticketId`, `resourceId` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `records().find`, `records`, `ticketId`, `resourceId`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `record.binding.domain !== 'ha-promotion'`.
     * 输入 / Inputs: record
     * 输出 / Returns: `false`; `!!vm && !!promotion && promotion.status === 'accepted' && !promotion.error && record.binding.ticketId === ticketId(promotion)…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
  /**
   * 签名 / Signature: MigrationRecoveryPorts.records.
   * 功能：为提供 HA 与在线迁移栅栏恢复来源声明 records 的输入与结果契约，所属容器为 MigrationRecoveryPorts。
   * Purpose: Declares the input/result contract for records in MigrationRecoveryPorts. Module responsibility: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: readonly VMRecord[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  records(): readonly VMRecord[];
  /**
   * 签名 / Signature: MigrationRecoveryPorts.peers.
   * 功能：为提供 HA 与在线迁移栅栏恢复来源声明 peers 的输入与结果契约，所属容器为 MigrationRecoveryPorts。
   * Purpose: Declares the input/result contract for peers in MigrationRecoveryPorts. Module responsibility: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Pick<HostPeersV1, 'view'> | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  peers(): Pick<HostPeersV1, 'view'> | undefined;
  /**
   * 签名 / Signature: MigrationRecoveryPorts.confirm.
   * 功能：为提供 HA 与在线迁移栅栏恢复来源声明 confirm 的输入与结果契约，所属容器为 MigrationRecoveryPorts。
   * Purpose: Declares the input/result contract for confirm in MigrationRecoveryPorts. Module responsibility: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
   * 输入 / Inputs: id: string; fence: LiveMigrationFence
   * 输出 / Returns: Promise<LiveMigrationFence>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirm(id: string, fence: LiveMigrationFence): Promise<LiveMigrationFence>;
  /**
   * 签名 / Signature: MigrationRecoveryPorts.canConfirm.
   * 功能：为提供 HA 与在线迁移栅栏恢复来源声明 canConfirm 的输入与结果契约，所属容器为 MigrationRecoveryPorts。
   * Purpose: Declares the input/result contract for canConfirm in MigrationRecoveryPorts. Module responsibility: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
   * 输入 / Inputs: id: string; fence: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  canConfirm(id: string, fence: LiveMigrationFence): boolean;
  /**
   * 签名 / Signature: MigrationRecoveryPorts.confirmed.
   * 功能：为提供 HA 与在线迁移栅栏恢复来源声明 confirmed 的输入与结果契约，所属容器为 MigrationRecoveryPorts。
   * Purpose: Declares the input/result contract for confirmed in MigrationRecoveryPorts. Module responsibility: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
   * 输入 / Inputs: id: string; fence: LiveMigrationFence
   * 输出 / Returns: boolean.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirmed(id: string, fence: LiveMigrationFence): boolean;
};
/**
 * 入口 / Entry: migrationTicketId.
 * 功能：从当前输入或状态计算 ``live-migration:${fence.transferId}:${migrationFenceIdentity(fence)}``，供调用方后续验证或使用。
 * Purpose: Computes ``live-migration:${fence.transferId}:${migrationFenceIdentity(fence)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: fence: LiveMigrationFence
 * 输出 / Returns: ``live-migration:${fence.transferId}:${migrationFenceIdentity(fence)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const migrationTicketId = (fence: LiveMigrationFence) => `live-migration:${fence.transferId}:${migrationFenceIdentity(fence)}`;
/**
 * 入口 / Entry: migrationResource.
 * 功能：从当前输入或状态计算 ``live-migration:${id}:${migrationFenceIdentity(fence)}``，供调用方后续验证或使用。
 * Purpose: Computes ``live-migration:${id}:${migrationFenceIdentity(fence)}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: id: string; fence: LiveMigrationFence
 * 输出 / Returns: ``live-migration:${id}:${migrationFenceIdentity(fence)}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const migrationResource = (id: string, fence: LiveMigrationFence) => `live-migration:${id}:${migrationFenceIdentity(fence)}`;
/**
 * 入口 / Entry: migrationResources.
 * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...new Set([migrationResource(id, fence), ...(fence.origin?.resourceIds || [])])].sort()` 供上层消费（`fence-recovery-sources.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `[...new Set([migrationResource(id, fence), ...(fence.origin?.resourceIds || [])])].sort()` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
 * 处理：通过 `inline.sort`, `migrationResource` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.sort`, `migrationResource`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: id: string; fence: LiveMigrationFence
 * 输出 / Returns: `[...new Set([migrationResource(id, fence), ...(fence.origin?.resourceIds || [])])].sort()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const migrationResources = (id: string, fence: LiveMigrationFence) =>
  [...new Set([migrationResource(id, fence), ...(fence.origin?.resourceIds || [])])].sort();
/**
 * 入口 / Entry: migrationBinding.
 * 功能：从当前输入或状态计算 `({ domain: 'live-migration-fence', ticketId: migrationTicketId(fence), owner: fence.origin?.owner || 'domain:live-migration',…`，供调用方后续验证或使用。
 * Purpose: Computes `({ domain: 'live-migration-fence', ticketId: migrationTicketId(fence), owner: fence.origin?.owner || 'domain:live-migration',…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: id: string; fence: LiveMigrationFence
 * 输出 / Returns: `({ domain: 'live-migration-fence', ticketId: migrationTicketId(fence), owner: fence.origin?.owner || 'domain:live-migration',…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const migrationBinding = (id: string, fence: LiveMigrationFence) => ({
  domain: 'live-migration-fence', ticketId: migrationTicketId(fence),
  owner: fence.origin?.owner || 'domain:live-migration', vmId: id,
  pluginId: fence.origin?.pluginId, pluginInstanceId: fence.origin?.pluginInstanceId,
  pluginGeneration: fence.origin?.pluginGeneration, artifactDigest: fence.origin?.artifactDigest,
  operationId: fence.origin?.operationId,
});

/** This action verifies original receipts; it never removes a source fence or invents native exit evidence. */
/**
 * 入口 / Entry: liveMigrationRecoverySource.
 * 功能：从当前输入或状态计算 `{ id: 'live-migration-fence', discover: () => ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: 'live-migration-fence', discover: () => ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: ports: MigrationRecoveryPorts
 * 输出 / Returns: RecoverySource；结果来自 / values from `{ id: 'live-migration-fence', discover: () => ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function liveMigrationRecoverySource(ports: MigrationRecoveryPorts): RecoverySource {
  /**
   * 入口 / Entry: liveMigrationRecoverySource.callback@78.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（ports.records().flatMap）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (ports.records().flatMap).
   * 输入 / Inputs: vm
   * 输出 / Returns: `[]`; `[{ binding: migrationBinding(vm.id, fence), ticketRevision: migrationDigest(fence), resourceIds: migrationResources(vm.id, fe…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return {
    id: 'live-migration-fence',
    /**
     * 入口 / Entry: liveMigrationRecoverySource.discover.
     * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence || fence.completion) return []; const verifia…` 供上层消费（`fence-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence || fence.completion) return []; const verifia…` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
     * 处理：通过 `ports.records().flatMap`, `ports.records` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `ports.records().flatMap`, `ports.records`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `ports.records().flatMap(vm => { const fence = vm.liveMigrationFence; if (!fence || fence.completion) return []; const verifia…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    discover: () => ports.records().flatMap(
    /**
     * 中文功能：为尚无完成证明的迁移栅栏建立恢复票据，仅在原会话/来源进程等证明可核对且 peers 可用时提供核验动作。
     * English: Creates recovery tickets for migration fences without completion proof, offering verification only when original-session/source-process evidence and peers are available.
     * 所属 / Owner: liveMigrationRecoverySource.discover.
     * 输入 / Inputs: vm.
     */
    vm => {
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
    /**
     * 入口 / Entry: liveMigrationRecoverySource.recover.
     * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`fence-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; the calls and state transitions below complete the operation. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
     * 处理：通过 `captureOperationCheck`, `check`, `ports.records().find`, `ports.records` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `captureOperationCheck`, `check`, `ports.records().find`, `ports.records`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: candidate; action
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `action !== 'verify-completion'`; `!vm || !fence || candidate.binding.ticketId !== migrationTicketId(fence) || candidate.ticketRevision !== migrationDigest(fenc…`; `!peers || !original.peerId || !ports.canConfirm(vm.id, original)`; 异常 / errors `new AppError('不支持此迁移恢复动作', 403)`; `new AppError('原迁移票据已变化或不可用', 409, 'RECOVERY_STALE')`.
     */
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
    /**
     * 入口 / Entry: liveMigrationRecoverySource.confirmed.
     * 功能：在提供 HA 与在线迁移栅栏恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `migrationDigest(record.binding) === migrationDigest(migrationBinding(vm.id, parsed.data)) && migrationDigest(record.resourceI…` 供上层消费（`fence-recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `fence-recovery-sources.ts`; this entry produces `false` / `migrationDigest(record.binding) === migrationDigest(migrationBinding(vm.id, parsed.data)) && migrationDigest(record.resourceI…` for its caller. Module context: Exposes HA and live-migration fence recovery; insufficient completion proof retains original fences for verification.
     * 处理：通过 `ports.records().find`, `ports.records`, `liveMigrationFenceSchema.safeParse`, `ports.confirmed` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `ports.records().find`, `ports.records`, `liveMigrationFenceSchema.safeParse`, `ports.confirmed`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `!vm || !parsed.success || !parsed.data.completion || parsed.data.completion.sourceVmId !== vm.id || …`.
     * 输入 / Inputs: record
     * 输出 / Returns: `false`; `migrationDigest(record.binding) === migrationDigest(migrationBinding(vm.id, parsed.data)) && migrationDigest(record.resourceI…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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

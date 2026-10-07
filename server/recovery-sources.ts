/**
 * 模块职责：将插件和宿主资源清理接入恢复目录，重试要求原实例产物及代次仍可核对。
 * Module purpose: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
 */
import type { RecoverySource } from './recovery-catalog.ts';
import type { PluginManager } from './plugin-manager.ts';
import type { HostRuntimeView } from '../shared/contracts/host-runtime.ts';
import { hostAudit } from './audit.ts';
import { AppError } from '../shared/errors.ts';

/** The adapter captures original activation tickets; no authority is reconstructed from a resource id. */
/**
 * 入口 / Entry: pluginRecoverySource.
 * 功能：从当前输入或状态计算 `{ id: 'plugin-lifecycle', discover: () => { const resources = snapshot().resources; return manager.directory .all() .filter((…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: 'plugin-lifecycle', discover: () => { const resources = snapshot().resources; return manager.directory .all() .filter((…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: manager: PluginManager; snapshot: () => HostRuntimeView
 * 输出 / Returns: RecoverySource；结果来自 / values from `{ id: 'plugin-lifecycle', discover: () => { const resources = snapshot().resources; return manager.directory .all() .filter((…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function pluginRecoverySource(
  manager: PluginManager,
  snapshot: () => HostRuntimeView,
): RecoverySource {
  return {
    id: 'plugin-lifecycle',
    /**
     * 入口 / Entry: pluginRecoverySource.discover.
     * 功能：在将插件和宿主资源清理接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `manager.directory .all() .filter((instance) => instance.phase === 'cleanup-pending') .map((instance) => ({ binding: { domain:…` 供上层消费（`recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-sources.ts`; this entry produces `manager.directory .all() .filter((instance) => instance.phase === 'cleanup-pending') .map((instance) => ({ binding: { domain:…` for its caller. Module context: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
     * 处理：通过 `snapshot`, `manager.directory.all().filter().map`, `manager.directory.all().filter`, `manager.directory.all` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `snapshot`, `manager.directory.all().filter().map`, `manager.directory.all().filter`, `manager.directory.all`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `manager.directory .all() .filter((instance) => instance.phase === 'cleanup-pending') .map((instance) => ({ binding: { domain:…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    discover: () => {
      const resources = snapshot().resources;
      return manager.directory
        .all()
        .filter((instance) => instance.phase === 'cleanup-pending')
        .map((instance) => ({
          binding: {
            domain: 'plugin-lifecycle',
            ticketId: instance.scope.diagnostics().resourceId || instance.generation,
            owner: instance.owner,
            pluginId: instance.pluginId,
            pluginInstanceId: instance.identity,
            pluginGeneration: instance.generation,
            artifactDigest: instance.artifactDigest,
          },
          resourceIds: resources
            .filter(
              (resource) =>
                resource.identity.pluginInstanceId === instance.identity &&
                resource.identity.pluginGeneration === instance.generation,
            )
            .map((resource) => resource.id),
          actions: manager.canRetryCleanup(instance.identity, instance.generation)
            ? [{ id: 'retry-cleanup', title: '重试原插件清理' }] : [],
        }));
    },
    /**
     * 入口 / Entry: pluginRecoverySource.recover.
     * 功能：在将插件和宿主资源清理接入恢复目录中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-sources.ts`; the calls and state transitions below complete the operation. Module context: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
     * 处理：通过 `manager.directory.all().find`, `manager.directory.all`, `hostAudit().span`, `hostAudit` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `manager.directory.all().find`, `manager.directory.all`, `hostAudit().span`, `hostAudit`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: candidate
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!original`; `snapshot().resources.some( (resource) => resource.identity.pluginInstanceId === original.identity && resource.identity.plugin…`; 异常 / errors `new Error('原插件产物与代次不可用')`; `new AppError('原插件仍有未核销资源', 503, 'RECOVERY_CLEANUP_PENDING')`.
     */
    recover: async (candidate) => {
      const original = manager.directory
        .all()
        .find(
          (instance) =>
            instance.identity === candidate.binding.pluginInstanceId &&
            instance.generation === candidate.binding.pluginGeneration &&
            instance.artifactDigest === candidate.binding.artifactDigest,
        );
      if (!original) throw new Error('原插件产物与代次不可用');
      await hostAudit().span({ kind: 'request', name: 'recovery.plugin-lifecycle' }, () =>
        manager.retryCleanup(original.identity, original.generation),
      );
      if (
        snapshot().resources.some(
          (resource) =>
            resource.identity.pluginInstanceId === original.identity &&
            resource.identity.pluginGeneration === original.generation,
        )
      )
        throw new AppError('原插件仍有未核销资源', 503, 'RECOVERY_CLEANUP_PENDING');
    },
    /**
     * 入口 / Entry: pluginRecoverySource.confirmed.
     * 功能：在将插件和宿主资源清理接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `manager.directory .all() .some( (instance) => instance.identity === record.binding.pluginInstanceId && instance.generation ==…` 供上层消费（`recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-sources.ts`; this entry produces `manager.directory .all() .some( (instance) => instance.identity === record.binding.pluginInstanceId && instance.generation ==…` for its caller. Module context: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
     * 处理：通过 `manager.directory.all().some`, `manager.directory.all` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `manager.directory.all().some`, `manager.directory.all`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: record
     * 输出 / Returns: `manager.directory .all() .some( (instance) => instance.identity === record.binding.pluginInstanceId && instance.generation ==…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirmed: (record) =>
      manager.directory
        .all()
        .some(
          (instance) =>
            instance.identity === record.binding.pluginInstanceId &&
            instance.generation === record.binding.pluginGeneration &&
            instance.artifactDigest === record.binding.artifactDigest &&
            instance.phase === 'inactive' &&
            !snapshot().resources.some(
              (resource) =>
                resource.identity.pluginInstanceId === instance.identity &&
                resource.identity.pluginGeneration === instance.generation,
            ),
        ),
  };
}

/** Unbound resources remain discoverable but cannot be released through a generic management action. */
/**
 * 入口 / Entry: resourceRecoverySource.
 * 功能：从当前输入或状态计算 `{ id: 'resource-owner', discover: () => snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map…`，供调用方后续验证或使用。
 * Purpose: Computes `{ id: 'resource-owner', discover: () => snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: snapshot: () => HostRuntimeView
 * 输出 / Returns: RecoverySource；结果来自 / values from `{ id: 'resource-owner', discover: () => snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function resourceRecoverySource(snapshot: () => HostRuntimeView): RecoverySource {
  /**
   * 入口 / Entry: resourceRecoverySource.callback@90.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（snapshot().resources.filter().map）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (snapshot().resources.filter().map).
   * 输入 / Inputs: resource
   * 输出 / Returns: `{ binding: { domain: 'resource-owner', ticketId: resource.id, owner: resource.owner, pluginId, pluginInstanceId, pluginGenera…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  return {
    id: 'resource-owner',
    /**
     * 入口 / Entry: resourceRecoverySource.discover.
     * 功能：在将插件和宿主资源清理接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map((resource) => { const { pluginId, plugi…` 供上层消费（`recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-sources.ts`; this entry produces `snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map((resource) => { const { pluginId, plugi…` for its caller. Module context: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
     * 处理：通过 `snapshot().resources.filter().map`, `snapshot().resources.filter`, `snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `snapshot().resources.filter().map`, `snapshot().resources.filter`, `snapshot`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `snapshot() .resources.filter((resource) => resource.state === 'cleanup-pending') .map((resource) => { const { pluginId, plugi…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    discover: () =>
      snapshot()
        .resources.filter((resource) => resource.state === 'cleanup-pending')
        .map(
        /**
         * 中文功能：把资源的插件实例/世代、操作、实例、项目和 job 身份映射为恢复 binding，返回原资源 ID 且不宣称可自动恢复动作。
         * English: Maps resource plugin-instance/generation, operation, VM, project and job identity into a recovery binding with its original resource ID and no automatic actions.
         * 所属 / Owner: resourceRecoverySource.discover.
         * 输入 / Inputs: resource.
         */
        (resource) => {
          const { pluginId, pluginInstanceId, pluginGeneration, operationId, vmId, projectId, jobId } =
            resource.identity;
          return {
            binding: {
              domain: 'resource-owner',
              ticketId: resource.id,
              owner: resource.owner,
              pluginId,
              pluginInstanceId,
              pluginGeneration,
              operationId,
              vmId,
              projectId,
              jobId,
            },
            resourceIds: [resource.id],
            actions: [],
          };
        }),
    /**
     * 入口 / Entry: resourceRecoverySource.confirmed.
     * 功能：在将插件和宿主资源清理接入恢复目录中，执行此领域的具体处理步骤并返回其结果；本入口产生 `snapshot().recent.some( (resource) => resource.id === record.binding.ticketId && resource.state === 'released', )` 供上层消费（`recovery-sources.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `recovery-sources.ts`; this entry produces `snapshot().recent.some( (resource) => resource.id === record.binding.ticketId && resource.state === 'released', )` for its caller. Module context: Adapts plugin/host cleanup into recovery, requiring the original instance artifact and generation for retry.
     * 处理：通过 `snapshot().recent.some`, `snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `snapshot().recent.some`, `snapshot`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: record
     * 输出 / Returns: `snapshot().recent.some( (resource) => resource.id === record.binding.ticketId && resource.state === 'released', )`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirmed: (record) =>
      snapshot().recent.some(
        (resource) => resource.id === record.binding.ticketId && resource.state === 'released',
      ),
  };
}

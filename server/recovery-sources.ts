import type { RecoverySource } from './recovery-catalog.ts';
import type { PluginManager } from './plugin-manager.ts';
import type { HostRuntimeView } from '../shared/contracts/host-runtime.ts';
import { hostAudit } from './audit.ts';
import { AppError } from '../shared/errors.ts';

/** The adapter captures original activation tickets; no authority is reconstructed from a resource id. */
export function pluginRecoverySource(
  manager: PluginManager,
  snapshot: () => HostRuntimeView,
): RecoverySource {
  return {
    id: 'plugin-lifecycle',
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
export function resourceRecoverySource(snapshot: () => HostRuntimeView): RecoverySource {
  return {
    id: 'resource-owner',
    discover: () =>
      snapshot()
        .resources.filter((resource) => resource.state === 'cleanup-pending')
        .map((resource) => {
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
    confirmed: (record) =>
      snapshot().recent.some(
        (resource) => resource.id === record.binding.ticketId && resource.state === 'released',
      ),
  };
}

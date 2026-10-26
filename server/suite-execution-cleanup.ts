/** 装配专用原资源能力；只有经过本体账本校验的零参数闭包可以越过已撤销的业务操作。 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  suiteExecutionReceipt,
  type SuiteExecutionReceipt,
  type SuiteExecutionProfileId,
} from '../shared/contracts/seventh-execution.ts';
import type { OwnedImageVm, ImageAsset } from '../shared/contracts/image-assets.ts';
import type { ImageAssets, OriginalImageVmCleanupPort } from './image-assets.ts';
import { MetadataStore } from './metadata-store.ts';
import { withoutOperationContext } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { cleanupReceipt } from './cleanup-receipt.ts';
import { DATA } from './paths.ts';
export type SuiteExecutionCleanupFactory = ((
  receipt: SuiteExecutionReceipt,
) => Promise<() => Promise<OwnedImageVm | null>>) & {
  imageInventory: () => Promise<ImageAsset[]>;
};
const bindings: Record<string, { profile: SuiteExecutionProfileId; consumers: string[] }> = {
  schedulerProbeSessions: {profile:'schedule-probe',consumers:['official:schedlab-harness']},
  extensionBuildSessions: {profile:'extension-build',consumers:['official:extforge-builds']},
  protocolScenarioSessions: {profile:'protocol-scenario',consumers:['official:protostate-runs']},
  multiServiceVirtualizationSessions: {profile:'multi-service',consumers:['official:virtservice-sessions']},
  browserSessions: { profile: 'browser', consumers: ['official:browser-runners'] },
  databaseRehearsal: { profile: 'database', consumers: ['official:database-fixtures'] },
  eventSessions: { profile: 'event', consumers: ['official:event-brokers'] },
  mediaTasks: { profile: 'media', consumers: ['official:media-inspect', 'official:media-workers'] },
  learningToolSessions: { profile: 'learning', consumers: ['official:learning-sessions'] },
};
export function executionCleanupFactory(
  serviceId: string,
  assets: ImageAssets,
  machines: OriginalImageVmCleanupPort,
  checkOriginalProviders: () => void,
  data = DATA,
): SuiteExecutionCleanupFactory {
  const binding = bindings[serviceId];
  if (!binding) throw new AppError('系统服务不拥有固定工具清理域', 403, 'SUITE_EXECUTION_CLEANUP_SERVICE');
  // Broker preserves the nearest official consumer through nested system calls.
  const original = <T>(principal: string, work: () => T) =>
    withoutOperationContext(() =>
      withoutPluginAuthority(() =>
        withNewResourceContext(
          { owner: 'core:suite-execution-cleanup', serviceConsumerPluginInstanceId: principal },
          work,
        ),
      ),
    );
  const create = async (raw: SuiteExecutionReceipt) => {
    checkOriginalProviders();
    const receipt = suiteExecutionReceipt.parse(raw);
    if (receipt.profile !== binding.profile || !binding.consumers.includes(receipt.consumer))
      throw new AppError('原会话固定消费者不匹配', 403, 'SUITE_EXECUTION_CLEANUP_SCOPE');
    const principal = receipt.consumer;
    const owner = principal.slice(9) + ':' + receipt.id;
    const file = join(data, 'suite-execution', binding.profile, 'state.json');
    const ledger = z
      .object({
        schemaVersion: z.literal(1),
        sessions: z
          .array(z.object({ receipt: suiteExecutionReceipt, owner: z.string() }).passthrough())
          .max(1000),
      })
      .passthrough()
      .parse((await new MetadataStore<unknown>(file, { fallback: () => null }).read()).value);
    const saved = ledger.sessions.find((row) => row.receipt.id === receipt.id);
    if (!saved || saved.owner !== owner || JSON.stringify(saved.receipt) !== JSON.stringify(receipt))
      throw new AppError('原会话账本或代次不匹配', 403, 'SUITE_EXECUTION_CLEANUP_LEDGER');
    const plan = z
      .object({
        plans: z.array(
          z
            .object({ id: z.uuid(), image: z.object({ assetId: z.string(), digest: z.string() }) })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse((await new MetadataStore<unknown>(file, { fallback: () => null }).read()).value)
      .plans.find((p) => p.id === receipt.planId);
    if (!plan) throw new AppError('原会话批准丢失', 403, 'SUITE_EXECUTION_CLEANUP_LEDGER');
    const cleanup = await original(principal, () =>
      assets.originalExecutionCleanup(principal, owner, plan.image, receipt.vm, machines),
    );
    return cleanupReceipt(async () => {
      checkOriginalProviders();
      return original(principal, cleanup);
    });
  };
  return Object.assign(create, {
    imageInventory: async () => {
      checkOriginalProviders();
      return original(binding.consumers[0], () => assets.executionImageInventory());
    },
  });
}

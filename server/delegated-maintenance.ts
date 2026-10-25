/** 清理动作沿用原 CleanupPlans 令牌和原清理器；委派不能指定路径。 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { cleanupProviderIdSchema, cleanupResultSchema } from '../shared/contracts/cleanup-plan.ts';
import { delegatedCleanupSummarySchema } from '../shared/contracts/delegated-actions.ts';
import {
  DelegatedActionProvider,
  delegatedHash,
  type OriginalActionAdapter,
} from './delegated-action-provider.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { CleanupPlans } from './cleanup-plan.ts';
const grantSchema = z.object({ provider: cleanupProviderIdSchema, token: z.uuid() }).strict();
export function maintenanceActions(metadata: PluginMetadata, cleanup: CleanupPlans) {
  const adapter: OriginalActionAdapter = {
    id: 'maintenance-cleanup',
    async preview(input, signal) {
      if (input.adapter !== 'maintenance-cleanup') throw new AppError('原清理提供者不接受此动作', 400);
      const preview = await cleanup.preview(input.provider, signal);
      if (preview.entries.length > 1000)
        throw new AppError('清理范围超过 1000 项，请回原清理页面核对', 409, 'DELEGATED_PLAN_TOO_LARGE');
      const { token: _token, ...visible } = preview;
      const summary = delegatedCleanupSummarySchema.parse(visible);
      return {
        summary,
        resourceDigest: delegatedHash(summary),
        grant: { provider: input.provider, token: preview.token },
        expiresAt: preview.expiresAt,
      };
    },
    async execute(input, grant, _digest, signal, beforeDispatch) {
      const original = grantSchema.parse(grant);
      if (input.adapter !== 'maintenance-cleanup' || input.provider !== original.provider)
        throw new AppError('原清理目标不一致', 409);
      return cleanupResultSchema.parse(
        await cleanup.execute(original.provider, original.token, signal, beforeDispatch),
      );
    },
  };
  return new DelegatedActionProvider(metadata, adapter);
}

/** 对原运行核销；不接收 VM ID，不创建替代运行。 */
import { AppError } from '../shared/errors.ts';
import { resilienceRunSchema } from '../shared/contracts/resilience-lab.ts';
import {
  DelegatedActionProvider,
  delegatedHash,
  type OriginalActionAdapter,
} from './delegated-action-provider.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { ResilienceRuns } from './resilience-runs.ts';
export function resilienceActions(metadata: PluginMetadata, runs: ResilienceRuns) {
  const adapter: OriginalActionAdapter = {
    id: 'resilience-reconcile',
    async preview(input, signal) {
      if (input.adapter !== 'resilience-reconcile') throw new AppError('原演练提供者不接受此动作', 400);
      signal.throwIfAborted();
      const run = resilienceRunSchema.parse(await runs.get(input.scope, input.runId));
      return {
        summary: {
          runId: run.id,
          scope: run.scope,
          createdAt: run.createdAt,
          state: run.state,
          containment: run.containment,
          cleanup: run.cleanup,
          planDigest: run.plan.digest,
          note: '核销仍以原运行、原副本和监管证明为准；返回不代表资源一定已释放。',
        },
        resourceDigest: delegatedHash(run),
        grant: null,
      };
    },
    async execute(input, _grant, digest, signal, beforeDispatch) {
      if (input.adapter !== 'resilience-reconcile') throw new AppError('原演练目标不一致', 409);
      const run = await runs.reconcileDelegated(input.scope, input.runId, digest, signal, beforeDispatch);
      return {
        runId: run.id,
        state: run.state,
        containment: run.containment,
        cleanup: run.cleanup,
        outcome: run.outcome,
        resultDigest: delegatedHash(run),
        source: 'original-provider',
      };
    },
  };
  return new DelegatedActionProvider(metadata, adapter);
}

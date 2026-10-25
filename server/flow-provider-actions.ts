/** 原提供者签发一次票据；只接入两个固定业务方法，不提供动态分发。 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';
import type * as I from '../shared/contracts/integration-lab.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { IntegrationRunnersV1 } from './service-contracts/integration-lab.ts';
import type { KnowledgePublishV1 } from './service-contracts/knowledge-studio.ts';
import {
  DelegatedActionProvider,
  delegatedHash,
  type OriginalActionAdapter,
} from './delegated-action-provider.ts';
import type { DelegatedReceipt, DelegatedTicket } from '../shared/contracts/delegated-actions.ts';
function fail(): never {
  throw new AppError('原提供者或原计划不匹配', 409, 'FLOW_PROVIDER_PLAN_CHANGED');
}
const json = (v: unknown) => S.suiteJson.parse(v);
const runResult = (run: I.IntegrationRun) =>
  json({
    source: 'original-provider',
    provider: 'integration-runners',
    runId: run.id,
    originalPlanId: run.plan.id,
    originalPlanDigest: run.plan.digest,
    createdAt: run.createdAt,
    state: run.state,
    cleanupConfirmed: run.cleanupConfirmed,
    requests: run.requests.length,
    error: run.error,
    resultDigest: delegatedHash(run),
    completed: run.cleanupConfirmed && ['completed', 'interrupted', 'effect-unknown'].includes(run.state),
    succeeded:
      run.cleanupConfirmed &&
      run.state === 'completed' &&
      !run.error &&
      !!run.evaluation?.results.length &&
      run.evaluation.results.every((r) => r.outcome === 'satisfied'),
    uncertain: run.state === 'effect-unknown' || !run.cleanupConfirmed,
    cancellationSupported: true,
  });
export function flowIntegrationActions(metadata: PluginMetadata, runs: IntegrationRunnersV1) {
  const adapter: OriginalActionAdapter = {
    id: 'integration-run',
    async preview(input, signal) {
      if (input.adapter !== 'integration-run') fail();
      signal.throwIfAborted();
      const plan = await runs.preview(input.scope, input.input);
      return {
        summary: json({
          originalPlanId: plan.id,
          originalPlanDigest: plan.digest,
          scope: input.scope,
          request: input.input,
          writes: plan.writes,
          approveWrites: input.approveWrites,
          toolDigest: plan.toolDigest,
          snapshotDigest: plan.snapshotDigest,
          targetDigest: plan.targetDigest,
          deadline: plan.deadline,
          completion: '原运行完成并确认清理后才能放行后继节点',
        }),
        resourceDigest: plan.digest,
        grant: json({ id: plan.id, digest: plan.digest }),
        expiresAt: plan.expiresAt,
      };
    },
    async execute(input, grant, digest, signal, beforeDispatch) {
      if (input.adapter !== 'integration-run') fail();
      const saved = z.object({ id: z.uuid(), digest: S.suiteDigest }).strict().parse(grant),
        plan = (await runs.plans(input.scope)).find((p) => p.id === saved.id);
      if (
        !plan ||
        plan.digest !== digest ||
        saved.digest !== digest ||
        plan.state !== 'validated' ||
        plan.runId
      )
        fail();
      signal.throwIfAborted();
      await beforeDispatch();
      signal.throwIfAborted();
      return runResult(
        await runs.apply(input.scope, {
          planId: plan.id,
          digest: plan.digest,
          approveWrites: input.approveWrites,
        }),
      );
    },
  };
  const original = new DelegatedActionProvider(metadata, adapter);
  const inspect = async (ticket: DelegatedTicket): Promise<DelegatedReceipt> => {
    const receipt = await original.inspect(ticket);
    if (receipt.plan.input.adapter !== 'integration-run') fail();
    if (!['returned', 'unknown'].includes(receipt.status)) return receipt;
    const summary = z
        .object({ originalPlanId: z.uuid(), originalPlanDigest: S.suiteDigest })
        .passthrough()
        .parse(receipt.plan.summary),
      plan = (await runs.plans(receipt.plan.input.scope)).find((p) => p.id === summary.originalPlanId);
    if (!plan?.runId || plan.digest !== summary.originalPlanDigest) return receipt;
    const run = await runs.inspect(receipt.plan.input.scope, plan.runId);
    if (run.plan.id !== plan.id || run.plan.digest !== plan.digest) fail();
    return {
      ...receipt,
      status: 'returned',
      result: runResult(run),
      error: null,
      updatedAt: new Date().toISOString(),
    };
  };
  return {
    init: () => original.init(),
    close: () => original.close(),
    preview: original.preview.bind(original),
    dispatch: async (...args: Parameters<DelegatedActionProvider['dispatch']>) => {
      await original.dispatch(...args);
      return inspect(args[0]);
    },
    inspect,
    acknowledge: original.acknowledge.bind(original),
  };
}
export function flowKnowledgeActions(metadata: PluginMetadata, publish: KnowledgePublishV1) {
  const adapter: OriginalActionAdapter = {
    id: 'knowledge-publish',
    async preview(input, signal) {
      if (input.adapter !== 'knowledge-publish') fail();
      signal.throwIfAborted();
      const plan = await publish.plan({
        spaceId: input.spaceId,
        document: input.document,
        review: input.review,
      });
      return {
        summary: json({
          spaceId: input.spaceId,
          document: input.document,
          review: input.review,
          originalPlanDigest: plan.digest,
          summary: plan.summary,
          changes: '原知识发布服务切换本机活跃阅读版本',
          cancellationSupported: false,
        }),
        resourceDigest: plan.digest,
        grant: json({ spaceId: input.spaceId, token: plan.token, digest: plan.digest }),
        expiresAt: plan.expiresAt,
      };
    },
    async execute(input, grant, digest, signal, beforeDispatch) {
      if (input.adapter !== 'knowledge-publish') fail();
      const saved = z
        .object({ spaceId: z.uuid(), token: z.uuid(), digest: S.suiteDigest })
        .strict()
        .parse(grant);
      if (saved.spaceId !== input.spaceId || saved.digest !== digest) fail();
      signal.throwIfAborted();
      await beforeDispatch();
      const publication = await publish.apply({ spaceId: saved.spaceId, token: saved.token }, signal);
      return json({
        source: 'original-provider',
        provider: 'knowledge-publish',
        publicationId: publication.id,
        publicationRevision: publication.revision,
        publicationDigest: publication.digest,
        document: publication.document,
        review: publication.review,
        spaceId: publication.spaceId,
        completed: true,
        succeeded: !publication.withdrawn,
        cancellationSupported: false,
      });
    },
  };
  const original = new DelegatedActionProvider(metadata, adapter);
  const inspect = async (ticket: DelegatedTicket): Promise<DelegatedReceipt> => {
    const receipt = await original.inspect(ticket);
    if (receipt.plan.input.adapter !== 'knowledge-publish') fail();
    if (receipt.status !== 'returned') return receipt;
    const result = z
      .object({ publicationId: z.uuid(), publicationDigest: K.digest })
      .passthrough()
      .parse(receipt.result);
    const publication = await publish.read({ spaceId: receipt.plan.input.spaceId, id: result.publicationId });
    if (publication.digest !== result.publicationDigest) fail();
    return receipt;
  };
  return {
    init: () => original.init(),
    close: () => original.close(),
    preview: original.preview.bind(original),
    dispatch: original.dispatch.bind(original),
    inspect,
    acknowledge: original.acknowledge.bind(original),
  };
}

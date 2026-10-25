/** 固定 DAG、逐阶段批准和不可执行的导入历史。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { delegatedInputSchema, delegatedPlanSchema, delegatedReceiptSchema } from './delegated-actions.ts';
export const flowNodeId = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
export const flowBinding = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
export const flowProviderInput = z.discriminatedUnion('adapter', [
  delegatedInputSchema.options[2],
  delegatedInputSchema.options[3],
]);
const nodeBase = z.object({ id: flowNodeId, label: S.suiteName });
export const flowNode = z.discriminatedUnion('type', [
  nodeBase.extend({ type: z.literal('material'), binding: flowBinding }).strict(),
  nodeBase.extend({ type: z.literal('approval'), prompt: z.string().trim().min(1).max(4000) }).strict(),
  nodeBase.extend({ type: z.literal('wait'), until: z.iso.datetime() }).strict(),
  nodeBase
    .extend({
      type: z.literal('condition'),
      binding: flowBinding,
      equals: z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]),
    })
    .strict(),
  nodeBase.extend({ type: z.literal('provider'), target: flowProviderInput }).strict(),
]);
export const flowEdge = z
  .object({
    from: flowNodeId,
    to: flowNodeId,
    on: z.enum(['success', 'failure', 'always']).default('success'),
  })
  .strict();
export const flowGraph = z
  .object({ nodes: z.array(flowNode).min(1).max(24), edges: z.array(flowEdge).max(50) })
  .strict();
export const flowDefinition = flowGraph
  .extend({ format: z.literal('sakura-flow-definition/1'), order: z.array(flowNodeId).min(1).max(24) })
  .strict();
export const flowCompile = S.suiteScope.extend({ name: S.suiteName, graph: flowGraph }).strict();
export const flowInput = z
  .object({
    format: z.literal('sakura-flow-input/1'),
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    bindings: z.record(
      flowBinding,
      z.union([z.string().max(65536), z.number().finite(), z.boolean(), z.null()]),
    ),
    reviewed: z.literal(true),
  })
  .strict();
export const flowBind = S.suiteScope.extend({ source: S.suiteRef, reviewed: z.literal(true) }).strict();
export const flowSelect = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const flowGraphPlan = z
  .object({
    format: z.literal('sakura-flow-plan/1'),
    kind: z.literal('graph'),
    definition: S.suiteRef,
    inputs: S.suiteRef,
    order: z.array(flowNodeId).max(24),
    providers: z.array(z.object({ adapter: z.string(), available: z.boolean() }).strict()).max(2),
    valid: z.boolean(),
    issues: z.array(z.string().max(500)).max(50),
    actor: S.suiteId,
    expiresAt: z.iso.datetime(),
    invalidated: z.boolean(),
  })
  .strict();
export const flowStepPlan = z
  .object({
    format: z.literal('sakura-flow-plan/1'),
    kind: z.literal('step'),
    definition: S.suiteRef,
    inputs: S.suiteRef,
    runId: S.suiteId,
    runRevision: S.suiteDigest,
    node: flowNode,
    providerPlan: delegatedPlanSchema.nullable(),
    dependencies: z.array(S.suiteRef).max(24),
    actor: S.suiteId,
    runGeneration: z.string().min(1),
    expiresAt: z.iso.datetime(),
    invalidated: z.boolean(),
  })
  .strict();
export const flowPlan = z.discriminatedUnion('kind', [flowGraphPlan, flowStepPlan]);
export const flowPreview = S.suiteScope.extend({ definition: S.suiteRef, inputs: S.suiteRef }).strict();
export const flowStepReady = flowPreview
  .extend({
    runId: S.suiteId,
    runRevision: S.suiteDigest,
    nodeId: flowNodeId,
    dependencies: z.array(S.suiteRef).max(24),
  })
  .strict();
export const flowApproval = z
  .object({
    format: z.literal('sakura-flow-approval/1'),
    plan: S.suiteRef,
    decision: z.enum(['approved', 'revoked', 'consumed']),
    actor: S.suiteId,
    epoch: S.suiteId,
    reason: z.string().min(1).max(2000),
    expiresAt: z.iso.datetime(),
    consumedBy: S.suiteId.nullable(),
  })
  .strict();
export const flowApprove = S.suiteScope
  .extend({ plan: S.suiteRef, reason: z.string().trim().min(1).max(2000) })
  .strict();
export const flowRevoke = flowSelect('approval')
  .extend({ reason: z.string().trim().min(1).max(2000) })
  .strict();
export const flowClaim = flowSelect('approval')
  .extend({ plan: S.suiteRef, runId: S.suiteId, runRevision: S.suiteDigest, nodeId: flowNodeId })
  .strict();
export const flowNodeState = z
  .object({
    id: flowNodeId,
    status: z.enum([
      'blocked',
      'ready',
      'awaiting-approval',
      'running',
      'waiting',
      'completed',
      'failed',
      'unknown',
      'cancelled',
    ]),
    outcome: z.boolean().nullable(),
    plan: S.suiteRef.nullable(),
    stageBaseRevision: S.suiteDigest.nullable().default(null),
    approval: S.suiteRef.nullable(),
    receipt: delegatedReceiptSchema.nullable(),
    event: S.suiteRef.nullable(),
    until: z.iso.datetime().nullable(),
    timerId: S.suiteId.nullable().default(null),
    error: z.string().max(500).nullable(),
  })
  .strict();
export const flowRun = z
  .object({
    format: z.literal('sakura-flow-run/1'),
    graphPlan: S.suiteRef,
    definition: S.suiteRef,
    inputs: S.suiteRef,
    status: z.enum(['active', 'waiting', 'completed', 'cancelled', 'interrupted']),
    nodes: z.array(flowNodeState).min(1).max(24),
    startedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    cancelled: z.boolean(),
    generation: z.string().min(1),
    journal: z.array(S.suiteRef).max(100),
    limitations: z.array(z.string().max(500)).max(10),
  })
  .strict();
export const flowRunKey = S.suiteScope.extend({ id: S.suiteId }).strict();
export const flowNodeKey = flowRunKey.extend({ nodeId: flowNodeId }).strict();
export const flowAdvance = flowNodeKey
  .extend({ approval: S.suiteRef, expectedRevision: S.suiteDigest })
  .strict();
export const flowEvent = z
  .object({
    format: z.literal('sakura-flow-event/1'),
    runId: S.suiteId,
    index: z.number().int().min(1).max(10000),
    previous: S.suiteDigest.nullable(),
    kind: z.enum(['started', 'intent', 'returned', 'failed', 'waiting', 'woke', 'cancelled', 'reconciled']),
    nodeId: flowNodeId.nullable(),
    actor: S.suiteId,
    at: z.iso.datetime(),
    data: S.suiteJson,
  })
  .strict();
export const flowAppend = S.suiteScope
  .extend({
    runId: S.suiteId,
    kind: flowEvent.shape.kind,
    nodeId: flowNodeId.nullable(),
    data: S.suiteJson,
    references: z.array(S.suiteRef).max(30),
  })
  .strict();
export const flowTimer = z
  .object({
    format: z.literal('sakura-flow-timer/1'),
    runId: S.suiteId,
    nodeId: flowNodeId,
    run: S.suiteRef,
    until: z.iso.datetime(),
    state: z.enum(['scheduled', 'consumed', 'released', 'cancelled', 'unknown']),
    actor: S.suiteId,
    result: S.suiteRef.nullable(),
  })
  .strict();
export const flowWait = flowNodeKey.extend({ until: z.iso.datetime() }).strict();
export const flowWake = flowNodeKey.extend({ timerId: S.suiteId, until: z.iso.datetime() }).strict();
export const flowViewRequest = z
  .object({ workspaceId: S.suiteId.optional(), cursor: z.number().int().min(0).default(0) })
  .strict();
export const flowSummary = S.suiteRecord.pick({
  domain: true,
  id: true,
  revision: true,
  name: true,
  state: true,
  kind: true,
  origin: true,
  createdAt: true,
});
export const flowView = z
  .object({
    workspaces: z.array(S.suiteWorkspace).max(50),
    domains: z
      .array(
        z
          .object({
            id: z.string(),
            records: z.array(flowSummary).max(20),
            next: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(9),
  })
  .strict();
export const flowTemplate = z
  .object({
    id: z.string(),
    name: S.suiteName,
    description: z.string().max(1000),
    graph: flowGraph,
    suggestedOnly: z.literal(true),
    needsProvider: z.enum(['integration-run', 'knowledge-publish']).nullable(),
  })
  .strict();
export type FlowDefinition = z.infer<typeof flowDefinition>;
export type FlowRun = z.infer<typeof flowRun>;
export type FlowNode = z.infer<typeof flowNode>;

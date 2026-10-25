/** 模型评测只保存文本、声明和可核对的来源，所有输入有界。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as C from './evaluation-calls.ts';
export const evaluationSample = z
  .object({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
    input: z.string().max(65536),
    label: z.string().max(1000).default(''),
    reference: z.string().max(65536).default(''),
    tags: z.array(z.string().max(80)).max(30).default([]),
  })
  .strict();
export const evaluationDataset = z
  .object({
    format: z.literal('sakura-evaluation-dataset/1'),
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    role: z.enum(['evaluation', 'tuning']),
    samples: z.array(evaluationSample).min(1).max(100),
    allowSend: z.boolean(),
    sendReason: z.string().max(1000).default('首次固定材料'),
    reviewed: z.literal(true),
    parent: S.suiteRef.nullable(),
    selectionDigest: S.suiteDigest,
  })
  .strict();
export const evaluationPin = S.suiteScope
  .extend({
    source: S.suiteRef,
    role: z.enum(['evaluation', 'tuning']).default('evaluation'),
    allowSend: z.boolean().default(false),
    reviewed: z.literal(true),
  })
  .strict();
export const evaluationSplit = S.suiteScope
  .extend({
    dataset: S.suiteRef,
    ids: z.array(evaluationSample.shape.id).min(1).max(100),
    role: z.enum(['evaluation', 'tuning']),
  })
  .strict();
export const evaluationSending = S.suiteScope
  .extend({ dataset: S.suiteRef, allowSend: z.boolean(), reason: z.string().trim().min(1).max(1000) })
  .strict();
export const evaluationPrompt = z
  .object({
    format: z.literal('sakura-evaluation-prompt/1'),
    dataset: S.suiteRef,
    template: z.string().min(1).max(8192),
    system: z.string().max(8192),
    options: C.evaluationOptions,
    variables: z.array(z.enum(['input', 'id', 'label', 'reference'])).max(4),
  })
  .strict();
export const evaluationCompile = S.suiteScope
  .extend({
    dataset: S.suiteRef,
    name: S.suiteName,
    template: z.string().min(1).max(8192),
    system: z.string().max(8192).default('仅回答提供的文本。没有工具或外部访问能力。'),
    options: C.evaluationOptions,
  })
  .strict();
export const evaluationSelect = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const evaluationSecret = z
  .object({ vmId: S.suiteId, name: z.string().min(1).max(100), version: S.suiteDigest })
  .strict();
export const evaluationEndpoint = z
  .object({
    format: z.literal('sakura-evaluation-endpoint/1'),
    target: C.evaluationTarget,
    secret: evaluationSecret.nullable(),
    connection: C.evaluationConnection.nullable(),
    revoked: z.boolean(),
  })
  .strict();
export const evaluationRegister = S.suiteScope
  .extend({
    name: S.suiteName,
    url: C.evaluationUrl,
    model: C.evaluationModel,
    secret: z
      .object({ vmId: S.suiteId, name: z.string().min(1).max(100) })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export const evaluationPreview = S.suiteScope
  .extend({
    dataset: S.suiteRef,
    prompt: S.suiteRef,
    endpoint: S.suiteRef,
    repeats: z.number().int().min(1).max(3).default(1),
  })
  .strict();
export const evaluationOutput = z
  .object({
    sampleId: evaluationSample.shape.id,
    repeat: z.number().int().min(0).max(2).default(0),
    text: z.string().max(65536),
    status: z.enum(['returned', 'unknown', 'not-sent', 'rejected']),
    callId: S.suiteId.nullable(),
    latencyMs: z.number().int().min(0).nullable(),
    usage: z
      .object({ input: z.number().int().min(0).nullable(), output: z.number().int().min(0).nullable() })
      .strict(),
    truncated: z.boolean(),
    error: z.string().max(120).nullable(),
  })
  .strict();
export const evaluationRun = z
  .object({
    format: z.literal('sakura-evaluation-run/1'),
    dataset: S.suiteRef,
    prompt: S.suiteRef,
    endpoint: S.suiteRef.nullable(),
    planId: S.suiteId.nullable(),
    planDigest: S.suiteDigest.nullable(),
    source: z.enum(['local-model', 'imported-output']),
    status: z.enum(['running', 'completed', 'cancelled', 'interrupted']),
    repeats: z.number().int().min(1).max(3),
    items: z.array(evaluationOutput).max(300),
    cancelled: z.boolean(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    limitations: z.array(z.string().max(500)).max(20),
  })
  .strict();
export const evaluationImportOutputs = S.suiteScope
  .extend({
    dataset: S.suiteRef,
    prompt: S.suiteRef,
    name: S.suiteName,
    outputs: z
      .array(z.object({ sampleId: evaluationSample.shape.id, text: z.string().max(65536) }).strict())
      .min(1)
      .max(100),
  })
  .strict();
export const evaluationRunKey = S.suiteScope.extend({ id: S.suiteId }).strict();
export const evaluationRule = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('exact'),
      trim: z.boolean().default(true),
      caseSensitive: z.boolean().default(true),
    })
    .strict(),
  z.object({ kind: z.literal('contains'), text: z.string().min(1).max(1000) }).strict(),
  z
    .object({ kind: z.literal('json-fields'), fields: z.array(z.string().min(1).max(100)).min(1).max(30) })
    .strict(),
]);
export const evaluationScoreRow = z
  .object({
    sampleId: evaluationSample.shape.id,
    repeat: z.number().int().min(0).max(2),
    value: z.number().min(0).max(1).nullable(),
    reason: z.string().max(2000),
    basis: z.enum(['rule', 'human', 'model']),
    uncertain: z.boolean(),
  })
  .strict();
export const evaluationScore = z
  .object({
    format: z.literal('sakura-evaluation-score/1'),
    run: S.suiteRef,
    dataset: S.suiteRef,
    status: z.enum(['running', 'completed', 'cancelled', 'interrupted']),
    basis: z.enum(['rule', 'human', 'model']),
    rule: evaluationRule.nullable(),
    rubric: z.string().max(4000),
    scores: z.array(evaluationScoreRow).max(300),
    judgeEndpoint: S.suiteRef.nullable(),
    judgeReceipts: z.array(C.evaluationCallReceipt).max(100),
    judgeIntents: z
      .array(z.object({ id: S.suiteId, digest: S.suiteDigest }).strict())
      .max(10)
      .default([]),
    reviewer: S.suiteId.nullable(),
    identity: z.enum(['deterministic-rule', 'single-account-human', 'model-opinion']),
    limitations: z.array(z.string().max(500)).max(20),
  })
  .strict();
export const evaluationEvaluate = S.suiteScope.extend({ run: S.suiteRef, rule: evaluationRule }).strict();
export const evaluationHuman = S.suiteScope
  .extend({
    run: S.suiteRef,
    rubric: z.string().min(1).max(4000),
    scores: z
      .array(
        z
          .object({
            sampleId: evaluationSample.shape.id,
            repeat: z.number().int().min(0).max(2).default(0),
            value: z.number().min(0).max(1),
            reason: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(300),
  })
  .strict();
export const evaluationJudge = S.suiteScope
  .extend({ run: S.suiteRef, endpoint: S.suiteRef, rubric: z.string().trim().min(1).max(4000) })
  .strict();
export const evaluationComparison = z
  .object({
    format: z.literal('sakura-evaluation-comparison/1'),
    left: S.suiteRef,
    right: S.suiteRef,
    leftScore: S.suiteRef,
    rightScore: S.suiteRef,
    common: z.array(z.string()).max(300),
    missingLeft: z.array(z.string()).max(300),
    missingRight: z.array(z.string()).max(300),
    changedSamples: z.array(z.string()).max(100),
    pairs: z
      .array(
        z
          .object({
            key: z.string(),
            left: z.number().nullable(),
            right: z.number().nullable(),
            delta: z.number().nullable(),
          })
          .strict(),
      )
      .max(300),
    comparable: z.boolean(),
    settingsEqual: z.boolean(),
    basisEqual: z.boolean(),
    roles: z.array(z.enum(['evaluation', 'tuning'])).length(2),
    limitations: z.array(z.string().max(500)).max(20),
  })
  .strict();
export const evaluationCompare = S.suiteScope
  .extend({ left: S.suiteRef, right: S.suiteRef, leftScore: S.suiteRef, rightScore: S.suiteRef })
  .strict();
export const evaluationReview = z
  .object({
    format: z.literal('sakura-evaluation-review/1'),
    comparison: S.suiteRef,
    blind: z.boolean(),
    identity: z.literal('single-account-human'),
    reviewer: S.suiteId,
    decision: z.enum(['pending', 'accepted', 'rejected']),
    reason: z.string().max(4000),
    disagreements: z.array(z.string().max(1000)).max(100),
  })
  .strict();
export const evaluationReviewOpen = S.suiteScope
  .extend({ comparison: S.suiteRef, blind: z.boolean().default(true) })
  .strict();
export const evaluationReviewDecide = S.suiteScope
  .extend({
    review: S.suiteRef,
    decision: z.enum(['accepted', 'rejected']),
    reason: z.string().trim().min(1).max(4000),
    disagreements: z.array(z.string().max(1000)).max(100).default([]),
  })
  .strict();
export const evaluationReport = z
  .object({
    format: z.literal('sakura-evaluation-report/1'),
    comparison: S.suiteRef,
    review: S.suiteRef,
    title: S.suiteName,
    summary: z.string().min(1).max(4000),
    limitations: z.array(z.string().max(1000)).min(1).max(30),
    sourceClaimsOnly: z.boolean(),
    identity: z.literal('single-account-human'),
    sealed: z.literal(true),
  })
  .strict();
export const evaluationReportSeal = S.suiteScope
  .extend({
    review: S.suiteRef,
    title: S.suiteName,
    summary: z.string().min(1).max(4000),
    limitations: z.array(z.string().max(1000)).max(20).default([]),
  })
  .strict();
export const evaluationWorkbenchRequest = z
  .object({
    workspaceId: S.suiteId.optional(),
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const evaluationSummary = S.suiteRecord.pick({
  domain: true,
  id: true,
  revision: true,
  name: true,
  state: true,
  kind: true,
  origin: true,
  createdAt: true,
});
export const evaluationWorkbenchView = z
  .object({
    workspaces: z.array(S.suiteWorkspace).max(50),
    domains: z
      .array(
        z
          .object({
            id: z.string(),
            records: z.array(evaluationSummary).max(20),
            next: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(9),
  })
  .strict();
export const evaluationTemplate = z
  .object({
    id: z.string(),
    name: S.suiteName,
    samples: z.array(evaluationSample).max(10),
    template: z.string(),
    rule: evaluationRule,
    suggestedOnly: z.literal(true),
  })
  .strict();
export type EvaluationDataset = z.infer<typeof evaluationDataset>;
export type EvaluationRun = z.infer<typeof evaluationRun>;
export type EvaluationEndpoint = z.infer<typeof evaluationEndpoint>;

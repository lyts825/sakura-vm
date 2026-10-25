/** 事件实验的有限声明与逐投递证据；外来记录不携带执行能力。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { imageRefSchema } from './image-assets.ts';
import { suiteExecutionPlan, suiteExecutionReceipt } from './suite-execution.ts';
import { eventWorkerInput, eventWorkerOutput } from './suite-execution-event.ts';
export const eventSelect = <K extends string>(field: K) =>
  S.suiteScope.extend({ [field]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const eventCompare = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict();
export const eventContract = z
  .object({
    format: z.literal('sakura-event-contract/1'),
    fields: z.record(
      z.string().regex(/^[a-z][a-zA-Z0-9_]{0,63}$/),
      z.enum(['string', 'number', 'boolean', 'null']),
    ),
    required: z.array(z.string().max(64)).max(32),
    maximumBytes: z.number().int().min(1).max(8192),
  })
  .strict()
  .superRefine((v, c) => {
    if (Object.keys(v.fields).length > 32 || v.required.some((k) => !Object.hasOwn(v.fields, k)))
      c.addIssue({ code: 'custom', message: '字段和必填规则不匹配' });
  });
export const eventContractInput = S.suiteScope
  .extend({ name: S.suiteName, definition: eventContract })
  .strict();
export const eventMessages = z
  .array(
    z
      .object({ id: z.string().min(1).max(100), key: z.string().min(1).max(100), payload: S.suiteJson })
      .strict(),
  )
  .min(1)
  .max(1000);
export const eventFixture = z
  .object({
    format: z.literal('sakura-event-fixture/1'),
    contract: S.suiteRef,
    source: S.suiteRef,
    messages: eventMessages,
    digest: S.suiteDigest,
    sourceKind: z.enum(['synthetic', 'reviewed-input']),
  })
  .strict();
export const eventGenerate = S.suiteScope
  .extend({
    contract: S.suiteRef,
    name: S.suiteName,
    count: z.number().int().min(1).max(1000),
    seed: z.string().min(1).max(64),
  })
  .strict();
export const eventImportRows = S.suiteScope
  .extend({ contract: S.suiteRef, source: S.suiteRef, reviewed: z.literal(true) })
  .strict();
export const eventUpload = S.suiteScope
  .extend({ name: S.suiteName, text: z.string().max(2 * 1024 ** 2), allowExport: z.boolean().default(false) })
  .strict();
export const eventProducer = z
  .object({
    format: z.literal('sakura-event-producer/1'),
    fixture: S.suiteRef,
    ordering: z.enum(['fifo', 'per-key']),
    messageIds: z.array(z.string()).min(1).max(1000),
    dispatch: z.literal('fixed-batch'),
  })
  .strict();
export const eventProducerInput = S.suiteScope
  .extend({
    name: S.suiteName,
    fixture: S.suiteRef,
    ordering: z.enum(['fifo', 'per-key']),
    reverse: z.boolean().default(false),
  })
  .strict();
export const eventConsumer = z
  .object({
    format: z.literal('sakura-event-consumer/1'),
    contract: S.suiteRef,
    idempotent: z.boolean(),
    delayMs: z.number().int().min(0).max(500),
    retryLimit: z.number().int().min(0).max(3),
    poisonIds: z.array(z.string().max(100)).max(1000),
    concurrency: z.literal(1),
  })
  .strict();
export const eventConsumerInput = S.suiteScope
  .extend({
    name: S.suiteName,
    contract: S.suiteRef,
    idempotent: z.boolean(),
    delayMs: z.number().int().min(0).max(500),
    retryLimit: z.number().int().min(0).max(3),
    poisonIds: z.array(z.string().max(100)).max(1000).default([]),
  })
  .strict();
export const eventScenario = z
  .object({
    format: z.literal('sakura-event-scenario/1'),
    fixture: S.suiteRef,
    producer: S.suiteRef,
    consumer: S.suiteRef,
    manifest: eventWorkerInput,
    digest: S.suiteDigest,
    maximumSeconds: z.number().int().min(1).max(900),
  })
  .strict();
export const eventScenarioInput = S.suiteScope
  .extend({
    name: S.suiteName,
    fixture: S.suiteRef,
    producer: S.suiteRef,
    consumer: S.suiteRef,
    experiment: eventWorkerInput.shape.experiment,
    maximumSeconds: z.number().int().min(1).max(900),
  })
  .strict();
export const eventBroker = z
  .object({
    format: z.literal('sakura-event-broker/1'),
    image: imageRefSchema,
    toolDigest: S.suiteDigest,
    engine: z.literal('sqlite-wal-test-broker'),
    executionCreated: z.literal(false),
  })
  .strict();
export const eventPrepare = S.suiteScope.extend({ name: S.suiteName, image: imageRefSchema }).strict();
export const eventRunPreview = S.suiteScope.extend({ broker: S.suiteRef, scenario: S.suiteRef }).strict();
export const eventSession = z
  .object({
    format: z.literal('sakura-event-session/1'),
    planId: S.suiteId,
    broker: S.suiteRef,
    scenario: S.suiteRef,
    executionPlan: suiteExecutionPlan,
    sessionId: S.suiteId,
    session: suiteExecutionReceipt.nullable(),
    result: eventWorkerOutput.nullable(),
    dispatchIntent: S.suiteDigest,
    localExecution: z.literal(true),
  })
  .strict();
export const eventRun = z
  .object({
    format: z.literal('sakura-event-run/1'),
    brokerSession: S.suiteRef,
    scenario: S.suiteRef,
    state: suiteExecutionReceipt.shape.state,
    outcome: suiteExecutionReceipt.shape.outcome,
    cleanup: suiteExecutionReceipt.shape.cleanup,
  })
  .strict();
export const eventAssessment = z
  .object({
    format: z.literal('sakura-event-assessment/1'),
    run: S.suiteRef,
    brokerSession: S.suiteRef,
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    findings: z.array(z.string().max(500)).max(100),
    produced: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    acknowledged: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
    deadLetters: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    cleanup: suiteExecutionReceipt.shape.cleanup,
    sourceTrust: z.enum(['local-original-provider', 'unauthenticated']),
    coverage: z.enum(['complete', 'incomplete']),
  })
  .strict();
export const eventReportInput = S.suiteScope
  .extend({
    run: S.suiteRef,
    assertion: S.suiteRef,
    summary: z.string().max(4000),
    unresolved: z.array(z.string().max(500)).max(50),
  })
  .strict();
export const eventReport = z
  .object({
    format: z.literal('sakura-event-report/1'),
    run: S.suiteRef,
    assertion: S.suiteRef,
    assessment: eventAssessment,
    summary: z.string().max(4000),
    unresolved: z.array(z.string().max(500)).max(50),
    sealedBy: S.suiteId,
    productionBenchmark: z.literal(false),
  })
  .strict();
export const eventViewInput = z
  .object({
    workspaceId: S.suiteId.optional(),
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
export const eventView = z
  .object({
    workspaces: z.array(S.suiteWorkspace).max(50),
    workspace: S.suiteWorkspace.nullable(),
    domains: z
      .array(
        z
          .object({
            id: z.string(),
            records: z.array(S.suiteRecord).max(50),
            next: z.number().int().nullable(),
          })
          .strict(),
      )
      .max(11),
  })
  .strict();
export const eventTemplate = z
  .object({
    id: eventWorkerInput.shape.experiment,
    name: z.string(),
    description: z.string(),
    idempotent: z.boolean(),
    retryLimit: z.number().int(),
    delayMs: z.number().int(),
  })
  .strict();
export const eventExample = z
  .object({ name: S.suiteName, template: eventWorkerInput.shape.experiment, image: imageRefSchema })
  .strict();
export const eventExampleResult = z
  .object({
    workspace: S.suiteWorkspace,
    contract: S.suiteRecord,
    fixture: S.suiteRecord,
    producer: S.suiteRecord,
    consumer: S.suiteRecord,
    scenario: S.suiteRecord,
    broker: S.suiteRecord,
  })
  .strict();
export type EventScenario = z.infer<typeof eventScenario>;

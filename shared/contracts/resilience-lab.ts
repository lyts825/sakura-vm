/** 可靠性演练领域契约；修订、观察与清理状态分别记录。
 * Resilience domain contracts keep revision, observation and cleanup independent. */
import { z } from 'zod';
import { imageRefSchema, imageAssetSchema, imageUploadSchema } from './image-assets.ts';
import {
  drillDigestSchema,
  drillIdentitySchema,
  drillParametersSchema,
  drillEvidenceSchema,
  drillSampleSchema,
  drillCapabilitySchema,
} from './drill-supervision.ts';
export const resilienceScopeSchema = z
  .object({ workspaceId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/) })
  .strict();
export type ResilienceScope = z.infer<typeof resilienceScopeSchema>;
export const resilienceRefSchema = z.object({ id: z.uuid(), revision: drillDigestSchema }).strict();
export type ResilienceRef = z.infer<typeof resilienceRefSchema>;
export const resilienceTargetInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    image: imageRefSchema,
    reviewed: z.literal(true),
    sampleCount: z.number().int().min(10).max(1000).default(20),
    memoryMiB: z.number().int().min(256).max(2048).default(1024),
    cpus: z.number().int().min(1).max(2).default(1),
    source: z.literal('local'),
  })
  .strict();
export const resilienceTargetSchema = resilienceTargetInputSchema
  .extend({
    id: z.uuid(),
    revision: drillDigestSchema,
    scope: resilienceScopeSchema,
    createdAt: z.iso.datetime(),
    sampleDigest: drillDigestSchema,
  })
  .strict();
export type ResilienceTarget = z.infer<typeof resilienceTargetSchema>;
export const resilienceReplicaSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    target: resilienceRefSchema,
    scope: resilienceScopeSchema,
    identity: drillIdentitySchema.nullable(),
    state: z.enum(['creating', 'preparing', 'ready', 'cleanup-pending', 'cleaned', 'unknown']),
    createdAt: z.iso.datetime(),
    checkpoint: imageRefSchema.nullable(),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
  })
  .strict();
export type ResilienceReplica = z.infer<typeof resilienceReplicaSchema>;
export const resilienceTemplateSchema = z
  .object({
    id: z.enum(['http-retry', 'worker-restart', 'cpu-contention', 'volume-full', 'checkpoint-restore']),
    name: z.string(),
    fault: drillParametersSchema,
    recovery: z.enum(['observe', 'restart', 'checkpoint']),
    baselineSeconds: z.literal(60),
    recoverySeconds: z.literal(60),
  })
  .strict();
export type ResilienceTemplate = z.infer<typeof resilienceTemplateSchema>;
export const resilienceTemplates: ResilienceTemplate[] = [
  {
    id: 'http-retry',
    name: 'HTTP 延迟与重试',
    fault: {
      fault: 'network',
      durationSeconds: 10,
      delayMs: 200,
      jitterMs: 20,
      lossPercent: 0,
      cpuPercent: 50,
    },
    recovery: 'observe',
    baselineSeconds: 60,
    recoverySeconds: 60,
  },
  {
    id: 'worker-restart',
    name: '工作进程重启',
    fault: { fault: 'process', durationSeconds: 10, delayMs: 0, jitterMs: 0, lossPercent: 0, cpuPercent: 50 },
    recovery: 'restart',
    baselineSeconds: 60,
    recoverySeconds: 60,
  },
  {
    id: 'cpu-contention',
    name: 'CPU 争用',
    fault: { fault: 'cpu', durationSeconds: 10, delayMs: 0, jitterMs: 0, lossPercent: 0, cpuPercent: 50 },
    recovery: 'observe',
    baselineSeconds: 60,
    recoverySeconds: 60,
  },
  {
    id: 'volume-full',
    name: '数据卷写满',
    fault: { fault: 'volume', durationSeconds: 10, delayMs: 0, jitterMs: 0, lossPercent: 0, cpuPercent: 50 },
    recovery: 'observe',
    baselineSeconds: 60,
    recoverySeconds: 60,
  },
  {
    id: 'checkpoint-restore',
    name: '检查点恢复',
    fault: {
      fault: 'checkpoint',
      durationSeconds: 10,
      delayMs: 0,
      jitterMs: 0,
      lossPercent: 0,
      cpuPercent: 50,
    },
    recovery: 'checkpoint',
    baselineSeconds: 60,
    recoverySeconds: 60,
  },
];
export const resilienceScenarioInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    target: resilienceRefSchema,
    template: resilienceTemplateSchema.shape.id,
    parameters: drillParametersSchema,
    maxErrors: z.number().int().min(0).max(100),
    minimumSamples: z.number().int().min(10).max(600),
    maxP95Ms: z.number().positive().max(3000),
  })
  .strict();
export const resilienceScenarioSchema = resilienceScenarioInputSchema
  .extend({
    id: z.uuid(),
    revision: drillDigestSchema,
    scope: resilienceScopeSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ResilienceScenario = z.infer<typeof resilienceScenarioSchema>;
export const resiliencePlanSchema = z
  .object({
    id: z.uuid(),
    digest: drillDigestSchema,
    scope: resilienceScopeSchema,
    scenario: resilienceScenarioSchema,
    target: resilienceTargetSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    state: z.enum(['previewed', 'approved', 'consumed', 'stale', 'expired', 'revoked']),
    gaps: z.array(z.string()),
    budget: z
      .object({
        replicas: z.literal(2),
        memoryMiB: z.number().int(),
        cpus: z.number().int(),
        diskGiB: z.literal(64),
        runSeconds: z.literal(1200),
      })
      .strict(),
  })
  .strict();
export type ResiliencePlan = z.infer<typeof resiliencePlanSchema>;
export const resilienceSegmentSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    scope: resilienceScopeSchema,
    phase: z.enum(['baseline', 'fault', 'recovery']),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    durationMs: z.number().nonnegative(),
    samples: z.array(drillSampleSchema).max(20000),
    count: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    p95Ms: z.number().nonnegative().nullable(),
    algorithm: z.literal('nearest-rank-v1'),
    passed: z.boolean(),
    missing: z.array(z.string()),
  })
  .strict();
export type ResilienceSegment = z.infer<typeof resilienceSegmentSchema>;
export const resilienceRunSchema = z
  .object({
    id: z.uuid(),
    scope: resilienceScopeSchema,
    plan: resiliencePlanSchema,
    state: z.enum([
      'queued',
      'preparing',
      'baselining',
      'armed',
      'injecting',
      'observing',
      'recovering',
      'verifying',
      'containing',
      'cleaning',
      'completed',
      'reconcile-required',
    ]),
    outcome: z.enum(['passed', 'failed', 'cancelled', 'inconclusive']),
    containment: z.enum(['confirmed', 'pending', 'unknown']),
    cleanup: z.enum(['confirmed', 'pending', 'unknown']),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    replicas: z.array(z.uuid()).max(2),
    segments: z.array(z.uuid()).max(8),
    evidence: z.array(drillEvidenceSchema).max(32),
    intents: z
      .array(
        z
          .object({
            id: z.uuid(),
            step: z.string().max(50),
            at: z.iso.datetime(),
            status: z.enum(['pending', 'confirmed', 'unknown']),
          })
          .strict(),
      )
      .max(32),
    error: z.string().max(4096),
    jobId: z.string().nullable(),
    cancelled: z.boolean(),
  })
  .strict();
export type ResilienceRun = z.infer<typeof resilienceRunSchema>;
export const resilienceReportSchema = z
  .object({
    id: z.uuid(),
    scope: resilienceScopeSchema,
    run: resilienceRunSchema,
    segments: z.array(resilienceSegmentSchema).max(8),
    createdAt: z.iso.datetime(),
    classification: z.enum(['passed', 'failed', 'incomplete']),
    sourceTrust: z.enum(['local', 'unauthenticated']),
    digest: drillDigestSchema,
    pinned: z.boolean(),
    external: z.boolean(),
  })
  .strict();
export type ResilienceReport = z.infer<typeof resilienceReportSchema>;
export const resilienceBundleSchema = z
  .object({
    format: z.literal('sakura-resilience-1'),
    sourceTrust: z.literal('unauthenticated'),
    entries: z
      .array(
        z
          .object({
            path: z.string().min(1).max(256),
            bytes: z
              .number()
              .int()
              .nonnegative()
              .max(256 * 1024 * 1024),
            digest: drillDigestSchema,
            contentType: z.literal('application/json'),
            purpose: z.enum(['report', 'scenario', 'samples']),
            data: z.string().max(280 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();
export type ResilienceBundle = z.infer<typeof resilienceBundleSchema>;
export const resilienceImportSchema = z
  .object({
    id: z.uuid(),
    scope: resilienceScopeSchema,
    digest: drillDigestSchema,
    createdAt: z.iso.datetime(),
    integrity: z.enum(['valid', 'invalid']),
    sourceTrust: z.literal('unauthenticated'),
    state: z.enum(['quarantined', 'accepted']),
    findings: z.array(z.string()),
    report: resilienceReportSchema,
    acceptedId: z.uuid().nullable(),
  })
  .strict();
export type ResilienceImport = z.infer<typeof resilienceImportSchema>;
export const resilienceCleanupSchema = z
  .object({
    id: z.uuid(),
    scope: resilienceScopeSchema,
    replicaId: z.uuid(),
    digest: drillDigestSchema,
    expiresAt: z.iso.datetime(),
    resources: z.array(z.string()),
  })
  .strict();
export type ResilienceCleanup = z.infer<typeof resilienceCleanupSchema>;
const scope = resilienceScopeSchema,
  id = z.object({ scope, id: z.uuid() }).strict(),
  ref = z.object({ scope, ref: resilienceRefSchema }).strict();
const okay = z.object({ confirmed: z.literal(true) }).strict();
export const resilienceImageImportSchema = z
  .object({
    digest: drillDigestSchema,
    bytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 ** 3),
    distro: imageAssetSchema.shape.distro,
    architecture: imageAssetSchema.shape.architecture,
    source: z.string().min(1).max(200),
  })
  .strict();
export const resilienceRequests = {
  targets: {
    view: z.object({ scope }).strict(),
    register: z.object({ scope, input: resilienceTargetInputSchema }).strict(),
    get: ref,
  },
  fixtures: {
    view: z.object({ scope }).strict(),
    sources: z.object({ scope }).strict(),
    prepareBuiltin: z
      .object({
        scope,
        distro: imageAssetSchema.shape.distro,
        architecture: imageAssetSchema.shape.architecture,
      })
      .strict(),
    beginImport: z.object({ scope, input: resilienceImageImportSchema }).strict(),
    appendImport: z
      .object({
        scope,
        id: z.uuid(),
        offset: z.number().int().nonnegative(),
        data: z.string().max(2 * 1024 * 1024),
      })
      .strict(),
    finishImport: id,
    prepare: z.object({ scope, target: resilienceRefSchema, runId: z.uuid() }).strict(),
    cleanupPreview: id,
    cleanup: z.object({ scope, plan: resilienceCleanupSchema }).strict(),
  },
  guard: {
    view: z.object({ scope }).strict(),
    contain: z.object({ scope, runId: z.uuid() }).strict(),
    reconcile: z.object({ scope, runId: z.uuid() }).strict(),
  },
  faults: { catalogue: z.object({ scope }).strict(), observe: z.object({ scope, runId: z.uuid() }).strict() },
  probes: { view: z.object({ scope, runId: z.uuid() }).strict() },
  recovery: {
    preview: z
      .object({ scope, runId: z.uuid(), strategy: z.enum(['observe', 'restart', 'checkpoint']) })
      .strict(),
    apply: z.object({ scope, id: z.uuid(), digest: drillDigestSchema }).strict(),
  },
  scenarios: {
    view: z.object({ scope }).strict(),
    templates: z.object({ scope }).strict(),
    save: z.object({ scope, input: resilienceScenarioInputSchema }).strict(),
  },
  runs: {
    view: z.object({ scope }).strict(),
    get: id,
    preview: z.object({ scope, scenario: resilienceRefSchema }).strict(),
    approve: z.object({ scope, id: z.uuid(), digest: drillDigestSchema }).strict(),
    start: id,
    cancel: id,
    reconcile: id,
  },
  reports: {
    view: z.object({ scope }).strict(),
    imports: z.object({ scope }).strict(),
    discardImport: id,
    retention: z.object({ scope }).strict(),
    pin: z.object({ scope, id: z.uuid(), pinned: z.boolean() }).strict(),
    archive: id,
    seal: z.object({ scope, runId: z.uuid() }).strict(),
    export: id,
    import: z.object({ scope, bundle: resilienceBundleSchema }).strict(),
    accept: id,
    compare: z.object({ scope, left: z.uuid(), right: z.uuid() }).strict(),
  },
  workbench: { view: z.object({ scope }).strict() },
} as const;
export const resilienceRecoveryPlanSchema = z
  .object({
    id: z.uuid(),
    scope,
    runId: z.uuid(),
    strategy: z.enum(['observe', 'restart', 'checkpoint']),
    digest: drillDigestSchema,
    expiresAt: z.iso.datetime(),
    consumed: z.boolean(),
  })
  .strict();
export type ResilienceRecoveryPlan = z.infer<typeof resilienceRecoveryPlanSchema>;
export const resilienceResponses = {
  targets: {
    view: z.array(resilienceTargetSchema),
    register: resilienceTargetSchema,
    get: resilienceTargetSchema,
  },
  fixtures: {
    view: z.array(resilienceReplicaSchema),
    sources: z.array(imageAssetSchema),
    prepareBuiltin: imageAssetSchema,
    beginImport: imageUploadSchema,
    appendImport: imageUploadSchema,
    finishImport: imageAssetSchema,
    prepare: resilienceReplicaSchema,
    cleanupPreview: resilienceCleanupSchema,
    cleanup: resilienceReplicaSchema,
  },
  guard: { view: drillCapabilitySchema, contain: drillEvidenceSchema, reconcile: drillEvidenceSchema },
  faults: { catalogue: z.array(resilienceTemplateSchema), observe: drillEvidenceSchema },
  probes: { view: z.array(resilienceSegmentSchema) },
  recovery: { preview: resilienceRecoveryPlanSchema, apply: drillEvidenceSchema },
  scenarios: {
    view: z.array(resilienceScenarioSchema),
    templates: z.array(resilienceTemplateSchema),
    save: resilienceScenarioSchema,
  },
  runs: {
    view: z.array(resilienceRunSchema),
    get: resilienceRunSchema,
    preview: resiliencePlanSchema,
    approve: resiliencePlanSchema,
    start: resilienceRunSchema,
    cancel: resilienceRunSchema,
    reconcile: resilienceRunSchema,
  },
  reports: {
    view: z.array(resilienceReportSchema),
    imports: z.array(resilienceImportSchema.omit({ report: true })),
    discardImport: z.object({ id: z.uuid(), discarded: z.literal(true) }).strict(),
    retention: z.array(
      z
        .object({ id: z.uuid(), pinned: z.boolean(), expiresAt: z.iso.datetime(), archiving: z.boolean() })
        .strict(),
    ),
    pin: z.object({ id: z.uuid(), pinned: z.boolean() }).strict(),
    archive: z.object({ id: z.uuid(), archived: z.literal(true) }).strict(),
    seal: resilienceReportSchema,
    export: resilienceBundleSchema,
    import: resilienceImportSchema,
    accept: resilienceImportSchema,
    compare: z
      .object({
        compatible: z.boolean(),
        differences: z.array(z.string()),
        left: resilienceReportSchema,
        right: resilienceReportSchema,
      })
      .strict(),
  },
  workbench: {
    view: z
      .object({
        templates: z.array(resilienceTemplateSchema),
        capabilities: drillCapabilitySchema,
        targets: z.array(resilienceTargetSchema),
        replicas: z.array(resilienceReplicaSchema),
        runs: z.array(resilienceRunSchema),
        reports: z.array(resilienceReportSchema),
      })
      .strict(),
  },
} as const;

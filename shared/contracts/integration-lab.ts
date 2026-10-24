/** 模块职责：集成实验的严格输入、固定修订和证据 DTO。 Strict integration definitions and evidence DTOs. */
import { z } from 'zod';
import { imageRefSchema, ownedImageVmSchema } from './image-assets.ts';
export const ilId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/);
export const ilDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const ilName = z.string().min(1).max(200);
export const ilScope = z.object({ workspaceId: z.uuid() }).strict();
export type IntegrationScope = z.infer<typeof ilScope>;
export const ilRef = z.object({ id: z.uuid(), revision: ilDigest }).strict();
export type IntegrationRef = z.infer<typeof ilRef>;
export type IntegrationJson =
  null | boolean | number | string | IntegrationJson[] | { [key: string]: IntegrationJson };
export const ilJson: z.ZodType<IntegrationJson> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string().max(65536),
    z.array(ilJson).max(10000),
    z.record(z.string().max(200), ilJson),
  ]),
);
export type HttpShape = {
  type?: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'number' | 'null';
  ref?: string;
  properties?: Record<string, HttpShape>;
  required?: string[];
  additionalProperties?: boolean;
  items?: HttpShape;
  enum?: IntegrationJson[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
};
export const httpShapeSchema: z.ZodType<HttpShape> = z.lazy(() =>
  z
    .object({
      type: z.enum(['object', 'array', 'string', 'boolean', 'integer', 'number', 'null']).optional(),
      ref: ilId.optional(),
      properties: z.record(ilId, httpShapeSchema).optional(),
      required: z.array(ilId).max(500).optional(),
      additionalProperties: z.boolean().optional(),
      items: httpShapeSchema.optional(),
      enum: z.array(ilJson).min(1).max(1000).optional(),
      minimum: z.number().finite().optional(),
      maximum: z.number().finite().optional(),
      minLength: z.number().int().min(0).max(65536).optional(),
      maxLength: z.number().int().min(0).max(65536).optional(),
      minItems: z.number().int().min(0).max(10000).optional(),
      maxItems: z.number().int().min(0).max(10000).optional(),
    })
    .strict()
    .refine((v) => !!v.type !== !!v.ref, 'Exactly one of type/ref is required'),
);
export const httpMethod = z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const parameter = z.object({ name: ilId, required: z.boolean(), schema: httpShapeSchema }).strict();
export const httpOperationSchema = z
  .object({
    operationId: ilId,
    method: httpMethod,
    path: z
      .string()
      .regex(/^\/(?!\/)[^?#\x00-\x20]*$/)
      .max(2048),
    pathParameters: z.array(parameter).max(32),
    queryParameters: z.array(parameter).max(64),
    request: httpShapeSchema.nullable(),
    responses: z
      .array(
        z
          .object({
            status: z.number().int().min(100).max(599),
            mediaType: z.enum(['application/json', 'text/plain', 'none']),
            schema: httpShapeSchema.nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    effect: z.enum(['read', 'write', 'unknown']),
  })
  .strict();
export const httpContractSchema = z
  .object({
    format: z.literal('sakura-http-contract/1'),
    title: ilName,
    schemas: z.record(ilId, httpShapeSchema),
    operations: z.array(httpOperationSchema).min(1).max(500),
  })
  .strict();
export type HttpContract = z.infer<typeof httpContractSchema>;
export const environmentSchema = z
  .object({
    name: ilName,
    application: z
      .object({ appId: z.uuid(), revision: z.number().int().positive(), identityDigest: ilDigest })
      .strict()
      .optional(),
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('mock') }).strict(),
      z
        .object({
          kind: z.literal('private'),
          address: z.ipv4(),
          port: z.number().int().min(1).max(65535),
          protocol: z.enum(['http', 'https']),
          tlsName: z.string().min(1).max(253).optional(),
          testUseConfirmed: z.literal(true),
        })
        .strict(),
      z.object({ kind: z.literal('unbound'), slot: ilId }).strict(),
    ]),
    credentials: z
      .array(
        z
          .object({
            header: z.string().regex(/^[A-Za-z][A-Za-z0-9-]{0,63}$/),
            slot: ilId,
            sourceVmId: z.uuid().optional(),
            name: ilId.optional(),
            version: ilName.optional(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export type IntegrationEnvironment = z.infer<typeof environmentSchema>;
export const fixtureSchema = z
  .object({
    name: ilName,
    columns: z.array(ilId).min(1).max(100),
    rows: z.array(z.record(ilId, ilJson)).max(10000),
    seed: z.number().int().nonnegative().optional(),
    redactedFields: z.array(ilId).max(100),
  })
  .strict();
export type IntegrationFixture = z.infer<typeof fixtureSchema>;
export const mockSchema = z
  .object({
    name: ilName,
    contract: ilRef,
    fixtures: z.array(ilRef).max(20),
    states: z.array(ilId).min(1).max(8),
    initialState: ilId,
    seed: z.number().int().nonnegative(),
    rules: z
      .array(
        z
          .object({
            id: ilId,
            operationId: ilId,
            state: ilId.optional(),
            nextState: ilId.optional(),
            status: z.number().int().min(100).max(599),
            headers: z.record(z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), z.string().max(4096)),
            body: ilJson,
            fixture: z
              .object({ index: z.number().int().nonnegative(), row: z.number().int().nonnegative() })
              .strict()
              .optional(),
            fault: z
              .object({
                delayMs: z.number().int().min(0).max(15000),
                disconnect: z.boolean(),
                truncateBytes: z
                  .number()
                  .int()
                  .nonnegative()
                  .max(2 * 1024 ** 2)
                  .optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export type IntegrationMock = z.infer<typeof mockSchema>;
export const pointerSchema = z
  .string()
  .max(1024)
  .refine((v) => v === '' || /^\/(?:[^~]|~[01])*$/.test(v), 'Invalid JSON Pointer');
const bindingSchema = z
  .object({
    from: ilId,
    pointer: pointerSchema,
    to: z.enum(['path', 'query', 'body']),
    field: ilId,
    shape: httpShapeSchema,
  })
  .strict();
export const scenarioSchema = z
  .object({
    name: ilName,
    contract: ilRef,
    environment: ilRef,
    fixtures: z.array(ilRef).max(20),
    nodes: z
      .array(
        z
          .object({
            id: ilId,
            operationId: ilId,
            after: z.array(ilId).max(100),
            condition: z
              .object({ node: ilId, status: z.number().int().min(100).max(599) })
              .strict()
              .optional(),
            path: z.record(ilId, ilJson),
            query: z.record(ilId, ilJson),
            body: ilJson,
            fixture: z
              .object({ index: z.number().int().nonnegative(), row: z.number().int().nonnegative() })
              .strict()
              .optional(),
            bindings: z.array(bindingSchema).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type IntegrationScenario = z.infer<typeof scenarioSchema>;
export const assertionRuleSchema = z.discriminatedUnion('kind', [
  z
    .object({ id: ilId, node: ilId, kind: z.literal('status'), equals: z.number().int().min(100).max(599) })
    .strict(),
  z
    .object({
      id: ilId,
      node: ilId,
      kind: z.literal('header'),
      name: z.string().regex(/^[a-z0-9-]{1,64}$/),
      equals: z.string().max(4096),
    })
    .strict(),
  z
    .object({ id: ilId, node: ilId, kind: z.literal('value'), pointer: pointerSchema, equals: ilJson })
    .strict(),
  z
    .object({
      id: ilId,
      node: ilId,
      kind: z.literal('shape'),
      pointer: pointerSchema,
      shape: httpShapeSchema,
    })
    .strict(),
  z
    .object({ id: ilId, node: ilId, kind: z.literal('member'), pointer: pointerSchema, value: ilJson })
    .strict(),
  z
    .object({
      id: ilId,
      node: ilId,
      kind: z.literal('relation'),
      pointer: pointerSchema,
      otherNode: ilId,
      otherPointer: pointerSchema,
      relation: z.enum(['eq', 'ne', 'lt', 'le', 'gt', 'ge']),
    })
    .strict(),
  z
    .object({ id: ilId, node: ilId, kind: z.literal('duration'), maxMs: z.number().int().min(1).max(15000) })
    .strict(),
]);
export const assertionSchema = z
  .object({ name: ilName, scenario: ilRef, rules: z.array(assertionRuleSchema).min(1).max(1000) })
  .strict();
export type IntegrationAssertion = z.infer<typeof assertionSchema>;
export const revisionBase = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    revision: ilDigest,
    parent: ilDigest.nullable(),
    createdAt: z.iso.datetime(),
    createdBy: ilName,
    state: z.enum(['draft', 'sealed', 'archived']),
    sequence: z.number().int().min(1).max(100),
  })
  .strict();
export function revisionSchema<T extends z.ZodType>(content: T) {
  return revisionBase.extend({ content });
}
export type IntegrationRevision<T> = z.infer<typeof revisionBase> & { content: T };
export const saveBase = z.object({ id: z.uuid().optional(), expectedRevision: ilDigest.optional() }).strict();
export type IntegrationSave<T> = z.infer<typeof saveBase> & { content: T };
export const workspaceSchema = z
  .object({
    id: z.uuid(),
    name: ilName,
    owner: ilName,
    revision: ilDigest,
    state: z.enum(['active', 'importing', 'archived']),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type IntegrationWorkspace = z.infer<typeof workspaceSchema>;
export const capacitySchema = z
  .object({
    token: z.uuid(),
    workspaceId: z.uuid(),
    consumer: ilName,
    objects: z.number().int().nonnegative(),
    revisions: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    metadataBytes: z.number().int().nonnegative(),
    controlBytes: z.number().int().nonnegative(),
    state: z.enum(['reserved', 'committed', 'released']),
  })
  .strict();
export type IntegrationCapacity = z.infer<typeof capacitySchema>;
export const comparisonSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    before: ilRef,
    after: ilRef,
    direction: z.literal('old-client-new-service'),
    rulesVersion: z.literal(1),
    items: z.array(
      z
        .object({
          operationId: ilId,
          verdict: z.enum(['compatible', 'breaking', 'undetermined']),
          reasons: z.array(z.string().max(1000)),
        })
        .strict(),
    ),
  })
  .strict();
export type IntegrationComparison = z.infer<typeof comparisonSchema>;
export const requestEvidenceSchema = z
  .object({
    node: ilId,
    sequence: z.number().int().nonnegative(),
    requestDigest: ilDigest,
    bodyDigest: ilDigest,
    state: z.enum(['intent-durable', 'permitted', 'response-recorded', 'effect-unknown', 'not-sent']),
    status: z.number().int().min(100).max(599).nullable(),
    headers: z.record(z.string().max(64), z.string().max(4096)),
    bytes: z.number().int().nonnegative(),
    responseDigest: ilDigest.nullable(),
    durationMs: z.number().nonnegative(),
    complete: z.boolean(),
    error: ilId.nullable(),
    dispatchedAt: z.iso.datetime().nullable(),
    selected: z.record(pointerSchema, ilJson),
    body: ilJson.optional(),
  })
  .strict();
export type IntegrationEvidence = z.infer<typeof requestEvidenceSchema>;
export const assertionResultSchema = z
  .object({
    id: ilId,
    node: ilId,
    outcome: z.enum(['satisfied', 'violated', 'unevaluated']),
    reason: ilId,
    evidence: z
      .object({
        sequence: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const evaluationSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    runId: z.uuid(),
    assertion: ilRef,
    evidenceDigest: ilDigest,
    results: z.array(assertionResultSchema).max(1000),
  })
  .strict();
export type IntegrationEvaluation = z.infer<typeof evaluationSchema>;
export const runPreviewSchema = z
  .object({
    scenario: ilRef,
    mock: ilRef.nullable(),
    assertions: ilRef,
    image: imageRefSchema,
    mode: z.enum(['functional', 'load', 'mock-only']),
    requests: z.number().int().min(1).max(6000),
    rate: z.number().min(0.1).max(100),
    durationSeconds: z.number().int().min(1).max(1800),
    retainFields: z.array(pointerSchema).max(100),
  })
  .strict();
export type IntegrationRunInput = z.infer<typeof runPreviewSchema>;
export const runPlanSchema = runPreviewSchema
  .extend({
    id: z.uuid(),
    workspaceId: z.uuid(),
    digest: ilDigest,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    deadline: z.iso.datetime(),
    state: z.enum(['validated', 'consumed', 'invalidated']),
    runId: z.uuid().nullable(),
    writes: z.array(ilId),
    snapshotDigest: ilDigest,
    toolDigest: ilDigest,
    credentialVersions: z.record(ilId, ilName),
    targetDigest: ilDigest,
    capacity: capacitySchema,
    recordCapacity: capacitySchema,
  })
  .strict();
export type IntegrationRunPlan = z.infer<typeof runPlanSchema>;
export const runSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    plan: runPlanSchema,
    state: z.enum([
      'queued',
      'preparing',
      'running',
      'evaluating',
      'cleanup',
      'completed',
      'cancelling',
      'interrupted',
      'effect-unknown',
      'cleanup-pending',
    ]),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().nullable(),
    jobKey: ilName,
    vm: ownedImageVmSchema.nullable(),
    vmStartedAt: z.string().nullable().default(null),
    workerId: z.uuid().nullable(),
    egressId: z.uuid().nullable(),
    requests: z.array(requestEvidenceSchema.omit({ body: true })).max(6000),
    evaluation: evaluationSchema.nullable(),
    cleanupConfirmed: z.boolean(),
    error: ilId.nullable(),
    verification: z
      .array(
        z
          .object({
            at: z.iso.datetime(),
            actor: ilName,
            evidenceDigest: ilDigest,
            conclusion: z.enum(['confirmed-applied', 'confirmed-not-applied', 'unresolved']),
          })
          .strict(),
      )
      .max(100),
    snapshot: z
      .object({
        contract: httpContractSchema,
        environment: environmentSchema,
        fixtures: z.array(fixtureSchema),
        mock: mockSchema.nullable(),
        scenario: scenarioSchema,
        assertions: assertionSchema,
      })
      .strict(),
    load: z
      .object({
        planned: z.number().int(),
        initiated: z.number().int(),
        completed: z.number().int(),
        errors: z.number().int(),
        cancelled: z.number().int(),
        uninitiated: z.number().int(),
        unknown: z.number().int().nonnegative().default(0),
        countsComplete: z.boolean().default(true),
        intervalsMs: z.array(z.number()).max(6000),
        latencyMs: z
          .object({
            samples: z.number().int().nonnegative(),
            p50: z.number().nonnegative().nullable(),
            p95: z.number().nonnegative().nullable(),
            p99: z.number().nonnegative().nullable(),
          })
          .strict(),
        timeouts: z.number().int().nonnegative(),
        scheduleMisses: z.number().int().nonnegative(),
        inconclusive: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type IntegrationRun = z.infer<typeof runSchema>;
export const reportSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    retainUntil: z.iso.datetime(),
    digest: ilDigest,
    verdict: z.enum(['passed', 'failed', 'inconclusive']),
    evidenceCoverage: z.enum(['record-only', 'selected-fields', 'recomputable']),
    cannotRecompute: z.array(ilId),
    origin: z.enum(['local', 'imported']),
    run: runSchema,
  })
  .strict();
export type IntegrationReport = z.infer<typeof reportSchema>;
export const loadProfileSchema = z
  .object({ name: ilName, run: runPreviewSchema.refine((v) => v.mode === 'load', 'Load mode required') })
  .strict();
export type IntegrationLoadProfile = z.infer<typeof loadProfileSchema>;

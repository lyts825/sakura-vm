/** 审核工具清单和原会话证明；没有任意命令字段。 Fixed worker protocol and identity receipts. */
import { z } from 'zod';
import { ownedImageVmSchema } from './image-assets.ts';
import {
  ilDigest,
  ilId,
  httpContractSchema,
  scenarioSchema,
  mockSchema,
  environmentSchema,
  fixtureSchema,
  requestEvidenceSchema,
  ilJson,
} from './integration-lab.ts';
export const workerManifestSchema = z
  .object({
    version: z.literal(1),
    sessionId: z.uuid(),
    runId: z.uuid(),
    toolId: z.literal('integration-http-v1'),
    mode: z.enum(['functional', 'load', 'mock-only']),
    deadline: z.iso.datetime(),
    maxRequests: z.number().int().min(1).max(6000),
    rate: z.number().min(0.1).max(100),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(64 * 1024 ** 2),
    maxConcurrent: z.literal(1),
    contract: httpContractSchema,
    scenario: scenarioSchema,
    mock: mockSchema.nullable(),
    fixtures: z.array(fixtureSchema).max(20),
    environment: environmentSchema,
    credentialVersions: z.record(ilId, z.string()),
    retainFields: z.array(z.string()).max(100),
  })
  .strict();
export type IntegrationWorkerManifest = z.infer<typeof workerManifestSchema>;
export const workerPlanInputSchema = z
  .object({
    ownedVmReceipt: ownedImageVmSchema,
    projectId: z.literal('default'),
    configRevision: ilDigest,
    toolId: z.literal('integration-http-v1'),
    toolDigest: ilDigest,
    manifest: workerManifestSchema,
    inputManifestDigest: ilDigest,
    destinationGrantDigest: ilDigest,
  })
  .strict();
export const workerPlanSchema = workerPlanInputSchema
  .extend({
    id: z.uuid(),
    digest: ilDigest,
    consumer: z.string(),
    generation: z.string(),
    createdAt: z.iso.datetime(),
    state: z.enum(['prepared', 'started', 'closed']),
    bootId: z.uuid(),
  })
  .strict();
export type PreparedWorkerPlan = z.infer<typeof workerPlanSchema>;
export const workerReceiptSchema = z
  .object({
    id: z.uuid(),
    planId: z.uuid(),
    vm: ownedImageVmSchema,
    bootId: z.uuid(),
    pid: z.number().int().positive().nullable(),
    startTicks: z.string().nullable(),
    state: z.enum(['starting', 'running', 'stopping', 'closed', 'unknown']),
    cleanupConfirmed: z.boolean(),
    error: ilId.nullable(),
    dispatched: z.number().int().min(0).max(6000),
    completed: z.number().int().min(0).max(6000),
  })
  .strict();
export type PreparedWorkerReceipt = z.infer<typeof workerReceiptSchema>;
export const workerRequestSchema = z
  .object({
    node: ilId,
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']),
    path: z.string().startsWith('/').max(8192),
    body: ilJson,
    bodyDigest: ilDigest,
    effect: z.enum(['read', 'write', 'unknown']),
  })
  .strict();
export const workerChallengeSchema = z
  .object({
    type: z.enum(['permit', 'batch', 'heartbeat']),
    sessionId: z.uuid(),
    challenge: z.uuid(),
    sequence: z.number().int().nonnegative().max(6000),
    digest: ilDigest,
    requests: z.array(workerRequestSchema).max(6000),
  })
  .strict();
export type IntegrationWorkerChallenge = z.infer<typeof workerChallengeSchema>;
export const workerEventSchema = z.discriminatedUnion('type', [
  workerChallengeSchema.extend({ type: z.literal('permit') }),
  workerChallengeSchema.extend({ type: z.literal('batch') }),
  workerChallengeSchema.extend({ type: z.literal('heartbeat') }),
  z
    .object({
      type: z.literal('ready'),
      sessionId: z.uuid(),
      bootId: z.uuid(),
      pid: z.number().int().positive(),
      startTicks: z.string().regex(/^\d+$/),
      port: z.number().int().min(0).max(65535),
    })
    .strict(),
  z.object({ type: z.literal('result'), sessionId: z.uuid(), evidence: requestEvidenceSchema }).strict(),
  z
    .object({
      type: z.literal('finished'),
      sessionId: z.uuid(),
      dispatched: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      intervalsMs: z.array(z.number().nonnegative()).max(6000),
      error: ilId.nullable(),
      listenerClosed: z.boolean(),
    })
    .strict(),
]);
export type IntegrationWorkerEvent = z.infer<typeof workerEventSchema>;

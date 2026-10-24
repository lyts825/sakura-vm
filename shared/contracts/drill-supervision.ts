/** 固定监管输入和不透明权能；所有结构拒绝额外字段。
 * Fixed supervision inputs and opaque capabilities; every structure rejects unknown fields. */
import { z } from 'zod';
import { ownedImageVmSchema } from './image-assets.ts';
export const drillIdSchema = z.uuid();
export const drillDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const drillFaultSchema = z.enum(['network', 'process', 'cpu', 'volume', 'checkpoint']);
export const drillConsumerSchema = z.enum([
  'resilience-guard',
  'resilience-faults',
  'resilience-probes',
  'resilience-recovery',
]);
export const drillIdentitySchema = z
  .object({
    vmId: z.uuid(),
    createdAt: z.iso.datetime(),
    diskIdentity: z.string().min(1).max(256),
    processId: z.number().int().positive(),
    processCreated: z.string().regex(/^\d{15,22}$/),
    bootId: z.uuid(),
    projectId: z.string().min(1).max(100),
    projectRevision: drillDigestSchema,
    controllerGeneration: z.uuid(),
  })
  .strict();
export type DrillIdentity = z.infer<typeof drillIdentitySchema>;
export const drillStepSchema = z
  .object({
    id: z.number().int().min(0).max(7),
    consumer: drillConsumerSchema,
    action: z.enum(['inject', 'baseline', 'observe', 'verify', 'restart', 'checkpoint']),
  })
  .strict();
export const drillParametersSchema = z
  .object({
    fault: drillFaultSchema,
    durationSeconds: z.number().int().min(1).max(120),
    delayMs: z.number().int().min(0).max(500),
    jitterMs: z.number().int().min(0).max(100),
    lossPercent: z.number().min(0).max(10),
    cpuPercent: z.number().int().min(1).max(50),
  })
  .strict()
  .refine((x) => x.jitterMs <= x.delayMs, '抖动不得超过延迟');
export type DrillParameters = z.infer<typeof drillParametersSchema>;
export const drillDelegationSchema = z
  .object({
    runId: z.uuid(),
    planDigest: drillDigestSchema,
    replica: ownedImageVmSchema,
    identity: drillIdentitySchema,
    parameters: drillParametersSchema,
    steps: z.array(drillStepSchema).min(3).max(8),
    faultDeadline: z.iso.datetime(),
    runDeadline: z.iso.datetime(),
  })
  .strict();
export type DrillDelegation = z.infer<typeof drillDelegationSchema>;
export const drillTokenSchema = z.object({ id: z.uuid(), secret: drillDigestSchema }).strict();
export type DrillToken = z.infer<typeof drillTokenSchema>;
export const drillEvidenceSchema = z
  .object({
    id: z.uuid(),
    runId: z.uuid(),
    identity: drillIdentitySchema,
    at: z.iso.datetime(),
    effect: z.enum(['observed', 'absent', 'unknown']),
    containment: z.enum(['confirmed', 'pending', 'unknown']),
    deadlineBreach: z.boolean(),
    detail: z.string().max(4096),
  })
  .strict();
export type DrillEvidence = z.infer<typeof drillEvidenceSchema>;
export const drillSampleSchema = z
  .object({
    requestId: z.string().regex(/^[a-z0-9-]{1,100}$/),
    at: z.iso.datetime(),
    elapsedMs: z.number().nonnegative(),
    ok: z.boolean(),
    valueDigest: drillDigestSchema.nullable(),
    error: z.string().max(256),
  })
  .strict();
export type DrillSample = z.infer<typeof drillSampleSchema>;
export const drillCapabilitySchema = z
  .object({
    available: z.boolean(),
    platform: z.string(),
    hostVerified: z.boolean(),
    guestVerified: z.boolean(),
    gaps: z.array(z.string().max(500)),
    catalogueVersion: z.literal('1.0.0'),
  })
  .strict();
export type DrillCapability = z.infer<typeof drillCapabilitySchema>;
export const drillPreparationSchema = z
  .object({
    runId: z.uuid(),
    replica: ownedImageVmSchema,
    sampleDigest: drillDigestSchema,
    count: z.number().int().min(10).max(1000),
    projectRevision: drillDigestSchema,
    restoreFrom: z
      .object({
        runId: z.uuid(),
        confirmedIds: z
          .array(z.string().regex(/^[a-z0-9-]{1,100}$/))
          .min(1)
          .max(20000),
      })
      .strict()
      .optional(),
  })
  .strict();
export type DrillPreparation = z.infer<typeof drillPreparationSchema>;

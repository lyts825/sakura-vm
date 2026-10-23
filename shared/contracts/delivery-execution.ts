/** 交付执行与预览证据；执行结论与资源回收分别记录。 */
import { z } from 'zod';
import {
  deliveryScopeSchema,
  deliveryDigestSchema,
  deliveryEnvironmentSchema,
  deliveryCandidateSchema,
} from './delivery-common.ts';
export const deliveryCleanupSchema = z.enum(['not-started', 'pending', 'verified', 'failed', 'unknown']);
export const deliveryStepResultSchema = z
  .object({
    id: z.string(),
    state: z.enum(['pending', 'running', 'passed', 'failed', 'skipped']),
    exitCode: z.number().int().optional(),
    durationMs: z.number().nonnegative().optional(),
    log: z.string(),
  })
  .strict();
export const deliveryCellSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    environment: deliveryEnvironmentSchema,
    state: z.enum(['queued', 'preparing', 'running', 'collecting', 'finished']),
    result: z.enum(['success', 'failed', 'cancelled', 'interrupted']).optional(),
    cleanup: deliveryCleanupSchema,
    vmId: z.string().optional(),
    vmCreatedAt: z.string().optional(),
    exitCode: z.number().int().optional(),
    environmentVerified: z.boolean(),
    environmentEvidence: z.string(),
    steps: z.array(deliveryStepResultSchema),
    outputManifestIds: z.array(z.uuid()),
    reportManifestIds: z.array(z.uuid()),
    error: z.string().optional(),
  })
  .strict();
export const deliveryRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    scope: deliveryScopeSchema,
    mode: z.enum(['build', 'validate-artifact']),
    inputId: z.uuid().optional(),
    inputDigest: deliveryDigestSchema,
    candidateDigest: deliveryDigestSchema.optional(),
    state: z.enum(['queued', 'preparing', 'running', 'collecting', 'finished']),
    result: z.enum(['success', 'failed', 'cancelled', 'interrupted']).optional(),
    cleanup: deliveryCleanupSchema,
    exitCode: z.number().int().optional(),
    environmentVerified: z.boolean(),
    steps: z.array(deliveryStepResultSchema),
    outputManifestIds: z.array(z.uuid()),
    reportManifestIds: z.array(z.uuid()),
    cells: z.array(deliveryCellSchema),
    jobId: z.uuid().optional(),
    retryOf: z.uuid().optional(),
    selectedSteps: z.array(z.string()),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
  })
  .strict();
export type DeliveryRun = z.infer<typeof deliveryRunSchema>;
export type DeliveryCell = z.infer<typeof deliveryCellSchema>;
export const deliveryRunRequestSchema = z
  .object({
    mode: z.enum(['build', 'validate-artifact']).default('build'),
    inputId: z.uuid().optional(),
    candidate: deliveryCandidateSchema.optional(),
    reviewed: z.literal(true),
    retryOf: z.uuid().optional(),
    selectedSteps: z.array(z.string()).max(20).default([]),
  })
  .strict();
export type DeliveryRunRequest = z.infer<typeof deliveryRunRequestSchema>;
export const deliveryPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    scope: deliveryScopeSchema,
    candidateDigest: deliveryDigestSchema,
    manifestId: z.uuid(),
    manifestDigest: deliveryDigestSchema,
    startupDigest: deliveryDigestSchema,
    state: z.enum(['preparing', 'starting', 'healthy', 'unhealthy', 'stopped', 'expired', 'failed']),
    cleanup: deliveryCleanupSchema,
    vmId: z.string().optional(),
    vmCreatedAt: z.string().optional(),
    jobId: z.uuid().optional(),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    healthAt: z.iso.datetime().optional(),
    url: z.string().optional(),
    healthPath: z.string().startsWith('/').default('/'),
    log: z.string(),
    error: z.string().optional(),
  })
  .strict();
export type DeliveryPreview = z.infer<typeof deliveryPreviewSchema>;

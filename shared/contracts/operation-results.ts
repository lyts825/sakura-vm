import { z } from 'zod';

export const operationResultSchema = z
  .object({
    correlationId: z.uuid(),
    operationId: z.string().min(1).max(200),
    outcome: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
    executed: z.boolean(),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
    responseStatus: z.number().int().min(100).max(599).optional(),
    responseValidated: z.boolean(),
    auditRecorded: z.boolean(),
    delivery: z.enum(['pending', 'sent', 'failed', 'unknown']),
    errorCode: z.string().max(80).optional(),
  })
  .strict();
export type OperationResult = z.infer<typeof operationResultSchema>;

export const operationResultPoolSchema = z.enum(['normal', 'management', 'authentication']);
export type OperationResultPool = z.infer<typeof operationResultPoolSchema>;
export const operationResultArchiveRequest = z.object({
  correlationId: z.uuid(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.enum(['reviewed-manually', 'checked-in-domain']),
  acknowledgeUnknown: z.literal(true),
}).strict();
export const operationResultArchiveSchema = z.object({
  correlationId: z.uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/),
  pool: operationResultPoolSchema, archivedAt: z.iso.datetime(),
  reason: operationResultArchiveRequest.shape.reason, capacityReleased: z.boolean(),
}).strict();
export const operationResultDirectorySchema = z.object({
  version: z.literal(1),
  pools: z.array(z.object({
    pool: operationResultPoolSchema, maxRecords: z.number().int().positive(),
    recordCount: z.number().int().nonnegative(), blockedCount: z.number().int().nonnegative(),
    full: z.boolean(), truncated: z.boolean(),
    state: z.enum(['healthy', 'degraded']).optional(), code: z.string().optional(),
  }).strict()).max(3),
  records: z.array(z.object({
    correlationId: z.uuid(), pool: operationResultPoolSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(['receipt', 'invalid']), active: z.boolean(), archiveAvailable: z.boolean(),
    operationId: operationResultSchema.shape.operationId.optional(),
    outcome: operationResultSchema.shape.outcome.optional(), executed: z.boolean().optional(),
    errorCode: z.string().max(80).optional(),
  }).strict()).max(4192),
  archive: z.object({
    recordCount: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
    maxRecords: z.number().int().positive(), maxBytes: z.number().int().positive(),
    maxRecordBytes: z.number().int().positive(), full: z.boolean(),
    state: z.enum(['healthy', 'degraded']), code: z.string().optional(),
  }).strict(),
}).strict();
export type OperationResultDirectory = z.infer<typeof operationResultDirectorySchema>;
export type OperationResultArchive = z.infer<typeof operationResultArchiveSchema>;

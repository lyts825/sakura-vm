/**
 * 模块职责：操作执行结果、结果池及归档契约，区分执行结论与 HTTP 请求是否成功。
 */
import { z } from 'zod';

// 执行结论、响应校验、审计和投递分别记录；投递失败或未知结果不等同于操作尚未执行。
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
// 归档要求对当前记录摘要明确确认未知结果，防止把重新变化的记录误当成已核查记录释放容量。
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

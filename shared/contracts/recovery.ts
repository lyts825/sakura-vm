/**
 * 模块职责（中文）：恢复记录、绑定、诊断和重建请求的公开 Schema，约束恢复目录中的目标与状态。
 * Module responsibility (English): recovery bindings, records, diagnostics and rebuild requests.
 * 详细范围（中文）：公开入口包括 recoveryBinding, RecoveryBinding, recoveryRecord, RecoveryRecord, recoveryViewSchema, RecoveryView, recoveryDiagnosticsSchema, RecoveryDiagnostics, recoveryListSchema, RecoveryCatalogView, recoveryRebuildRequest, recoveryRequest；职责覆盖恢复绑定、记录、诊断和重建请求，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include recoveryBinding, RecoveryBinding, recoveryRecord, RecoveryRecord, recoveryViewSchema, RecoveryView, recoveryDiagnosticsSchema, RecoveryDiagnostics, recoveryListSchema, RecoveryCatalogView, recoveryRebuildRequest, recoveryRequest. The scope covers recovery bindings, records, diagnostics and rebuild requests. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

const token = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\x00-\x1f\x7f]+$/);
export const recoveryBinding = z
  .object({
    domain: token,
    ticketId: token,
    owner: token,
    pluginId: token.optional(),
    pluginInstanceId: token.optional(),
    pluginGeneration: token.optional(),
    artifactDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    operationId: token.optional(),
    vmId: token.optional(),
    projectId: token.optional(),
    jobId: token.optional(),
  })
  .strict();
export type RecoveryBinding = z.infer<typeof recoveryBinding>;
export const recoveryRecord = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    binding: recoveryBinding,
    ticketRevision: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    resourceIds: z.array(token).max(8192),
    state: z.enum(['pending', 'attempting', 'resolved']),
    firstSeenAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    attempts: z.number().int().nonnegative(),
    error: z.string().max(1024).optional(),
    discoveryError: z.string().max(1024).optional(),
  })
  .strict();
export type RecoveryRecord = z.infer<typeof recoveryRecord>;
export const recoveryViewSchema = recoveryRecord.extend({
  actions: z.array(z.object({ id: token, title: token }).strict()),
  available: z.boolean(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type RecoveryView = z.infer<typeof recoveryViewSchema>;
export const recoveryDiagnosticsSchema = z.object({
  state: z.enum(['healthy', 'degraded']),
  code: z.string().optional(),
  message: z.string().optional(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  maxBytes: z.number().int().positive(),
  maxRecords: z.number().int().positive(),
  resolvedRetention: z.number().int().nonnegative(),
  recordCount: z.number().int().nonnegative(),
  sourceFailures: z.array(token),
  quarantineFile: token.optional(),
}).strict();
export type RecoveryDiagnostics = z.infer<typeof recoveryDiagnosticsSchema>;
export const recoveryListSchema = z
  .object({ version: z.literal(1), records: z.array(recoveryViewSchema), diagnostics: recoveryDiagnosticsSchema.optional() })
  .strict();
export type RecoveryCatalogView = z.infer<typeof recoveryListSchema>;
export const recoveryRebuildRequest = z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const recoveryRequest = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    action: token,
  })
  .strict();

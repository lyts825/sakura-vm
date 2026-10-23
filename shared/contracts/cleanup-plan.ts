/** 中文：清理中心的候选、预览和执行契约。English: Cleanup candidates, previews and execution contracts. */
import { z } from 'zod';

export const cleanupProviderIdSchema = z.enum(['backup-blocks', 'job-logs']);
export const cleanupEntrySchema = z.object({
  id: z.string(), source: z.string(), owner: z.string(), label: z.string(),
  bytes: z.number().nonnegative(), eligible: z.boolean(), reason: z.string(),
}).strict();
export const cleanupSnapshotSchema = z.object({
  revision: z.string(), entries: z.array(cleanupEntrySchema), notes: z.array(z.string()),
}).strict();
export const cleanupPreviewSchema = cleanupSnapshotSchema.extend({
  provider: cleanupProviderIdSchema, token: z.uuid(), expiresAt: z.iso.datetime(),
  estimatedBytes: z.number().nonnegative(), candidateCount: z.number().int().nonnegative(),
}).strict();
export const cleanupResultSchema = z.object({
  provider: cleanupProviderIdSchema, removedCount: z.number().int().nonnegative(),
  reclaimedBytes: z.number().nonnegative(),
}).strict();
export const cleanupProvidersSchema = z.object({ providers: z.array(z.object({
  id: cleanupProviderIdSchema, label: z.string(), description: z.string(),
}).strict()) }).strict();
export const cleanupPreviewRequest = z.object({ provider: cleanupProviderIdSchema }).strict();
export const cleanupExecuteRequest = cleanupPreviewRequest.extend({ token: z.uuid() }).strict();
export type CleanupProviderId = z.infer<typeof cleanupProviderIdSchema>;
export type CleanupSnapshot = z.infer<typeof cleanupSnapshotSchema>;
export type CleanupPreview = z.infer<typeof cleanupPreviewSchema>;
export type CleanupResult = z.infer<typeof cleanupResultSchema>;

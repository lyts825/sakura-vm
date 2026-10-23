/** 单文件修复会话与隔离验证契约。 Single-file repair sessions and isolated validation contracts. */
import { z } from 'zod';
import { jobViewSchema } from './core-dtos.ts';

export const repairPathSchema = z.string().min(1).max(240)
  .refine(value => !value.startsWith('/') && !/[\\\x00-\x1f:]/.test(value) &&
    value.split('/').every(part => part && !['.', '..', '.git', '.ssh', '.env'].includes(part)), '需要项目内普通文件的相对路径');
export const repairFileSchema = z.object({ path: repairPathSchema, content: z.string().max(16000).refine(value => !value.includes('\0'), '需要无 NUL 的文本') }).strict();
export const repairFilesSchema = z.array(repairFileSchema).min(1).max(8)
  .refine(files => new Set(files.map(file => file.path)).size === files.length &&
    files.reduce((total, file) => total + new TextEncoder().encode(file.content).length, 0) <= 16000,
    '文件路径不能重复，总内容最多 16 KB');
export const repairStartSchema = z.object({
  target: repairPathSchema, context: z.array(repairPathSchema).max(7).default([]),
  instruction: z.string().trim().min(1).max(2000),
}).strict();
export const repairSessionKeySchema = z.object({ sessionId: z.uuid() }).strict();
export const repairValidateSchema = repairSessionKeySchema.extend({
  command: z.string().trim().min(1).max(4096).refine(value => !value.includes('\0')),
  timeoutSeconds: z.number().int().min(1).max(300).default(60),
}).strict();
export const repairPatchSchema = z.object({ path: repairPathSchema, content: repairFileSchema.shape.content, summary: z.string().max(1000) }).strict();
export const repairSessionSchema = z.object({
  id: z.uuid(), vmId: z.string(), projectId: z.string(), target: repairPathSchema,
  state: z.enum(['preview', 'generating', 'review', 'validating', 'validated', 'apply-unknown', 'applied', 'failed', 'cancelled']),
  expiresAt: z.iso.datetime(),
  files: z.array(z.object({ path: repairPathSchema, sha256: z.string(), bytes: z.number() }).strict()),
  preview: z.object({ content: z.string(), model: z.string(), endpoint: z.string(), redactions: z.number(), expiresAt: z.number() }).strict(),
  before: z.string(), patch: repairPatchSchema.optional(), patchSha256: z.string().optional(),
  validation: z.object({ command: z.string(), patchSha256: z.string(), job: jobViewSchema.optional(),
    sandboxId: z.string().optional(), cleanup: z.enum(['pending', 'done', 'failed']), passed: z.boolean() }).strict().optional(),
  error: z.string().optional(),
}).strict();
export type RepairSession = z.infer<typeof repairSessionSchema>;
export type RepairFile = z.infer<typeof repairFileSchema>;
export const repairActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), input: repairStartSchema }).strict(),
  z.object({ action: z.literal('validate'), input: repairValidateSchema }).strict(),
  ...(['generate', 'apply', 'cancel'] as const).map(action => z.object({ action: z.literal(action), sessionId: z.uuid() }).strict()),
]);
export const repairActionResponseSchema = z.union([repairSessionSchema, z.object({ ok: z.literal(true) }).strict()]);

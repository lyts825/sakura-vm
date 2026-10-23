/** 中文：可信更新中心的公开请求与状态。English: Public trusted-update requests and state. */
import { z } from 'zod';
const publisherSchema = z.object({ id: z.string(), label: z.string(), source: z.string(), publicKey: z.string() }).strict();
const candidateSchema = z.object({ path: z.string(), version: z.string().optional(), fingerprint: z.string().optional(),
  publisher: z.string().optional(), source: z.string().optional(), verified: z.boolean(), error: z.string().optional() }).strict();
export const trustedUpdateResponseSchema = z.object({
  trustRevision: z.number().int().nonnegative(), publishers: z.array(publisherSchema),
  active: candidateSchema, previous: candidateSchema.nullable(), candidates: z.array(candidateSchema),
  checked: z.object({ token: z.uuid(), version: z.string(), fingerprint: z.string(), publisher: z.string(),
    source: z.string(), sequence: z.number().int().positive(), expiresAt: z.iso.datetime(), files: z.number().int().nonnegative() }).strict().optional(),
  message: z.string().optional(),
}).strict();
export const trustedUpdateRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add-publisher'), revision: z.number().int().nonnegative(), label: z.string().trim().min(1).max(120),
    source: z.string().trim().url().max(500), publicKey: z.string().min(20).max(4096) }).strict(),
  z.object({ action: z.literal('remove-publisher'), revision: z.number().int().nonnegative(), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal('check'), path: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('stage'), token: z.uuid() }).strict(),
  z.object({ action: z.literal('activate'), path: z.string().regex(/^versions\/[a-f0-9]{32}$/), revision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('rollback'), revision: z.number().int().nonnegative(), expectedPrevious: z.string(), acknowledgeUnverified: z.boolean() }).strict(),
]);
export type TrustedUpdateView = z.infer<typeof trustedUpdateResponseSchema>;
export type TrustedUpdateResponse = TrustedUpdateView;

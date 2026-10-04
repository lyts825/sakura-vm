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
export const recoveryListSchema = z
  .object({ version: z.literal(1), records: z.array(recoveryViewSchema) })
  .strict();
export const recoveryRequest = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    action: token,
  })
  .strict();

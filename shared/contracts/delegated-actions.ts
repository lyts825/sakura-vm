/** 固定提供者的一次动作票据；人工确认和提供者返回值各自保留原身份。 */
import { z } from 'zod';
import { cleanupProviderIdSchema, cleanupPreviewSchema } from './cleanup-plan.ts';
import { resilienceScopeSchema } from './resilience-lab.ts';
import { suiteJson as suiteJsonSchema } from './suite-common.ts';

export const delegatedAdapterSchema = z.enum(['maintenance-cleanup', 'resilience-reconcile']);
export const delegatedInputSchema = z.discriminatedUnion('adapter', [
  z.object({ adapter: z.literal('maintenance-cleanup'), provider: cleanupProviderIdSchema }).strict(),
  z
    .object({ adapter: z.literal('resilience-reconcile'), scope: resilienceScopeSchema, runId: z.uuid() })
    .strict(),
]);
export const delegatedTicketSchema = z
  .object({
    id: z.uuid(),
    adapter: delegatedAdapterSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const delegatedPlanSchema = z
  .object({
    ticket: delegatedTicketSchema,
    actorId: z.uuid(),
    consumer: z.enum(['official:incident-actions', 'official:flow-connectors']),
    consumerGeneration: z.string().min(1).max(100),
    provider: z.enum(['official:maintenance', 'official:resilience-runs']),
    providerGeneration: z.string().min(1).max(100),
    input: delegatedInputSchema,
    resourceDigest: digest,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    summary: suiteJsonSchema,
  })
  .strict();
export const delegatedReceiptSchema = z
  .object({
    plan: delegatedPlanSchema,
    status: z.enum(['ready', 'consumed', 'dispatching', 'returned', 'rejected', 'unknown', 'expired']),
    updatedAt: z.iso.datetime(),
    intentDigest: digest.nullable(),
    result: suiteJsonSchema.nullable(),
    error: z.string().max(1000).nullable(),
  })
  .strict();
export const delegatedIntentSchema = z.object({ intentDigest: digest }).strict();
/** 原清理令牌只留在提供者账本，不随委派计划暴露。 */
export const delegatedCleanupSummarySchema = cleanupPreviewSchema.omit({ token: true });
export type DelegatedAdapter = z.infer<typeof delegatedAdapterSchema>;
export type DelegatedInput = z.infer<typeof delegatedInputSchema>;
export type DelegatedTicket = z.infer<typeof delegatedTicketSchema>;
export type DelegatedPlan = z.infer<typeof delegatedPlanSchema>;
export type DelegatedReceipt = z.infer<typeof delegatedReceiptSchema>;
export type DelegatedIntent = z.infer<typeof delegatedIntentSchema>;

/** 固定提供者的一次动作票据；人工确认和提供者返回值各自保留原身份。 */
import { z } from 'zod';
import { cleanupProviderIdSchema, cleanupPreviewSchema } from './cleanup-plan.ts';
import { resilienceScopeSchema } from './resilience-lab.ts';
import { suiteJson as suiteJsonSchema } from './suite-common.ts';
import { ilScope, runPreviewSchema } from './integration-lab.ts';
import { scopeSchema as knowledgeScope, refSchema as knowledgeRef } from './knowledge-studio.ts';

export const delegatedAdapterSchema = z.enum([
  'maintenance-cleanup',
  'resilience-reconcile',
  'integration-run',
  'knowledge-publish',
]);
export const delegatedInputSchema = z.discriminatedUnion('adapter', [
  z.object({ adapter: z.literal('maintenance-cleanup'), provider: cleanupProviderIdSchema }).strict(),
  z
    .object({ adapter: z.literal('resilience-reconcile'), scope: resilienceScopeSchema, runId: z.uuid() })
    .strict(),
  z
    .object({
      adapter: z.literal('integration-run'),
      scope: ilScope,
      input: runPreviewSchema,
      approveWrites: z.boolean().default(false),
    })
    .strict(),
  knowledgeScope
    .extend({ adapter: z.literal('knowledge-publish'), document: knowledgeRef, review: knowledgeRef })
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
export const delegatedAcknowledgementReason = z.string().trim().min(1).max(1000);
export const delegatedPlanSchema = z
  .object({
    ticket: delegatedTicketSchema,
    actorId: z.uuid(),
    consumer: z.enum(['official:incident-actions', 'official:flow-connectors']),
    consumerGeneration: z.string().min(1).max(100),
    provider: z.enum([
      'official:maintenance',
      'official:resilience-runs',
      'official:integration-runners',
      'official:knowledge-publish',
    ]),
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
    acknowledgedAt: z.iso.datetime().nullable().default(null),
    acknowledgedBy: z.uuid().nullable().default(null),
    acknowledgementReason: z.string().max(1000).default(''),
  })
  .strict()
  .superRefine((receipt, context) => {
    const empty =
      receipt.acknowledgedAt === null &&
      receipt.acknowledgedBy === null &&
      receipt.acknowledgementReason === '';
    const complete =
      receipt.acknowledgedAt !== null &&
      receipt.acknowledgedBy === receipt.plan.actorId &&
      receipt.acknowledgementReason.trim().length > 0 &&
      ['returned', 'rejected', 'unknown', 'expired'].includes(receipt.status);
    if (!empty && !complete)
      context.addIssue({ code: 'custom', message: '回执核对字段不完整或不属于原主体的结束记录' });
  });
export const delegatedIntentSchema = z.object({ intentDigest: digest }).strict();
/** 原清理令牌只留在提供者账本，不随委派计划暴露。 */
export const delegatedCleanupSummarySchema = cleanupPreviewSchema.omit({ token: true });
export type DelegatedAdapter = z.infer<typeof delegatedAdapterSchema>;
export type DelegatedInput = z.infer<typeof delegatedInputSchema>;
export type DelegatedTicket = z.infer<typeof delegatedTicketSchema>;
export type DelegatedPlan = z.infer<typeof delegatedPlanSchema>;
export type DelegatedReceipt = z.infer<typeof delegatedReceiptSchema>;
export type DelegatedIntent = z.infer<typeof delegatedIntentSchema>;

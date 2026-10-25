/** 事件动作的本地批准和原提供者回执分开；人工声明没有系统票据。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import {
  delegatedPlanSchema,
  delegatedReceiptSchema,
  delegatedAcknowledgementReason,
} from './delegated-actions.ts';
export const incidentActionAcknowledgement = S.suiteScope
  .extend({
    action: S.suiteRef,
    reason: delegatedAcknowledgementReason,
  })
  .strict();
export const incidentPlanAction = S.suiteScope
  .extend({
    runbook: S.suiteRef,
    stepId: S.suiteId,
    evidence: z.array(S.suiteRef).max(50),
  })
  .strict();
export const incidentActionPlanInput = incidentPlanAction
  .omit({ workspaceId: true })
  .extend({
    case: S.suiteRef,
    providerPlan: delegatedPlanSchema,
  })
  .strict();
export const incidentDelegatedAction = z
  .object({
    format: z.literal('sakura-incident-action/1'),
    kind: z.literal('delegated'),
    planId: S.suiteId,
    case: S.suiteRef,
    runbook: S.suiteRef,
    stepId: S.suiteId,
    evidence: z.array(S.suiteRef).max(50),
    providerPlan: delegatedPlanSchema,
    phase: z.enum(['prepared', 'intent-recorded', 'provider-returned', 'unknown']),
    receipt: delegatedReceiptSchema.nullable(),
    submittedBy: S.suiteId,
    inference: z.literal('provider-state-only'),
  })
  .strict();
export const incidentManualActionInput = S.suiteScope
  .extend({
    name: S.suiteName,
    statement: z.string().min(1).max(16000),
    evidence: z.array(S.suiteRef).max(50),
  })
  .strict();
export const incidentManualAction = z
  .object({
    format: z.literal('sakura-incident-action/1'),
    kind: z.literal('manual'),
    case: S.suiteRef,
    statement: incidentManualActionInput.shape.statement,
    evidence: incidentManualActionInput.shape.evidence,
    declaredBy: S.suiteId,
    systemExecution: z.literal(false),
  })
  .strict();
export const incidentAction = z.discriminatedUnion('kind', [incidentDelegatedAction, incidentManualAction]);

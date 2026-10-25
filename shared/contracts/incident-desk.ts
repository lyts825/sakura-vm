/** 事件复盘的事实、外来声明、人工判断和原提供者回执分别记录。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { cleanupProviderIdSchema } from './cleanup-plan.ts';
import { resilienceScopeSchema } from './resilience-lab.ts';

export const incidentText = z.string().trim().min(1).max(4000);
export const incidentTime = z.iso.datetime({ offset: true });
export const incidentCaseInput = z.object({
  name: S.suiteName,
  impact: incidentText,
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  affected: z.array(z.string().trim().min(1).max(200)).max(50),
  workspaceId: S.suiteId.optional(),
}).strict();
export const incidentCase = z.object({
  format: z.literal('sakura-incident-case/1'),
  impact: incidentText,
  severity: incidentCaseInput.shape.severity,
  affected: incidentCaseInput.shape.affected,
  status: z.enum(['open', 'resolved']),
  resolution: z.string().max(4000),
  reopenReason: z.string().max(4000),
  unresolved: z.array(z.string().min(1).max(1000)).max(100),
  declaredBy: S.suiteId,
  singleOwnerCase: z.literal(true),
}).strict();
export const incidentResolve = S.suiteScope.extend({
  case: S.suiteRef, reason: incidentText,
  unresolved: incidentCase.shape.unresolved,
}).strict();
export const incidentCaseRevision = S.suiteScope.extend({
  case: S.suiteRef,
  impact: incidentCaseInput.shape.impact,
  severity: incidentCaseInput.shape.severity,
  affected: incidentCaseInput.shape.affected,
}).strict();
export const incidentUpload = S.suiteScope.extend({
  name: S.suiteName,
  text: z.string().max(1024 ** 2),
  format: z.enum(['text', 'json']).default('text'),
  sourceAt: incidentTime.nullable().default(null),
  allowExport: z.boolean().default(false),
}).strict();
export const incidentAttach = S.suiteScope.extend({
  source: S.suiteRef,
  sourceAt: incidentTime.nullable().default(null),
  label: S.suiteName.optional(),
}).strict();
export const incidentEvidence = z.object({
  format: z.literal('sakura-incident-evidence/1'),
  case: S.suiteRef,
  source: S.suiteRef,
  sourceDigest: S.suiteDigest,
  sourceAt: incidentTime.nullable(),
  observedAt: incidentTime,
  method: z.enum(['upload', 'manual', 'metrics', 'health']),
  externalStatement: z.boolean(),
  derivation: z.object({
    original: S.suiteRef,
    originalDigest: S.suiteDigest,
    rulesDigest: S.suiteDigest,
    reviewed: z.boolean(),
    reviewer: S.suiteId.nullable(),
  }).strict().nullable(),
}).strict();
export const incidentRedactionRules = z.object({
  maskKeys: z.array(z.enum(['password', 'token', 'authorization', 'secret', 'email'])).max(5),
  literals: z.array(z.string().min(1).max(200)).max(50),
}).strict();
export const incidentRedact = S.suiteScope.extend({
  evidence: S.suiteRef,
  rules: incidentRedactionRules,
}).strict();
export const incidentEvent = z.object({
  id: S.suiteDigest,
  evidence: S.suiteRef,
  sourceOrder: z.number().int().min(0),
  sourceAt: incidentTime.nullable(),
  observedAt: incidentTime,
  message: z.string().max(4000),
  messageDigest: S.suiteDigest,
  level: z.enum(['info', 'warning', 'error', 'unknown']),
  clockVerified: z.literal(false),
}).strict();
export const incidentClockNote = z.object({
  evidence: S.suiteRef,
  offsetMs: z.number().int().min(-7 * 86400000).max(7 * 86400000),
  reason: incidentText,
  verified: z.literal(false),
}).strict();
export const incidentTimeline = z.object({
  format: z.literal('sakura-incident-timeline/1'),
  case: S.suiteRef,
  evidence: z.array(S.suiteRef).min(1).max(500),
  events: z.array(incidentEvent).max(100000),
  clockNotes: z.array(incidentClockNote).max(500),
  truncatedMessages: z.number().int().min(0),
  unsupportedLines: z.number().int().min(0),
  displayOrder: z.literal('collection-order'),
  crossSourceOrder: z.literal('uncertain'),
}).strict();
export const incidentAssemble = S.suiteScope.extend({
  evidence: z.array(S.suiteRef).min(1).max(50),
}).strict();
export const incidentHypothesisInput = S.suiteScope.extend({
  hypothesis: S.suiteRef.optional(),
  timeline: S.suiteRef,
  title: S.suiteName,
  explanation: incidentText,
  pending: z.array(z.string().min(1).max(1000)).max(100),
}).strict();
export const incidentHypothesis = z.object({
  format: z.literal('sakura-incident-hypothesis/1'),
  case: S.suiteRef,
  timeline: S.suiteRef,
  explanation: incidentText,
  pending: incidentHypothesisInput.shape.pending,
  support: z.array(S.suiteDigest).max(500),
  against: z.array(S.suiteDigest).max(500),
  status: z.enum(['open', 'supported', 'contradicted', 'unresolved']),
  reason: z.string().max(4000),
  judgment: z.literal('manual'),
  decidedBy: S.suiteId.nullable(),
}).strict();
export const incidentActionTarget = z.discriminatedUnion('adapter', [
  z.object({ adapter: z.literal('maintenance-cleanup'), provider: cleanupProviderIdSchema }).strict(),
  z.object({ adapter: z.literal('resilience-reconcile'), scope: resilienceScopeSchema, runId: S.suiteId }).strict(),
]);
export const incidentStep = z.discriminatedUnion('kind', [
  z.object({ id: S.suiteId, kind: z.literal('query'), label: S.suiteName, query: z.enum(['evidence', 'timeline', 'hypotheses']) }).strict(),
  z.object({ id: S.suiteId, kind: z.literal('manual'), label: S.suiteName, instruction: incidentText }).strict(),
  z.object({ id: S.suiteId, kind: z.literal('delegated'), label: S.suiteName, target: incidentActionTarget }).strict(),
]);
export const incidentRunbookInput = S.suiteScope.extend({
  runbook: S.suiteRef.optional(), name: S.suiteName, steps: z.array(incidentStep).min(1).max(50),
}).strict();
export const incidentRunbook = z.object({
  format: z.literal('sakura-incident-runbook/1'), case: S.suiteRef,
  steps: incidentRunbookInput.shape.steps,
}).strict();

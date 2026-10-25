/** 选定复盘窗口的审阅、来源摘要与人工叙述；不把审阅结论当作系统执行证明。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as I from './incident-desk.ts';

const note = z.string().trim().min(1).max(1000);
export const incidentReviewSelection = z
  .object({
    case: S.suiteRef,
    timeline: S.suiteRef,
    evidence: z.array(S.suiteRef).min(1).max(50),
    hypotheses: z.array(S.suiteRef).max(100),
    actions: z.array(S.suiteRef).max(100),
    unresolved: z.array(note).max(100),
  })
  .strict();
export const incidentReviewOpen = S.suiteScope
  .extend({
    name: S.suiteName,
    timeline: S.suiteRef,
    evidence: incidentReviewSelection.shape.evidence,
    hypotheses: incidentReviewSelection.shape.hypotheses.default([]),
    actions: incidentReviewSelection.shape.actions.default([]),
    unresolved: incidentReviewSelection.shape.unresolved.default([]),
  })
  .strict();
export const incidentReviewChecklist = z
  .object({
    selectedScope: z.boolean(),
    factsAndClaims: z.boolean(),
    clockUncertainty: z.boolean(),
    manualInferences: z.boolean(),
    actionReceipts: z.boolean(),
    unresolvedItems: z.boolean(),
  })
  .strict();
export const incidentReviewDecide = S.suiteScope
  .extend({
    review: S.suiteRef,
    decision: z.enum(['accept', 'reject']),
    reason: z.string().trim().min(1).max(4000),
    checklist: incidentReviewChecklist,
  })
  .strict();
const permission = z
  .object({ ref: S.suiteRef, policyRevision: z.number().int().positive(), digest: S.suiteDigest })
  .strict();
export const incidentReviewEvidence = z
  .object({
    ref: S.suiteRef,
    name: S.suiteName,
    method: I.incidentEvidence.shape.method,
    externalStatement: z.boolean(),
    sourceDigest: S.suiteDigest,
    sourceAt: I.incidentTime.nullable(),
    observedAt: I.incidentTime,
    redaction: z
      .object({
        derived: z.boolean(),
        reviewed: z.boolean(),
        exportGranted: z.boolean(),
        effective: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const incidentReviewHypothesis = z
  .object({
    ref: S.suiteRef,
    name: S.suiteName,
    explanation: I.incidentHypothesis.shape.explanation,
    status: I.incidentHypothesis.shape.status,
    reason: I.incidentHypothesis.shape.reason,
    judgment: z.literal('manual'),
    supportCount: z.number().int().nonnegative(),
    againstCount: z.number().int().nonnegative(),
    pending: I.incidentHypothesis.shape.pending,
  })
  .strict();
export const incidentReviewAction = z
  .object({
    ref: S.suiteRef,
    name: S.suiteName,
    kind: z.enum(['manual', 'delegated']),
    status: z.enum([
      'manual-declaration',
      'ready',
      'consumed',
      'dispatching',
      'returned',
      'rejected',
      'unknown',
      'expired',
      'unavailable',
      'invalid-proof',
    ]),
    proofSource: z.enum(['manual-declaration', 'current-provider', 'saved-receipt', 'unavailable']),
    proofDigest: S.suiteDigest.nullable(),
    resourceState: z.enum([
      'manual-declaration',
      'not-dispatched',
      'request-returned',
      'cleanup-confirmed',
      'unknown',
    ]),
    fact: S.suiteJson.nullable(),
    statement: z.string().max(16000).nullable(),
  })
  .strict();
export const incidentReviewFinding = z
  .object({
    code: z.string().regex(/^[A-Z_]+$/),
    severity: z.enum(['note', 'warning', 'blocking']),
    message: note,
  })
  .strict();
export const incidentReviewAssessment = z
  .object({
    format: z.literal('sakura-incident-review-assessment/1'),
    case: S.suiteRef,
    currentCase: S.suiteRef,
    caseState: I.incidentCase.shape.status,
    workspacePolicyRevision: z.number().int().positive(),
    selectedScopeOnly: z.literal(true),
    evidence: z.array(incidentReviewEvidence).max(50),
    timeline: z
      .object({
        ref: S.suiteRef,
        eventCount: z.number().int().nonnegative().max(100000),
        displayOrder: z.literal('collection-order'),
        crossSourceOrder: z.literal('uncertain'),
        clockAnnotations: z.number().int().nonnegative().max(500),
        clockNotes: z.array(I.incidentClockNote).max(500),
        clockAnnotationsVerified: z.literal(false),
        unsupportedLines: z.number().int().nonnegative(),
        truncatedMessages: z.number().int().nonnegative(),
      })
      .strict(),
    hypotheses: z.array(incidentReviewHypothesis).max(100),
    actions: z.array(incidentReviewAction).max(100),
    unresolved: z.array(note).max(500),
    findings: z.array(incidentReviewFinding).max(200),
    permissions: z.array(permission).max(1000),
    noCausalConclusion: z.literal(true),
    exportReady: z.boolean(),
  })
  .strict();
export const incidentReview = z
  .object({
    format: z.literal('sakura-incident-review/1'),
    selection: incidentReviewSelection,
    assessment: incidentReviewAssessment,
    assessmentDigest: S.suiteDigest,
    decision: z.enum(['pending', 'accepted', 'rejected']),
    reason: z.string().max(4000),
    checklist: incidentReviewChecklist,
    decidedBy: S.suiteId.nullable(),
    decidedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const incidentReviewCheck = z
  .object({
    review: S.suiteRef,
    decision: incidentReview.shape.decision,
    current: z.boolean(),
    accepted: z.boolean(),
    reasons: z.array(note).max(200),
    assessment: incidentReviewAssessment,
    assessmentDigest: S.suiteDigest,
  })
  .strict();
export const incidentReviewPin = S.suiteScope.extend({ review: S.suiteRef }).strict();
export const incidentReviewLatestDecision = z
  .object({
    review: S.suiteRef,
    latest: S.suiteRef,
    decision: incidentReview.shape.decision,
    current: z.boolean(),
  })
  .strict();

export const incidentReportNarrative = z
  .object({
    facts: z.string().max(16000),
    inferences: z.string().max(16000),
    measures: z.string().max(16000),
    followUp: z.string().max(16000),
  })
  .strict();
export const incidentReportDraft = S.suiteScope
  .extend({
    report: S.suiteRef.optional(),
    review: S.suiteRef,
    title: S.suiteName,
    summary: z.string().trim().min(1).max(16000),
    narrative: incidentReportNarrative,
  })
  .strict();
export const incidentReport = z
  .object({
    format: z.literal('sakura-incident-report/1'),
    case: S.suiteRef,
    review: S.suiteRef,
    status: z.enum(['draft', 'sealed']),
    summary: incidentReportDraft.shape.summary,
    narrative: incidentReportNarrative,
    narrativeKind: z.literal('manual'),
    facts: incidentReviewAssessment,
    assessmentDigest: S.suiteDigest,
    author: S.suiteId,
    sealedBy: S.suiteId.nullable(),
    sealedAt: z.iso.datetime().nullable(),
    selectedScopeOnly: z.literal(true),
    noCausalConclusion: z.literal(true),
  })
  .strict();
export const incidentReportSeal = S.suitePin;
export const incidentReportCompare = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict();
export type IncidentReviewAssessment = z.infer<typeof incidentReviewAssessment>;
export type IncidentReviewCheck = z.infer<typeof incidentReviewCheck>;
export type IncidentReviewLatestDecision = z.infer<typeof incidentReviewLatestDecision>;

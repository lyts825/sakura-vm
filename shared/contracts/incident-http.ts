/** 事件复盘各领域的严格 HTTP 边界；内部委派、派生写入及隔离原语不公开。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as I from './incident-desk.ts';
import * as A from './incident-actions.ts';
import * as M from './incident-materials.ts';
import * as C from './incident-snapshots.ts';
import * as P from './incident-timeline-pages.ts';
import * as R from './incident-reviews.ts';
import * as W from './incident-workbench.ts';
import { delegatedReceiptSchema } from './delegated-actions.ts';
import { suiteHostCapacity } from './suite-capacity.ts';
import {
  suiteMethod as method,
  suiteEmpty,
  suiteCapacity,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
} from './suite-http.ts';

const select = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
const compare = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict();
function evidenceMaterialMethods() {
  const {
    hostCapacity: _hostCapacity,
    createWorkspace: _createWorkspace,
    listWorkspaces: _listWorkspaces,
    workspace: _workspace,
    revokeWorkspace: _revokeWorkspace,
    capacity: _capacity,
    ...methods
  } = suiteMaterialMethods();
  return methods;
}

export const incidentHttpSchemas = {
  cases: {
    ...controls(),
    hostCapacity: method(S.suiteScope, suiteHostCapacity, true),
    createWorkspace: method(z.object({ name: S.suiteName }).strict(), S.suiteWorkspace),
    listWorkspaces: method(suiteEmpty, z.array(S.suiteWorkspace).max(50), true),
    workspace: method(S.suiteScope, S.suiteWorkspace, true),
    revokeWorkspace: method(
      S.suiteScope.extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() }).strict(),
      S.suiteWorkspace,
    ),
    capacity: method(S.suiteScope, suiteCapacity, true),
    open: method(
      I.incidentCaseInput,
      z.object({ workspace: S.suiteWorkspace, case: S.suiteRecord }).strict(),
    ),
    scope: method(S.suiteScope, S.suiteRecord, true),
    reviseScope: method(I.incidentCaseRevision, S.suiteRecord),
    resolve: method(I.incidentResolve, S.suiteRecord),
    reopen: method(I.incidentResolve.omit({ unresolved: true }).strict(), S.suiteRecord),
  },
  evidence: {
    ...evidenceMaterialMethods(),
    upload: method(I.incidentUpload, S.suiteRecord),
    attach: method(I.incidentAttach, S.suiteRecord),
    pin: method(S.suitePin, S.suiteRecord, true),
    observe: method(M.incidentObservationInput, S.suiteRecord),
    redact: method(I.incidentRedact, S.suiteRecord),
    planRedactionReview: method(M.incidentRedactionReviewInput, S.suitePlan),
    reviewRedaction: method(S.suiteApproval, S.suiteRecord),
    redactionStatus: method(
      S.suitePin,
      z.object({ reviewed: z.boolean(), exportGranted: z.boolean(), effective: z.boolean() }).strict(),
      true,
    ),
    captureSources: method(
      suiteEmpty,
      z.array(z.object({ kind: z.enum(['metrics', 'health']), available: z.boolean() }).strict()).max(2),
      true,
    ),
    planCapture: method(C.incidentCaptureInput, S.suitePlan),
    capture: method(S.suiteApproval, S.suiteRecord),
  },
  timeline: {
    ...controls(),
    head: method(P.incidentTimelinePin, P.incidentTimelineHeader, true),
    headers: method(P.incidentTimelineHeadersRequest, P.incidentTimelineHeadersPage, true),
    events: method(P.incidentTimelineEventsRequest, P.incidentTimelineEventPage, true),
    assemble: method(I.incidentAssemble, S.suiteRecord),
    annotateClock: method(select('timeline').extend({ note: I.incidentClockNote }).strict(), S.suiteRecord),
    compare: method(compare, S.suiteRecord),
  },
  hypotheses: {
    ...controls(),
    propose: method(I.incidentHypothesisInput, S.suiteRecord),
    linkEvidence: method(
      select('hypothesis')
        .extend({ support: I.incidentHypothesis.shape.support, against: I.incidentHypothesis.shape.against })
        .strict(),
      S.suiteRecord,
    ),
    decide: method(
      select('hypothesis')
        .extend({ status: z.enum(['supported', 'contradicted', 'unresolved']), reason: I.incidentText })
        .strict(),
      S.suiteRecord,
    ),
  },
  runbooks: {
    ...controls(),
    compile: method(I.incidentRunbookInput, S.suiteRecord),
    previewSteps: method(select('runbook'), S.suiteRecord),
  },
  actions: {
    ...controls(),
    providers: method(
      suiteEmpty,
      z
        .array(
          z
            .object({
              adapter: z.enum(['maintenance-cleanup', 'resilience-reconcile']),
              available: z.boolean(),
            })
            .strict(),
        )
        .max(2),
      true,
    ),
    planAction: method(A.incidentPlanAction, S.suitePlan),
    submitAction: method(S.suiteApproval, S.suiteRecord),
    inspect: method(
      select('action'),
      z
        .object({
          record: S.suiteRecord,
          provider: delegatedReceiptSchema.nullable(),
          providerAvailable: z.boolean(),
        })
        .strict(),
      true,
    ),
    acknowledge: method(A.incidentActionAcknowledgement, S.suiteRecord),
    recordManual: method(A.incidentManualActionInput, S.suiteRecord),
  },
  reviews: {
    ...controls(),
    open: method(R.incidentReviewOpen, S.suiteRecord),
    decide: method(R.incidentReviewDecide, S.suiteRecord),
    recheck: method(R.incidentReviewPin, R.incidentReviewCheck, true),
    latestDecision: method(R.incidentReviewPin, R.incidentReviewLatestDecision, true),
  },
  reports: {
    ...controls(),
    draft: method(R.incidentReportDraft, S.suiteRecord),
    seal: method(R.incidentReportSeal, S.suiteRecord),
    compare: method(R.incidentReportCompare, S.suiteRecord),
  },
  exchange: {
    ...suiteExchangeMethods(),
    previewExport: method(
      S.suiteScope.extend({ references: z.array(S.suiteRef).min(1).max(20) }).strict(),
      S.suitePlan,
    ),
  },
  workbench: {
    ...controls(),
    templates: method(suiteEmpty, W.incidentWorkbenchTemplates, true),
    view: method(W.incidentWorkbenchViewRequest, W.incidentWorkbenchView, true),
  },
} as const;
export type IncidentDomain = keyof typeof incidentHttpSchemas;
export const incidentHttpRequests = Object.fromEntries(
  Object.entries(incidentHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`incident-${domain}.${name}`, schema.request]),
  ),
);
export const incidentHttpResponses = Object.fromEntries(
  Object.entries(incidentHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([name, schema]) => [`incident-${domain}.${name}`, schema.response]),
  ),
);

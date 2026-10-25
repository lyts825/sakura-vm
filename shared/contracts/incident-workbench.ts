/** 事件工作台只聚合有界摘要；模板是待人工核对的建议，不产生证据或执行。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as I from './incident-desk.ts';
import { incidentTimelineHeader } from './incident-timeline-pages.ts';

export const incidentWorkbenchDomain = z.enum([
  'cases',
  'evidence',
  'timeline',
  'hypotheses',
  'runbooks',
  'actions',
  'reviews',
  'reports',
  'exchange',
]);
export const incidentWorkbenchTemplate = z
  .object({
    id: z.enum(['application-startup-failure', 'capacity-exhausted', 'drill-interrupted']),
    name: S.suiteName,
    description: z.string().min(1).max(1000),
    open: I.incidentCaseInput.omit({ workspaceId: true }),
    steps: z
      .array(
        z
          .object({
            stage: z.enum(['scope', 'evidence', 'timeline', 'hypothesis', 'action', 'review', 'handoff']),
            instruction: z.string().min(1).max(1000),
            requiresHuman: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    suggestedOnly: z.literal(true),
    evidenceCreated: z.literal(false),
    automaticExecution: z.literal(false),
  })
  .strict();
export const incidentWorkbenchTemplates = z.array(incidentWorkbenchTemplate).length(3);
const cursor = z.number().int().min(0).max(100000).default(0);
export const incidentWorkbenchViewRequest = z
  .object({
    workspaceId: S.suiteId.optional(),
    workspaceCursor: cursor,
    limit: z.number().int().min(1).max(20).default(10),
    history: z.boolean().default(false),
    archived: z.boolean().default(false),
    cursors: z
      .object({
        cases: cursor,
        evidence: cursor,
        timeline: z.number().int().min(0).max(5000).default(0),
        hypotheses: cursor,
        runbooks: cursor,
        actions: cursor,
        reviews: cursor,
        reports: cursor,
        exchange: cursor,
      })
      .strict()
      .prefault({}),
  })
  .strict();
export const incidentWorkbenchRecord = z
  .object({
    reference: S.suiteRef,
    name: S.suiteName,
    kind: S.suiteRecord.shape.kind,
    state: S.suiteRecord.shape.state,
    origin: S.suiteRecord.shape.origin,
    sequence: S.suiteRecord.shape.sequence,
    createdAt: z.iso.datetime(),
    format: z.string().max(100).nullable(),
    sourceTrust: z.enum(['local', 'unauthenticated']),
    sourceClaimOnly: z.boolean(),
    localApproval: z.literal(false),
    details: z
      .array(z.object({ label: z.string().min(1).max(60), value: z.string().max(400) }).strict())
      .max(6),
  })
  .strict();
export const incidentWorkbenchDomainPage = z
  .object({
    id: incidentWorkbenchDomain,
    records: z.array(incidentWorkbenchRecord).max(20),
    timelines: z.array(incidentTimelineHeader).max(20),
    next: z.number().int().min(0).max(100000).nullable(),
    total: z.number().int().min(0).max(100000).nullable(),
    error: z.enum(['forbidden', 'unavailable', 'invalid-data']).nullable(),
  })
  .strict()
  .refine((value) => (value.id === 'timeline' ? !value.records.length : !value.timelines.length));
export const incidentWorkbenchCaseScope = z
  .object({
    reference: S.suiteRef,
    name: S.suiteName,
    impact: I.incidentCase.shape.impact,
    severity: I.incidentCase.shape.severity,
    affected: I.incidentCase.shape.affected,
    status: I.incidentCase.shape.status,
    unresolvedCount: z.number().int().min(0).max(100),
    origin: z.literal('local'),
  })
  .strict();
export const incidentWorkbenchProviders = z
  .object({
    actions: z
      .array(
        z
          .object({
            adapter: z.enum(['maintenance-cleanup', 'resilience-reconcile']),
            available: z.boolean(),
          })
          .strict(),
      )
      .length(2),
    captures: z
      .array(z.object({ kind: z.enum(['metrics', 'health']), available: z.boolean() }).strict())
      .length(2),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.actions.map((item) => item.adapter)).size === 2 &&
      new Set(value.captures.map((item) => item.kind)).size === 2,
  );
export const incidentWorkbenchView = z
  .object({
    workspaces: z
      .object({
        items: z.array(S.suiteWorkspace).max(20),
        next: z.number().int().min(0).max(100000).nullable(),
      })
      .strict(),
    workspace: S.suiteWorkspace.nullable(),
    capacity: z
      .object({
        used: z.number().nonnegative(),
        reserved: z.number().nonnegative(),
        limit: z.number().nonnegative(),
        metadataLimit: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    currentCase: incidentWorkbenchCaseScope.nullable(),
    domains: z.array(incidentWorkbenchDomainPage).max(9),
    providers: incidentWorkbenchProviders,
    approvalsTransferred: z.literal(false),
    automaticExecution: z.literal(false),
  })
  .strict();
export type IncidentWorkbenchView = z.infer<typeof incidentWorkbenchView>;
export type IncidentWorkbenchTemplate = z.infer<typeof incidentWorkbenchTemplate>;
export type IncidentWorkbenchRecord = z.infer<typeof incidentWorkbenchRecord>;

/** 时间线的紧凑元数据和固定修订窗口；正文不会隐式跟随最新修订。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { incidentEvent, incidentTimeline } from './incident-desk.ts';

export const incidentTimelinePin = S.suiteScope.extend({ timeline: S.suiteRef }).strict();
export const incidentTimelineHeadersRequest = S.suiteList
  .extend({
    cursor: z.number().int().min(0).max(5000).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const incidentTimelineEventsRequest = incidentTimelinePin
  .extend({
    cursor: z.number().int().min(0).max(100000).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export const incidentTimelineHeader = z
  .object({
    reference: S.suiteRef,
    workspaceId: S.suiteId,
    name: S.suiteName,
    sequence: S.suiteRecord.shape.sequence,
    parent: S.suiteRecord.shape.parent,
    actor: S.suiteId,
    createdAt: z.iso.datetime(),
    state: S.suiteRecord.shape.state,
    origin: S.suiteRecord.shape.origin,
    sourceClaimOnly: z.boolean(),
    policyRevision: S.suiteRecord.shape.policyRevision,
    authorizationDigest: S.suiteDigest.optional(),
    case: S.suiteRef,
    evidenceCount: z.number().int().min(1).max(500),
    eventCount: z.number().int().min(0).max(100000),
    clockNoteCount: z.number().int().min(0).max(500),
    truncatedMessages: incidentTimeline.shape.truncatedMessages,
    unsupportedLines: incidentTimeline.shape.unsupportedLines,
    displayOrder: incidentTimeline.shape.displayOrder,
    crossSourceOrder: incidentTimeline.shape.crossSourceOrder,
  })
  .strict();
export const incidentTimelineHeadersPage = z
  .object({
    items: z.array(incidentTimelineHeader).max(100),
    next: z.number().int().min(0).max(5000).nullable(),
    total: z.number().int().min(0).max(5000),
    history: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
export const incidentTimelineEventPage = z
  .object({
    reference: S.suiteRef,
    origin: S.suiteRecord.shape.origin,
    sourceClaimOnly: z.boolean(),
    items: z.array(incidentEvent).max(200),
    cursor: z.number().int().min(0).max(100000),
    limit: z.number().int().min(1).max(200),
    next: z.number().int().min(0).max(100000).nullable(),
    total: z.number().int().min(0).max(100000),
  })
  .strict();
export type IncidentTimelineHeader = z.infer<typeof incidentTimelineHeader>;
export type IncidentTimelineHeadersPage = z.infer<typeof incidentTimelineHeadersPage>;
export type IncidentTimelineEventPage = z.infer<typeof incidentTimelineEventPage>;

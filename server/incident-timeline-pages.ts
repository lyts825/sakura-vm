/** 在已获准读取的固定对象上投影页面结果；选择元数据行本身不授予正文权限。 */
import type { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { SuiteRecord } from '../shared/contracts/suite-common.ts';
import { incidentEvent, incidentTimeline } from '../shared/contracts/incident-desk.ts';
import * as P from '../shared/contracts/incident-timeline-pages.ts';

const reference = (record: SuiteRecord) => ({
  domain: record.domain,
  id: record.id,
  revision: record.revision,
});
function fail(code: string, message: string): never {
  throw new AppError(message, 400, code);
}
function timeline(record: SuiteRecord) {
  if (record.domain !== 'incident-timeline' || record.kind !== 'result')
    fail('INCIDENT_TIMELINE_REQUIRED', '固定对象不是事件时间线');
  if (!record.content || typeof record.content !== 'object' || Array.isArray(record.content))
    fail('INCIDENT_TIMELINE_REQUIRED', '固定对象不是受支持的事件时间线');
  let content = record.content;
  if (record.origin === 'imported') {
    if (
      content.format !== 'sakura-incident-portable/1' ||
      content.sourceTrust !== 'unauthenticated' ||
      content.approvalsTransferred !== false ||
      content.analysisTrust !== 'source-claim-only' ||
      content.executionAllowed !== false ||
      !content.claims ||
      typeof content.claims !== 'object' ||
      Array.isArray(content.claims)
    )
      fail('INCIDENT_TIMELINE_REQUIRED', '外来时间线不是已隔离接收的来源声明');
    content = content.claims;
  }
  const { events, ...metadata } = content;
  if (!Array.isArray(events) || events.length > 100000)
    fail('INCIDENT_TIMELINE_REQUIRED', '固定时间线的事件条目总数无效');
  // get 已核对整个固定对象摘要；此处只解析元数据，避免为了计数克隆 100,000 条正文。
  // 每次公开的事件窗口再逐项验证，外来记录仍保留 origin=imported 的来源声明。
  const parsed = incidentTimeline.omit({ events: true }).safeParse(metadata);
  if (!parsed.success) fail('INCIDENT_TIMELINE_REQUIRED', '固定对象不是受支持的事件时间线');
  return { ...parsed.data, events };
}
export function timelineHeader(record: SuiteRecord): P.IncidentTimelineHeader {
  const value = timeline(record);
  return P.incidentTimelineHeader.parse({
    reference: reference(record),
    workspaceId: record.workspaceId,
    name: record.name,
    sequence: record.sequence,
    parent: record.parent,
    actor: record.actor,
    createdAt: record.createdAt,
    state: record.state,
    origin: record.origin,
    sourceClaimOnly: record.origin === 'imported',
    policyRevision: record.policyRevision,
    ...(record.authorizationDigest ? { authorizationDigest: record.authorizationDigest } : {}),
    case: value.case,
    evidenceCount: value.evidence.length,
    eventCount: value.events.length,
    clockNoteCount: value.clockNotes.length,
    truncatedMessages: value.truncatedMessages,
    unsupportedLines: value.unsupportedLines,
    displayOrder: value.displayOrder,
    crossSourceOrder: value.crossSourceOrder,
  });
}
export function timelineEvents(
  record: SuiteRecord,
  cursor: number,
  limit: number,
): P.IncidentTimelineEventPage {
  // 纯辅助函数也执行请求边界检查，不能由内部调用绕过公开窗口上限。
  const request = P.incidentTimelineEventsRequest.parse({
    workspaceId: record.workspaceId,
    timeline: reference(record),
    cursor,
    limit,
  });
  const value = timeline(record),
    total = value.events.length;
  if (request.cursor > total) fail('INCIDENT_TIMELINE_CURSOR', '事件窗口起点超出此固定修订的总数');
  const items = value.events.slice(request.cursor, request.cursor + request.limit).map((event) => {
      const parsed = incidentEvent.safeParse(event);
      if (!parsed.success) fail('INCIDENT_TIMELINE_REQUIRED', '固定事件窗口包含不受支持的条目');
      return parsed.data;
    }),
    next = request.cursor + items.length;
  return P.incidentTimelineEventPage.parse({
    reference: reference(record),
    origin: record.origin,
    sourceClaimOnly: record.origin === 'imported',
    items,
    cursor: request.cursor,
    limit: request.limit,
    total,
    next: next < total ? next : null,
  });
}
/** total 为当前账户空间内、按 history/archived 条件筛选后的时间线元数据行数。
 * history=false 时先选择每个 ID 的最新修订；比较结果不会计入时间线。
 * 返回的每一个引用仍须由领域类通过 get 核对摘要、权限和全部强引用。 */
export function selectTimelineHeaders(
  records: readonly SuiteRecord[],
  input: z.infer<typeof P.incidentTimelineHeadersRequest> & { actor: string },
) {
  let rows = records.filter(
    (row) =>
      row.workspaceId === input.workspaceId &&
      row.actor === input.actor &&
      row.domain === 'incident-timeline',
  );
  if (!input.history) {
    const heads = new Map<string, number>();
    for (const row of rows) heads.set(row.id, Math.max(heads.get(row.id) ?? 0, row.sequence));
    rows = rows.filter((row) => heads.get(row.id) === row.sequence);
  }
  if (!input.archived) rows = rows.filter((row) => row.state !== 'archived');
  rows = rows.filter(
    (row) =>
      row.kind === 'result' &&
      row.content &&
      typeof row.content === 'object' &&
      !Array.isArray(row.content) &&
      (row.content.format === 'sakura-incident-timeline/1' ||
        (row.origin === 'imported' &&
          row.content.format === 'sakura-incident-portable/1' &&
          row.content.claims &&
          typeof row.content.claims === 'object' &&
          !Array.isArray(row.content.claims) &&
          row.content.claims.format === 'sakura-incident-timeline/1')),
  );
  if (rows.length > 5000)
    fail('INCIDENT_TIMELINE_LIST_LIMIT', '时间线元数据超过 5000 项，请关闭历史/归档展示，或使用固定引用读取');
  rows.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sequence - a.sequence || a.id.localeCompare(b.id),
  );
  if (input.cursor > rows.length) fail('INCIDENT_TIMELINE_CURSOR', '时间线列表起点超出当前筛选后的总数');
  const selected = rows.slice(input.cursor, input.cursor + input.limit),
    next = input.cursor + selected.length;
  return { references: selected.map(reference), total: rows.length, next: next < rows.length ? next : null };
}

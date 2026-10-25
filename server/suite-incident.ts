/** 事件复盘各对象由所属插件保存，人工判断不提升为系统执行证明。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteRoot, SuiteStore, suiteActor, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { resourceContext } from './host-runtime/context.ts';
import { computeIncident, readSuiteText } from './suite-compute.ts';
import type { IncidentCasesV1, IncidentEvidenceV1, IncidentTimelineV1 } from './service-contracts/incident-desk.ts';
import type { incidentTimelineInput } from './suite-incident-analysis.ts';
import * as TimelinePages from '../shared/contracts/incident-timeline-pages.ts';
import { selectTimelineHeaders, timelineHeader, timelineEvents } from './incident-timeline-pages.ts';

const scope = (input: S.SuiteScope) => ({ workspaceId: input.workspaceId });
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const json = (value: unknown) => S.suiteJson.parse(value);

export class IncidentCases extends SuiteRoot implements IncidentCasesV1 {
  private changes = new Map<string, Promise<unknown>>();
  constructor(metadata: PluginMetadata, authorize: SuiteAuthorize) {
    super('incident-cases', metadata, authorize, 4 * 1024 ** 3);
  }
  private exclusive<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const pending = (this.changes.get(workspaceId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.changes.set(workspaceId, pending);
    void pending.finally(() => {
      if (this.changes.get(workspaceId) === pending) this.changes.delete(workspaceId);
    }).catch(() => {});
    return pending;
  }
  async scope(raw: S.SuiteScope): Promise<S.SuiteRecord> {
    const input = S.suiteScope.parse(raw);
    const record = await this.findCase(input);
    if (!record || record.state !== 'sealed')
      suiteFail('INCIDENT_CASE_NOT_INITIALIZED', '此空间尚未初始化本机案例', 404);
    return this.get({ ...input, id: record.id, revision: record.revision });
  }
  private async findCase(input: S.SuiteScope): Promise<S.SuiteRecord | undefined> {
    await this.access(input);
    const rows = (await this.readState()).rows.filter((row) =>
      row.workspaceId === input.workspaceId && row.actor === suiteActor() && row.origin === 'local' &&
      row.kind === 'result' && row.content && typeof row.content === 'object' &&
      !Array.isArray(row.content) && row.content.format === 'sakura-incident-case/1',
    );
    if (new Set(rows.map((row) => row.id)).size > 1)
      suiteFail('INCIDENT_CASE_MULTIPLE', '此空间存在冲突案例，保留原记录并核对');
    return rows.reduce<S.SuiteRecord | undefined>((head, row) =>
      !head || row.sequence > head.sequence ? row : head, undefined,
    );
  }
  async open(raw: z.infer<typeof I.incidentCaseInput>) {
    const input = I.incidentCaseInput.parse(raw);
    const workspace = input.workspaceId
      ? await this.workspace({ workspaceId: input.workspaceId })
      : await this.createWorkspace({ name: input.name });
    return this.exclusive(workspace.id, async () => {
      const s = { workspaceId: workspace.id };
      const prior = await this.findCase(s);
      if (prior) suiteFail('INCIDENT_CASE_ALREADY_INITIALIZED', '此空间已有案例，请读取原记录');
      const record = await this.put({
        ...s, name: input.name, references: [],
        content: json({
          format: 'sakura-incident-case/1', impact: input.impact, severity: input.severity,
          affected: input.affected, status: 'open', resolution: '', reopenReason: '', unresolved: [],
          declaredBy: suiteActor(), singleOwnerCase: true,
        }),
      }, 'result', true);
      return { workspace, case: record };
    });
  }
  async withOpenCase(raw: S.SuiteScope & { expected: S.SuiteRef }, work: () => Promise<S.SuiteJson>) {
    const input = S.suiteScope.extend({ expected: S.suiteRef }).strict().parse(raw);
    const consumer = resourceContext()?.serviceConsumerPluginInstanceId;
    if (!consumer || !/^official:incident-actions(?::|$)/.test(consumer))
      suiteFail('INCIDENT_ACTION_CONSUMER', '只允许原处置服务取得案例执行窗口', 403);
    return this.exclusive(input.workspaceId, async () => {
      const record = await this.scope(scope(input)), current = I.incidentCase.parse(record.content);
      if (record.id !== input.expected.id || record.revision !== input.expected.revision ||
        input.expected.domain !== this.domain || current.status !== 'open')
        suiteFail('INCIDENT_CASE_CHANGED', '案例状态或修订已变化，请重新预览');
      await this.workspace(scope(input));
      const result = await work();
      await this.workspace(scope(input));
      return result;
    });
  }
  async resolve(raw: z.infer<typeof I.incidentResolve>) {
    const input = I.incidentResolve.parse(raw);
    return this.exclusive(input.workspaceId, async () => {
      const record = await this.scope(scope(input)), value = I.incidentCase.parse(record.content);
      if (record.id !== input.case.id || record.revision !== input.case.revision || input.case.domain !== this.domain)
        suiteFail('INCIDENT_CASE_CHANGED');
      if (value.status !== 'open') suiteFail('INCIDENT_CASE_ALREADY_RESOLVED');
      return this.put({
        ...scope(input), id: record.id, expectedRevision: record.revision, name: record.name,
        references: [], content: json({ ...value, status: 'resolved', resolution: input.reason, unresolved: input.unresolved, declaredBy: suiteActor() }),
      }, 'result', true);
    });
  }
  async reviseScope(raw: z.infer<typeof I.incidentCaseRevision>) {
    const input = I.incidentCaseRevision.parse(raw);
    return this.exclusive(input.workspaceId, async () => {
      const record = await this.scope(scope(input)), value = I.incidentCase.parse(record.content);
      if (record.id !== input.case.id || record.revision !== input.case.revision || input.case.domain !== this.domain)
        suiteFail('INCIDENT_CASE_CHANGED');
      if (value.status !== 'open') suiteFail('INCIDENT_CASE_NOT_OPEN', '先重新打开案例再修改范围');
      return this.put({
        ...scope(input), id: record.id, expectedRevision: record.revision, name: record.name, references: [],
        content: json({ ...value, impact: input.impact, severity: input.severity, affected: input.affected, declaredBy: suiteActor() }),
      }, 'result', true);
    });
  }
  async reopen(raw: Omit<z.infer<typeof I.incidentResolve>, 'unresolved'>) {
    const input = I.incidentResolve.omit({ unresolved: true }).parse(raw);
    return this.exclusive(input.workspaceId, async () => {
      const record = await this.scope(scope(input)), value = I.incidentCase.parse(record.content);
      if (record.id !== input.case.id || record.revision !== input.case.revision || input.case.domain !== this.domain)
        suiteFail('INCIDENT_CASE_CHANGED');
      if (value.status !== 'resolved') suiteFail('INCIDENT_CASE_ALREADY_OPEN');
      return this.put({
        ...scope(input), id: record.id, expectedRevision: record.revision, name: record.name,
        references: [], content: json({ ...value, status: 'open', resolution: '', reopenReason: input.reason, declaredBy: suiteActor() }),
      }, 'result', true);
    });
  }
  override async close() {
    await Promise.allSettled([...this.changes.values()]);
    await super.close();
  }
}

export { IncidentEvidence } from './suite-incident-evidence.ts';

export class IncidentTimeline extends SuiteStore {
  constructor(metadata: PluginMetadata, authorize: SuiteAuthorize, private cases: IncidentCasesV1, private evidence: IncidentEvidenceV1) {
    super('incident-timeline', metadata, authorize, cases, { 'incident-cases': cases, 'incident-evidence': evidence });
  }
  async head(raw: z.infer<typeof TimelinePages.incidentTimelinePin>): Promise<TimelinePages.IncidentTimelineHeader> {
    const input = TimelinePages.incidentTimelinePin.parse(raw);
    if (input.timeline.domain !== this.domain) suiteFail('INCIDENT_TIMELINE_REQUIRED', '固定对象不是事件时间线', 400);
    return timelineHeader(await this.get({ ...scope(input), id: input.timeline.id, revision: input.timeline.revision }));
  }
  async headers(raw: z.input<typeof TimelinePages.incidentTimelineHeadersRequest>): Promise<TimelinePages.IncidentTimelineHeadersPage> {
    const input = TimelinePages.incidentTimelineHeadersRequest.parse(raw), s = scope(input);
    await this.access(s);
    // 单次读取元数据用于计数和选择，避免为了总数反复解析所有大正文。
    const selected = selectTimelineHeaders((await this.readState()).rows, { ...input, actor: suiteActor() });
    const items: TimelinePages.IncidentTimelineHeader[] = [];
    for (const reference of selected.references)
      items.push(timelineHeader(await this.get({ ...s, id: reference.id, revision: reference.revision })));
    await this.access(s);
    return TimelinePages.incidentTimelineHeadersPage.parse({ items, next: selected.next, total: selected.total,
      history: input.history, archived: input.archived });
  }
  async events(raw: z.input<typeof TimelinePages.incidentTimelineEventsRequest>): Promise<TimelinePages.IncidentTimelineEventPage> {
    const input = TimelinePages.incidentTimelineEventsRequest.parse(raw);
    if (input.timeline.domain !== this.domain) suiteFail('INCIDENT_TIMELINE_REQUIRED', '固定对象不是事件时间线', 400);
    const record = await this.get({ ...scope(input), id: input.timeline.id, revision: input.timeline.revision });
    return timelineEvents(record, input.cursor, input.limit);
  }
  async assemble(raw: z.infer<typeof I.incidentAssemble>) {
    const input = I.incidentAssemble.parse(raw), s = scope(input), c = await this.cases.scope(s);
    if (new Set(input.evidence.map((reference) => JSON.stringify(reference))).size !== input.evidence.length)
      suiteFail('INCIDENT_EVIDENCE_DUPLICATE');
    const fixed: { reference: S.SuiteRef; evidence: z.infer<typeof I.incidentEvidence> }[] = [];
    let total = 0;
    for (const reference of input.evidence) {
      const row = await this.fixed(s, reference), value = I.incidentEvidence.parse(row.content);
      if (value.case.id !== c.id || value.case.domain !== c.domain) suiteFail('INCIDENT_CASE_MISMATCH');
      const source = await this.evidence.get({ ...s, id: value.source.id, revision: value.source.revision }),
        material = S.suiteMaterial.parse(source.content);
      if (value.source.domain !== 'incident-evidence' || material.digest !== value.sourceDigest)
        suiteFail('INCIDENT_EVIDENCE_SOURCE');
      total += material.bytes;
      if (total > 32 * 1024 ** 2) suiteFail('INCIDENT_TIMELINE_BYTES', '一次整理的原文总额最多 32 MiB，请选择窗口');
      fixed.push({ reference, evidence: value });
    }
    const content = await computeIncident<z.infer<typeof I.incidentTimeline>>(this.domain, 'timeline', async () => {
      const sources: z.infer<typeof incidentTimelineInput>['sources'] = [];
      for (const item of fixed) {
        const material = await readSuiteText(this.evidence, s, item.evidence.source);
        if (!['text', 'json'].includes(material.format)) suiteFail('INCIDENT_EVIDENCE_SOURCE');
        sources.push({ ...material, format: material.format as 'text' | 'json', evidence: item.reference, sourceAt: item.evidence.sourceAt, observedAt: item.evidence.observedAt });
      }
      return { case: ref(c), sources };
    });
    return this.put({
      ...s, name: '固定事件时间线', content: json(content), references: [ref(c), ...input.evidence],
    }, 'result', true);
  }
  async annotateClock(raw: S.SuiteScope & { timeline: S.SuiteRef; note: z.infer<typeof I.incidentClockNote> }) {
    const input = S.suiteScope.extend({ timeline: S.suiteRef, note: I.incidentClockNote }).strict().parse(raw),
      row = await this.fixed(scope(input), input.timeline), value = I.incidentTimeline.parse(row.content);
    if (!value.evidence.some((r) => JSON.stringify(r) === JSON.stringify(input.note.evidence)))
      suiteFail('INCIDENT_CLOCK_EVIDENCE');
    return this.put({
      ...scope(input), name: '时间线 · 人工时钟注释', references: [input.timeline],
      content: json({ ...value, clockNotes: [...value.clockNotes.filter((note) => JSON.stringify(note.evidence) !== JSON.stringify(input.note.evidence)), input.note] }),
    }, 'result', true);
  }
  async compare(raw: S.SuiteScope & { before: S.SuiteRef; after: S.SuiteRef }) {
    const input = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict().parse(raw),
      before = I.incidentTimeline.parse((await this.fixed(scope(input), input.before)).content),
      after = I.incidentTimeline.parse((await this.fixed(scope(input), input.after)).content);
    if (before.case.id !== after.case.id) suiteFail('INCIDENT_CASE_MISMATCH');
    const old = new Set(before.events.map((event) => event.id)), next = new Set(after.events.map((event) => event.id));
    return this.put({
      ...scope(input), name: '时间线比较', references: [input.before, input.after],
      content: json({ added: after.events.filter((event) => !old.has(event.id)).map((event) => event.id),
        removed: before.events.filter((event) => !next.has(event.id)).map((event) => event.id),
        clockAnnotationsChanged: JSON.stringify(before.clockNotes) !== JSON.stringify(after.clockNotes),
        crossSourceOrder: 'uncertain', causalConclusion: null }),
    }, 'result', true);
  }
}

export class IncidentHypotheses extends SuiteStore {
  constructor(metadata: PluginMetadata, authorize: SuiteAuthorize, private cases: IncidentCasesV1, timeline: IncidentTimelineV1, evidence: IncidentEvidenceV1) {
    super('incident-hypotheses', metadata, authorize, cases, { 'incident-cases': cases, 'incident-timeline': timeline, 'incident-evidence': evidence });
  }
  async propose(raw: z.infer<typeof I.incidentHypothesisInput>) {
    const input = I.incidentHypothesisInput.parse(raw), s = scope(input), c = await this.cases.scope(s),
      timeline = I.incidentTimeline.parse((await this.fixed(s, input.timeline)).content);
    if (timeline.case.id !== c.id) suiteFail('INCIDENT_CASE_MISMATCH');
    const prior = input.hypothesis ? await this.fixed(s, input.hypothesis) : undefined;
    if (prior && (prior.domain !== this.domain || I.incidentHypothesis.parse(prior.content).case.id !== c.id))
      suiteFail('INCIDENT_CASE_MISMATCH');
    return this.put({
      ...s, ...(prior ? { id: prior.id, expectedRevision: prior.revision } : {}),
      name: input.title, references: [ref(c), input.timeline],
      content: json(I.incidentHypothesis.parse({
        format: 'sakura-incident-hypothesis/1', case: ref(c), timeline: input.timeline,
        explanation: input.explanation, pending: input.pending, support: [], against: [],
        status: 'open', reason: '', judgment: 'manual', decidedBy: null,
      })),
    }, 'result', true);
  }
  async linkEvidence(raw: S.SuiteScope & { hypothesis: S.SuiteRef; support: string[]; against: string[] }) {
    const input = S.suiteScope.extend({ hypothesis: S.suiteRef, support: z.array(S.suiteDigest).max(500), against: z.array(S.suiteDigest).max(500) }).strict().parse(raw),
      row = await this.fixed(scope(input), input.hypothesis), value = I.incidentHypothesis.parse(row.content),
      timeline = I.incidentTimeline.parse((await this.fixed(scope(input), value.timeline)).content),
      ids = new Set(timeline.events.map((event) => event.id)), supplied = [...input.support, ...input.against];
    if (row.domain !== this.domain || supplied.some((id) => !ids.has(id)) || new Set(supplied).size !== supplied.length)
      suiteFail('INCIDENT_EVENT_REFERENCE', '支持或相反依据必须是固定时间线中的不同事件');
    return this.put({
      ...scope(input), id: row.id, expectedRevision: row.revision, name: row.name, references: row.references,
      content: json({ ...value, support: input.support, against: input.against, status: 'open', reason: '', decidedBy: null }),
    }, 'result', true);
  }
  async decide(raw: S.SuiteScope & { hypothesis: S.SuiteRef; status: 'supported' | 'contradicted' | 'unresolved'; reason: string }) {
    const input = S.suiteScope.extend({ hypothesis: S.suiteRef, status: z.enum(['supported', 'contradicted', 'unresolved']), reason: I.incidentText }).strict().parse(raw),
      row = await this.fixed(scope(input), input.hypothesis), value = I.incidentHypothesis.parse(row.content);
    if (row.domain !== this.domain || (input.status === 'supported' && !value.support.length) ||
      (input.status === 'contradicted' && !value.against.length))
      suiteFail('INCIDENT_JUDGMENT_EVIDENCE', '人工判断须保留对应的支持或相反依据');
    return this.put({
      ...scope(input), id: row.id, expectedRevision: row.revision, name: row.name, references: row.references,
      content: json({ ...value, status: input.status, reason: input.reason, decidedBy: suiteActor() }),
    }, 'result', true);
  }
}

export class IncidentRunbooks extends SuiteStore {
  constructor(metadata: PluginMetadata, authorize: SuiteAuthorize, private cases: IncidentCasesV1) {
    super('incident-runbooks', metadata, authorize, cases, { 'incident-cases': cases });
  }
  async compile(raw: z.infer<typeof I.incidentRunbookInput>) {
    const input = I.incidentRunbookInput.parse(raw), s = scope(input), c = await this.cases.scope(s);
    if (new Set(input.steps.map((step) => step.id)).size !== input.steps.length)
      suiteFail('INCIDENT_STEP_DUPLICATE');
    const prior = input.runbook ? await this.fixed(s, input.runbook) : undefined;
    if (prior && (prior.domain !== this.domain || I.incidentRunbook.parse(prior.content).case.id !== c.id))
      suiteFail('INCIDENT_CASE_MISMATCH');
    return this.put({
      ...s, ...(prior ? { id: prior.id, expectedRevision: prior.revision } : {}), name: input.name,
      references: [ref(c)],
      content: json(I.incidentRunbook.parse({ format: 'sakura-incident-runbook/1', case: ref(c), steps: input.steps })),
    }, 'result', true);
  }
  async previewSteps(raw: S.SuiteScope & { runbook: S.SuiteRef }) {
    const input = S.suiteScope.extend({ runbook: S.suiteRef }).strict().parse(raw),
      value = I.incidentRunbook.parse((await this.fixed(scope(input), input.runbook)).content);
    return this.put({
      ...scope(input), name: '固定步骤预览', references: [input.runbook],
      content: json({ format: 'sakura-incident-runbook-preview/1', runbook: input.runbook, steps: value.steps,
        total: value.steps.length, executed: false, requiresPerActionApproval: true }),
    }, 'result', true);
  }
}

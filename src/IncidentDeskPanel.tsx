/** 固定修订上的事件复盘；主视图只读取有界摘要，时间线正文始终按页读取。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Request } from './feature-shared';
import * as S from '../shared/contracts/suite-common';
import * as I from '../shared/contracts/incident-desk';
import * as R from '../shared/contracts/incident-reviews';
import type * as W from '../shared/contracts/incident-workbench';
import type * as P from '../shared/contracts/incident-timeline-pages';
import type { SuiteHostCapacity } from '../shared/contracts/suite-capacity';
import { incidentHttpSchemas } from '../shared/contracts/incident-http';
import {
  useSuiteClient,
  suiteReference as ref,
  suiteReferenceKey as key,
  suiteBase64,
  suiteUnbase64,
  suiteDigest,
} from './suite-client';
import { SuiteRecordSelect } from './SuiteRecordSelect';
import { SuitePlanDialog } from './SuitePlanDialog';
import { SuiteExchangePanel } from './SuiteExchangePanel';
import { SuitePublicationRecoveryPanel } from './SuitePublicationRecoveryPanel';
import { SuiteHostCapacityStatus } from './SuiteHostCapacityStatus';
import './suite-workbench.css';

const titles = {
  cases: '案例',
  evidence: '证据材料',
  timeline: '固定时间线',
  hypotheses: '人工假设',
  runbooks: '固定步骤',
  actions: '处置记录',
  reviews: '复盘审阅',
  reports: '复盘报告',
  exchange: '脱敏交接',
} as const;
type Domain = keyof typeof titles;
const tabs = ['案例与材料', '时间线', '假设与处置', '审阅与报告', '脱敏交接', '历史与恢复'] as const;
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const aborted = () => new DOMException('会话已变化', 'AbortError');
const permissionError = (error: unknown) => {
  const value = error as { status?: number; code?: string };
  return (
    [401, 403].includes(value.status ?? 0) ||
    /DENIED|REVOK|PERMISSION|FORBIDDEN|POLICY_CHANGED/.test(value.code ?? '')
  );
};
const message = (error: unknown) => (error instanceof Error ? error.message : '操作失败');
const body = (row?: S.SuiteRecord) =>
  row?.content && typeof row.content === 'object' && !Array.isArray(row.content) ? row.content : null;
const displayContent = (row?: S.SuiteRecord) =>
  body(row)?.format === 'sakura-incident-portable/1' ? body(row)?.claims : row?.content;
const local = (row?: S.SuiteRecord) =>
  row?.origin === 'local' && body(row)?.format !== 'sakura-incident-portable/1';
type Option = {
  reference: S.SuiteRef;
  name: string;
  origin: 'local' | 'imported';
  state: S.SuiteRecord['state'];
  kind: S.SuiteRecord['kind'];
};
function RefSelect({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {title}
      <select aria-label={title} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">选择固定修订</option>
        {options.map((option) => (
          <option key={key(option.reference)} value={key(option.reference)}>
            {option.name} · {option.reference.revision.slice(0, 8)}
            {option.origin === 'imported' ? ' · 外来声明' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
function RefChecks({
  title,
  options,
  values,
  onChange,
}: {
  title: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>{title}</legend>
      {options.map((option) => (
        <label className="suite-check" key={key(option.reference)}>
          <input
            type="checkbox"
            checked={values.includes(key(option.reference))}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, key(option.reference)]
                  : values.filter((value) => value !== key(option.reference)),
              )
            }
          />
          {option.name} · {option.reference.revision.slice(0, 8)}
          {option.origin === 'imported' ? ' · 外来声明' : ''}
        </label>
      ))}
    </fieldset>
  );
}

export function IncidentDeskPanel({
  request,
  accessEpoch,
  authorized = true,
}: {
  request: Request;
  accessEpoch?: string;
  authorized?: boolean;
}) {
  const epoch = useMemo(() => crypto.randomUUID(), [request, accessEpoch]);
  return authorized ? <IncidentSpaces key={epoch} request={request} /> : <p>请解锁会话后读取事件材料。</p>;
}
function IncidentSpaces({ request }: { request: Request }) {
  const call = useSuiteClient(request, 'incident', incidentHttpSchemas),
    alive = useRef(true),
    sequence = useRef(0);
  const [view, setView] = useState<W.IncidentWorkbenchView>(),
    [templates, setTemplates] = useState<W.IncidentWorkbenchTemplate[]>([]),
    [workspaceId, setWorkspaceId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [draft, setDraft] = useState({ name: '', impact: '', severity: 'moderate', affected: '' });
  const run = async (work: () => Promise<void>) => {
    const current = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      if (alive.current && current === sequence.current && (error as Error).name !== 'AbortError') {
        setError(message(error));
        if (permissionError(error)) {
          setView(undefined);
          setTemplates([]);
          setWorkspaceId('');
          setDraft({ name: '', impact: '', severity: 'moderate', affected: '' });
        }
      }
    } finally {
      if (alive.current && current === sequence.current) setBusy(false);
    }
  };
  const invoke = async <T,>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const result = await call<T>(domain, method, input);
    if (!alive.current) throw aborted();
    return result;
  };
  const reload = async (cursor = 0) => {
    const next = await invoke<W.IncidentWorkbenchView>('workbench', 'view', {
      workspaceCursor: cursor,
      limit: 20,
    });
    setView(next);
  };
  useEffect(() => {
    alive.current = true;
    void run(async () => {
      const values = await invoke<W.IncidentWorkbenchTemplate[]>('workbench', 'templates');
      setTemplates(values);
      await reload();
    });
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  return (
    <main className="suite-workbench">
      <header>
        <div>
          <small>INCIDENT DESK</small>
          <h1>事件复盘</h1>
          <p>保留实际材料，区分来源事实、人工解释与原提供者回执，在固定窗口上审阅和交接。</p>
        </div>
        <span className="suite-chip">人工审阅 · 有界时间线</span>
      </header>
      {error && (
        <p role="alert" className="suite-error">
          {error}
        </p>
      )}
      <section className="suite-space">
        <label>
          案例空间
          <select
            aria-label="案例空间"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            <option value="">选择空间</option>
            {view?.workspaces.items.map((space) => (
              <option key={space.id} value={space.id} disabled={space.revoked}>
                {space.name}
                {space.revoked ? ' · 许可已撤销' : ''}
              </option>
            ))}
          </select>
        </label>
        <button disabled={busy} onClick={() => void run(() => reload())}>
          刷新空间
        </button>
        {view?.workspaces.next !== null && view?.workspaces.next !== undefined && (
          <button disabled={busy} onClick={() => void run(() => reload(view.workspaces.next!))}>
            后续空间
          </button>
        )}
      </section>
      <details>
        <summary>从模板或实际影响开立案例</summary>
        <fieldset disabled={busy}>
          <p>模板只填写建议；请改为实际影响。开立不会采集证据或执行处置。</p>
          <div className="suite-toolbar">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setDraft({ ...template.open, affected: template.open.affected.join('\n') })}
              >
                {template.name}
              </button>
            ))}
          </div>
          <label>
            案例名称
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              maxLength={160}
            />
          </label>
          <label>
            实际影响
            <textarea
              value={draft.impact}
              onChange={(event) => setDraft({ ...draft, impact: event.target.value })}
              maxLength={4000}
            />
          </label>
          <label>
            严重程度
            <select
              value={draft.severity}
              onChange={(event) => setDraft({ ...draft, severity: event.target.value })}
            >
              {['low', 'moderate', 'high', 'critical'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            受影响对象，每行一项
            <textarea
              value={draft.affected}
              onChange={(event) => setDraft({ ...draft, affected: event.target.value })}
            />
          </label>
          <button
            disabled={!draft.name.trim() || !draft.impact.trim()}
            onClick={() =>
              void run(async () => {
                const opened = await invoke<{ workspace: S.SuiteWorkspace; case: S.SuiteRecord }>(
                  'cases',
                  'open',
                  { ...draft, affected: lines(draft.affected) },
                );
                await reload();
                setWorkspaceId(opened.workspace.id);
              })
            }
          >
            开立实际案例
          </button>
          {templates.map((template) => (
            <details key={template.id}>
              <summary>{template.name}的建议步骤</summary>
              <p>{template.description}</p>
              <ol>
                {template.steps.map((step, index) => (
                  <li key={index}>{step.instruction}</li>
                ))}
              </ol>
            </details>
          ))}
        </fieldset>
      </details>
      {workspaceId && (
        <IncidentWorkspace
          key={workspaceId}
          request={request}
          workspaceId={workspaceId}
          onSpacesChanged={reload}
          onDenied={(error) => {
            setWorkspaceId('');
            setView(undefined);
            setTemplates([]);
            setDraft({ name: '', impact: '', severity: 'moderate', affected: '' });
            setError(message(error));
          }}
        />
      )}
    </main>
  );
}

type StepDraft = {
  id: string;
  label: string;
  kind: 'manual' | 'query' | 'maintenance-cleanup' | 'resilience-reconcile';
  instruction: string;
  query: 'evidence' | 'timeline' | 'hypotheses';
  provider: 'job-logs' | 'backup-blocks';
  runId: string;
  workspace: string;
};
const emptyStep = (): StepDraft => ({
  id: crypto.randomUUID(),
  label: '',
  kind: 'manual',
  instruction: '',
  query: 'evidence',
  provider: 'job-logs',
  runId: '',
  workspace: 'default',
});
function IncidentWorkspace({
  request,
  workspaceId,
  onSpacesChanged,
  onDenied,
}: {
  request: Request;
  workspaceId: string;
  onSpacesChanged: () => Promise<void>;
  onDenied: (error: unknown) => void;
}) {
  const call = useSuiteClient(request, 'incident', incidentHttpSchemas),
    scope = { workspaceId },
    alive = useRef(true),
    pending = useRef(false),
    operation = useRef(0),
    known = useRef(new Map<string, Option>()),
    historyMode = useRef(false);
  const [view, setView] = useState<W.IncidentWorkbenchView>(),
    [hostCapacity, setHostCapacity] = useState<SuiteHostCapacity>(),
    [tab, setTab] = useState<(typeof tabs)[number]>('案例与材料'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loaded, setLoaded] = useState<S.SuiteRecord[]>([]),
    [plan, setPlan] = useState<{ domain: string; action: string; value: S.SuitePlan }>(),
    [selected, setSelected] = useState<Partial<Record<Domain, string>>>({}),
    [evidenceKeys, setEvidenceKeys] = useState<string[]>([]),
    [hypothesisKeys, setHypothesisKeys] = useState<string[]>([]),
    [actionKeys, setActionKeys] = useState<string[]>([]),
    [events, setEvents] = useState<P.IncidentTimelineEventPage>(),
    [support, setSupport] = useState<string[]>([]),
    [against, setAgainst] = useState<string[]>([]),
    [hypothesisDraft, setHypothesisDraft] = useState<{
      hypothesis: S.SuiteRef;
      timeline: S.SuiteRef;
    }>(),
    [transfers, setTransfers] = useState<S.SuiteUpload[]>([]),
    [inspection, setInspection] = useState<{
      available: boolean;
      status: string;
      result: S.SuiteJson;
      error: string | null;
    }>(),
    [reviewCheck, setReviewCheck] = useState<R.IncidentReviewCheck>(),
    [steps, setSteps] = useState<StepDraft[]>([emptyStep()]),
    [stepId, setStepId] = useState(''),
    [file, setFile] = useState<File>(),
    [read, setRead] = useState<{
      evidence: S.SuiteRef;
      source: S.SuiteRef;
      policyRevision: number;
      digest: string;
      text: string;
      bytes: number;
    }>(),
    [readAcknowledged, setReadAcknowledged] = useState(false),
    [maskKeys, setMaskKeys] = useState<string[]>(['password', 'token', 'authorization', 'secret', 'email']),
    [checklist, setChecklist] = useState<ReturnType<typeof R.incidentReviewChecklist.parse>>({
      selectedScope: false,
      factsAndClaims: false,
      clockUncertainty: false,
      manualInferences: false,
      actionReceipts: false,
      unresolvedItems: false,
    }),
    [historyDomain, setHistoryDomain] = useState<Domain>('evidence'),
    [cleanupKeys, setCleanupKeys] = useState<string[]>([]);
  const [form, setForm] = useState({
    name: '',
    text: '',
    format: 'text',
    observedAt: '',
    captureKind: 'metrics',
    vmId: '',
    literals: '',
    redactionReason: '',
    clockOffset: '0',
    clockReason: '',
    title: '',
    explanation: '',
    pending: '',
    judgment: 'unresolved',
    judgmentReason: '',
    runbookName: '',
    manualName: '',
    manualStatement: '',
    acknowledgeReason: '',
    caseReason: '',
    unresolved: '',
    reviewName: '',
    reviewReason: '',
    reportTitle: '',
    summary: '',
    facts: '',
    inferences: '',
    measures: '',
    followUp: '',
    recoveryPlan: '',
  });
  const edit = (name: keyof typeof form, value: string) =>
    setForm((previous) => ({ ...previous, [name]: value }));
  const invoke = async <T,>(domain: string, method: string, input: unknown = {}): Promise<T> => {
    const result = await call<T>(domain, method, input);
    if (!alive.current) throw aborted();
    return result;
  };
  const refresh = async (cursors: Partial<Record<Domain, number>> = {}) => {
    const [result, nextHostCapacity] = await Promise.all([
      invoke<W.IncidentWorkbenchView>('workbench', 'view', {
        ...scope,
        limit: 20,
        cursors,
        history: historyMode.current,
        archived: historyMode.current,
      }),
      invoke<SuiteHostCapacity>('cases', 'hostCapacity', scope),
    ]);
    if (!alive.current) throw aborted();
    for (const page of result.domains) {
      for (const row of page.records)
        known.current.set(key(row.reference), {
          reference: row.reference,
          name: row.name,
          origin: row.origin,
          state: row.state,
          kind: row.kind,
        });
      for (const row of page.timelines)
        known.current.set(key(row.reference), {
          reference: row.reference,
          name: row.name,
          origin: row.origin,
          state: row.state,
          kind: 'result',
        });
    }
    while (known.current.size > 1000) known.current.delete(known.current.keys().next().value!);
    setView(result);
    setHostCapacity(nextHostCapacity);
  };
  const run = async (work: () => Promise<unknown>, success = '已完成请求', refreshAfter = true) => {
    if (pending.current || !alive.current) return;
    const current = ++operation.current;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (!alive.current || current !== operation.current) return;
      if (refreshAfter) await refresh();
      if (alive.current && current === operation.current) setNotice(success);
    } catch (error) {
      if (alive.current && current === operation.current && (error as Error).name !== 'AbortError') {
        setError(message(error));
        setPlan(undefined);
        if (permissionError(error)) {
          setView(undefined);
          setHostCapacity(undefined);
          setLoaded([]);
          setEvents(undefined);
          setRead(undefined);
          setReadAcknowledged(false);
          setInspection(undefined);
          setReviewCheck(undefined);
          setTransfers([]);
          setSelected({});
          setSupport([]);
          setAgainst([]);
          setHypothesisDraft(undefined);
          known.current.clear();
          onDenied(error);
        }
      }
    } finally {
      if (current === operation.current) {
        pending.current = false;
        if (alive.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void run(refresh, '已读取当前案例摘要', false);
    return () => {
      alive.current = false;
      operation.current++;
      pending.current = false;
    };
  }, []);
  const options = (domain: Domain): Option[] => {
    const page = view?.domains.find((value) => value.id === domain);
    const values: Option[] =
      domain === 'timeline'
        ? (page?.timelines ?? []).map((header) => ({
            reference: header.reference,
            name: header.name,
            origin: header.origin,
            state: header.state,
            kind: 'result',
          }))
        : (page?.records ?? []).map((row) => ({
            reference: row.reference,
            name: row.name,
            origin: row.origin,
            state: row.state,
            kind: row.kind,
          }));
    const current = selected[domain] ? known.current.get(selected[domain]!) : undefined;
    return current && !values.some((row) => key(row.reference) === key(current.reference))
      ? [current, ...values]
      : values;
  };
  const nativeOptions = (domain: Domain) =>
    options(domain).filter(
      (row) => row.origin === 'local' && row.state === 'sealed' && row.kind !== 'source',
    );
  const choose = (domain: Domain, value = selected[domain]): S.SuiteRef => {
    const option = options(domain).find((row) => key(row.reference) === value),
      cached = loaded.find((row) => row.domain === 'incident-' + domain && key(row) === value);
    if (option) return option.reference;
    if (cached) return ref(cached);
    const prior = value ? known.current.get(value) : undefined;
    if (prior?.reference.domain === 'incident-' + domain) return prior.reference;
    throw new Error('请先选择固定修订');
  };
  const fixed = (domain: Domain) => loaded.find((row) => key(row) === selected[domain]);
  const select = (domain: Domain, value: string) => {
    setSelected((previous) => ({ ...previous, [domain]: value }));
    setPlan(undefined);
    if (domain === 'evidence') {
      setRead(undefined);
      setReadAcknowledged(false);
    }
    if (domain === 'timeline') {
      setEvents(undefined);
    }
    if (domain === 'timeline' || domain === 'hypotheses') {
      setSupport([]);
      setAgainst([]);
      setHypothesisDraft(undefined);
    }
    if (domain === 'actions') setInspection(undefined);
    if (domain === 'reviews') {
      setReviewCheck(undefined);
      setChecklist({
        selectedScope: false,
        factsAndClaims: false,
        clockUncertainty: false,
        manualInferences: false,
        actionReceipts: false,
        unresolvedItems: false,
      });
    }
  };
  const remember = (row: S.SuiteRecord, domain: Domain) => {
    known.current.set(key(row), {
      reference: ref(row),
      name: row.name,
      origin: row.origin,
      state: row.state,
      kind: row.kind,
    });
    if (domain === 'timeline') return;
    setLoaded((previous) => [...previous.filter((old) => key(old) !== key(row)), row].slice(-40));
    select(domain, key(row));
  };
  const load = async (domain: Domain) => {
    if (domain === 'timeline') throw new Error('时间线仅允许读取元数据和事件页');
    const reference = choose(domain),
      row = await invoke<S.SuiteRecord>(domain, 'get', {
        ...scope,
        id: reference.id,
        revision: reference.revision,
      });
    remember(row, domain);
    if (domain === 'hypotheses' && local(row)) {
      const value = I.incidentHypothesis.parse(row.content),
        timelineKey = key(value.timeline);
      if (!known.current.has(timelineKey))
        known.current.set(timelineKey, {
          reference: value.timeline,
          name: '假设引用的固定时间线',
          origin: 'local',
          state: 'sealed',
          kind: 'result',
        });
      if (selected.timeline !== timelineKey) select('timeline', timelineKey);
      setSupport(value.support);
      setAgainst(value.against);
      setHypothesisDraft({ hypothesis: ref(row), timeline: value.timeline });
    }
  };
  const store = async (domain: Domain, method: string, input: unknown) => {
    const row = await invoke<S.SuiteRecord>(domain, method, input);
    known.current.set(key(row), {
      reference: ref(row),
      name: row.name,
      origin: row.origin,
      state: row.state,
      kind: row.kind,
    });
    if (domain === 'timeline') select(domain, key(row));
    else remember(row, domain);
    return row;
  };
  const preview = async (domain: string, action: string, input: unknown, apply: string) => {
    const value = await invoke<S.SuitePlan>(domain, action, input);
    setPlan({ domain, action: apply, value });
  };
  const approval = () =>
    run(async () => {
      if (!plan) return;
      await invoke(plan.domain, plan.action, { ...scope, planId: plan.value.id, digest: plan.value.digest });
      setPlan(undefined);
      setRead(undefined);
      setReadAcknowledged(false);
      setLoaded([]);
      setReviewCheck(undefined);
      await onSpacesChanged();
    }, '固定计划已提交；请重新读取结果和当前状态');
  const evidence = fixed('evidence'),
    hypothesis = fixed('hypotheses'),
    runbook = fixed('runbooks'),
    action = fixed('actions'),
    review = fixed('reviews'),
    report = fixed('reports');
  const evidenceValue = I.incidentEvidence.safeParse(evidence?.content),
    hypothesisValue = I.incidentHypothesis.safeParse(displayContent(hypothesis)),
    runbookValue = I.incidentRunbook.safeParse(runbook?.content),
    reviewValue = R.incidentReview.safeParse(displayContent(review)),
    reportValue = R.incidentReport.safeParse(displayContent(report));
  const evidenceClaim = displayContent(evidence),
    evidenceObject =
      evidenceClaim && typeof evidenceClaim === 'object' && !Array.isArray(evidenceClaim)
        ? evidenceClaim
        : null,
    readSource = S.suiteRef.safeParse(evidenceObject?.source),
    readDigest = S.suiteDigest.safeParse(evidenceObject?.sourceDigest);
  const canWrite = !!view?.currentCase,
    openCase = canWrite && view?.currentCase?.status === 'open',
    editableEventWindow =
      !!hypothesisDraft &&
      key(hypothesisDraft.hypothesis) === selected.hypotheses &&
      key(hypothesisDraft.timeline) === selected.timeline &&
      !!events &&
      !events.sourceClaimOnly &&
      key(events.reference) === key(hypothesisDraft.timeline);
  const selectedRefs = (domain: Domain, keys: string[]) => keys.map((value) => choose(domain, value));
  const eventPage = async (cursor = 0) => {
    const timeline = choose('timeline');
    setEvents(
      await invoke<P.IncidentTimelineEventPage>('timeline', 'events', {
        ...scope,
        timeline,
        cursor,
        limit: 100,
      }),
    );
  };
  const readFull = async () => {
    setRead(undefined);
    setReadAcknowledged(false);
    if (
      !evidence ||
      !readSource.success ||
      !readDigest.success ||
      readSource.data.domain !== 'incident-evidence'
    )
      throw new Error('请先读取固定证据记录');
    const source = readSource.data,
      metadata = await invoke<S.SuiteRecord>('evidence', 'get', {
        ...scope,
        id: source.id,
        revision: source.revision,
      }),
      material = S.suiteMaterial.parse(metadata.content);
    if (material.bytes > 8 * 1024 ** 2) throw new Error('全文核对最多 8 MiB，请先生成较小的脱敏窗口');
    const policy = await invoke<{ allowRead: boolean; allowExport: boolean; revision: number }>(
      'evidence',
      'policy',
      { ...scope, id: source.id, revision: source.revision },
    );
    const lease = await invoke<S.SuiteReadLease>('evidence', 'openRead', {
        ...scope,
        id: source.id,
        revision: source.revision,
        purpose: 'read',
      }),
      parts: Uint8Array[] = [];
    let offset = 0;
    try {
      do {
        const chunk = await invoke<{ data: string; offset: number; eof: boolean }>('evidence', 'readLease', {
            ...scope,
            id: lease.id,
            offset,
            length: Math.min(512 * 1024, Math.max(1, material.bytes - offset)),
          }),
          bytes = suiteUnbase64(chunk.data);
        if (
          chunk.offset !== offset + bytes.length ||
          (!chunk.eof && !bytes.length) ||
          chunk.offset > material.bytes
        )
          throw new Error('全文读取回执无效');
        parts.push(bytes);
        offset = chunk.offset;
        if (chunk.eof) break;
      } while (offset <= material.bytes);
    } finally {
      if (alive.current) await invoke('evidence', 'closeRead', { ...scope, id: lease.id });
    }
    const bytes = new Uint8Array(offset);
    let position = 0;
    for (const part of parts) {
      bytes.set(part, position);
      position += part.length;
    }
    const digest = await suiteDigest(bytes),
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      encoded = new TextEncoder().encode(text);
    if (
      offset !== material.bytes ||
      digest !== material.digest ||
      digest !== readDigest.data ||
      encoded.length !== bytes.length ||
      encoded.some((value, index) => value !== bytes[index])
    )
      throw new Error('全文摘要或 UTF-8 字节不同');
    const current = await invoke<typeof policy>('evidence', 'policy', {
      ...scope,
      id: source.id,
      revision: source.revision,
    });
    if (!current.allowRead || current.revision !== policy.revision)
      throw new Error('全文读取期间许可已变化，请重新读取');
    if (!alive.current) throw aborted();
    setRead({
      evidence: ref(evidence!),
      source,
      policyRevision: current.revision,
      digest,
      text,
      bytes: bytes.length,
    });
  };
  const upload = async () => {
    if (!file) {
      await store('evidence', 'upload', {
        ...scope,
        name: form.name,
        text: form.text,
        format: form.format,
        allowExport: false,
      });
      return;
    }
    if (file.size > 32 * 1024 ** 2) throw new Error('单次文件上传最多 32 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!alive.current) throw aborted();
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const upload = await invoke<S.SuiteUpload>('evidence', 'beginUpload', {
      ...scope,
      name: form.name || file.name,
      format: form.format,
      bytes: bytes.length,
      digest: await suiteDigest(bytes),
      allowExport: false,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await invoke('evidence', 'appendUpload', {
        ...scope,
        id: upload.id,
        offset,
        data: suiteBase64(bytes.subarray(offset, offset + 512 * 1024)),
      });
    const source = await invoke<S.SuiteRecord>('evidence', 'finishUpload', { ...scope, id: upload.id });
    await store('evidence', 'attach', { ...scope, source: ref(source), label: form.name || file.name });
  };
  const selector = (domain: Domain, title: string = titles[domain]) => (
    <RefSelect
      title={title}
      options={options(domain).filter((row) => row.kind !== 'source' && row.state === 'sealed')}
      value={selected[domain] ?? ''}
      onChange={(value) => select(domain, value)}
    />
  );
  return (
    <>
      <nav aria-label="复盘步骤">
        {tabs.map((value) => (
          <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
            {value}
          </button>
        ))}
      </nav>
      <div className="suite-toolbar">
        <span>
          {view?.currentCase
            ? `${view.currentCase.name} · ${view.currentCase.status} · ${view.currentCase.severity}`
            : '接收材料只作外来声明；本机案例尚未开立'}
        </span>
        <button disabled={busy} onClick={() => void run(refresh, '已刷新当前许可和摘要', false)}>
          刷新摘要
        </button>
      </div>
      {!canWrite && view && (
        <p role="status">
          此空间没有本地案例。外来审阅、事件索引和执行结果均未经本机认证；不会授予本地批准或执行能力。
        </p>
      )}
      {view?.capacity && (
        <p>
          已用 {(view.capacity.used / 1024 ** 2).toFixed(1)} MiB · 预留{' '}
          {(view.capacity.reserved / 1024 ** 2).toFixed(1)} MiB
        </p>
      )}
      <SuiteHostCapacityStatus value={hostCapacity} />
      {error && (
        <p role="alert" className="suite-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">正在核对固定修订…</p>}
      <fieldset disabled={busy} className="suite-body">
        {tab === '案例与材料' && (
          <div className="suite-grid">
            <article>
              <h2>实际材料与人工观察</h2>
              <fieldset disabled={!openCase}>
                <label>
                  材料名称
                  <input value={form.name} onChange={(event) => edit('name', event.target.value)} />
                </label>
                <label>
                  UTF-8 文件
                  <input
                    type="file"
                    accept=".txt,.log,.json,.jsonl"
                    onChange={(event) => setFile(event.target.files?.[0])}
                  />
                </label>
                <label>
                  格式
                  <select value={form.format} onChange={(event) => edit('format', event.target.value)}>
                    <option value="text">文本</option>
                    <option value="json">JSON / JSONL</option>
                  </select>
                </label>
                <label>
                  或粘贴实际材料
                  <textarea
                    value={form.text}
                    onChange={(event) => edit('text', event.target.value)}
                    rows={7}
                  />
                </label>
                <button
                  disabled={!form.name.trim() || (!file && !form.text)}
                  onClick={() => void run(upload, '实际材料已保存，默认禁止导出')}
                >
                  保存实际材料
                </button>
                <label>
                  人工观察时间，ISO 8601，可留空
                  <input
                    value={form.observedAt}
                    onChange={(event) => edit('observedAt', event.target.value)}
                  />
                </label>
                <button
                  disabled={!form.name.trim() || !form.text.trim()}
                  onClick={() =>
                    void run(
                      () =>
                        store('evidence', 'observe', {
                          ...scope,
                          name: form.name,
                          text: form.text,
                          observedAt: form.observedAt || null,
                        }),
                      '已记录人工观察声明',
                    )
                  }
                >
                  记录人工观察
                </button>
                <h3>原提供者只读采集</h3>
                <label>
                  提供者
                  <select
                    value={form.captureKind}
                    onChange={(event) => edit('captureKind', event.target.value)}
                  >
                    {view?.providers.captures.map((source) => (
                      <option key={source.kind} value={source.kind} disabled={!source.available}>
                        {source.kind}
                        {!source.available ? ' · 不可用' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  正在运行的 VM ID
                  <input value={form.vmId} onChange={(event) => edit('vmId', event.target.value)} />
                </label>
                <p>目标限定默认项目。采集仍需预览并批准，不会启动 VM。</p>
                <button
                  disabled={
                    !form.vmId ||
                    !view?.providers.captures.some(
                      (source) => source.kind === form.captureKind && source.available,
                    )
                  }
                  onClick={() =>
                    void run(
                      () =>
                        preview(
                          'evidence',
                          'planCapture',
                          {
                            ...scope,
                            name: form.name || '只读快照',
                            kind: form.captureKind,
                            target: { vmId: form.vmId, projectId: 'default' },
                          },
                          'capture',
                        ),
                      '请核对原提供者采集计划',
                    )
                  }
                >
                  预览采集
                </button>
              </fieldset>
              <h3>案例状态</h3>
              <label>
                实际处置或重新打开原因
                <textarea
                  value={form.caseReason}
                  onChange={(event) => edit('caseReason', event.target.value)}
                />
              </label>
              <label>
                未决项，每行一项
                <textarea
                  value={form.unresolved}
                  onChange={(event) => edit('unresolved', event.target.value)}
                />
              </label>
              <button
                disabled={!canWrite || !form.caseReason.trim()}
                onClick={() =>
                  void run(
                    () =>
                      store('cases', openCase ? 'resolve' : 'reopen', {
                        ...scope,
                        case: view!.currentCase!.reference,
                        reason: form.caseReason,
                        ...(openCase ? { unresolved: lines(form.unresolved) } : {}),
                      }),
                    openCase ? '已记录影响结束；未决项继续保留' : '已重新打开案例',
                  )
                }
              >
                {openCase ? '记录影响结束' : '重新打开案例'}
              </button>
            </article>
            <article>
              <h2>脱敏与全文人工审阅</h2>
              {selector('evidence')}
              <button
                disabled={!selected.evidence}
                onClick={() => void run(() => load('evidence'), '已读取固定证据')}
              >
                读取选定证据
              </button>
              {evidence && (
                <p>
                  {evidence.name} · {local(evidence) ? '本地固定记录' : '外来声明，不授予本地审阅或执行权'}
                </p>
              )}
              <fieldset disabled={!openCase || !local(evidence) || !evidenceValue.success}>
                <p>生成副本保留原材料强引用；原材料撤销读取后，交接也会失效。</p>
                {['password', 'token', 'authorization', 'secret', 'email'].map((name) => (
                  <label className="suite-check" key={name}>
                    <input
                      type="checkbox"
                      checked={maskKeys.includes(name)}
                      onChange={(event) =>
                        setMaskKeys(
                          event.target.checked
                            ? [...maskKeys, name]
                            : maskKeys.filter((value) => value !== name),
                        )
                      }
                    />
                    屏蔽 {name}
                  </label>
                ))}
                <label>
                  额外屏蔽的字面量，每行一项
                  <textarea
                    value={form.literals}
                    onChange={(event) => edit('literals', event.target.value)}
                  />
                </label>
                <button
                  onClick={() =>
                    void run(
                      () =>
                        store('evidence', 'redact', {
                          ...scope,
                          evidence: choose('evidence'),
                          rules: { maskKeys, literals: lines(form.literals) },
                        }),
                      '脱敏副本已保存，尚未审阅',
                    )
                  }
                >
                  生成脱敏副本
                </button>
              </fieldset>
              <button
                disabled={!readSource.success || !readDigest.success}
                onClick={() => void run(readFull, '完整字节及摘要已核对')}
              >
                读取选定材料全文并核对摘要
              </button>
              {read && (
                <>
                  <p>
                    {read.bytes} 字节 · 许可修订 {read.policyRevision}
                  </p>
                  <code>{read.digest}</code>
                  <label>
                    已核对摘要的完整 UTF-8 内容
                    <textarea readOnly value={read.text} rows={16} aria-label="待人工核对的完整材料" />
                  </label>
                  <label className="suite-check">
                    <input
                      type="checkbox"
                      checked={readAcknowledged}
                      disabled={!local(evidence)}
                      onChange={(event) => setReadAcknowledged(event.target.checked)}
                    />
                    我已阅读全文，确认所有敏感内容已按用途脱敏。
                  </label>
                </>
              )}
              <label>
                人工审阅理由
                <textarea
                  value={form.redactionReason}
                  onChange={(event) => edit('redactionReason', event.target.value)}
                />
              </label>
              <button
                disabled={
                  !canWrite ||
                  !local(evidence) ||
                  !evidenceValue.success ||
                  !evidenceValue.data.derivation ||
                  !readAcknowledged ||
                  !read ||
                  key(read.evidence) !== selected.evidence ||
                  !form.redactionReason.trim()
                }
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'evidence',
                        'planRedactionReview',
                        {
                          ...scope,
                          evidence: choose('evidence'),
                          decision: 'approve',
                          reason: form.redactionReason,
                        },
                        'reviewRedaction',
                      ),
                    '请核对全文审阅与导出许可计划',
                  )
                }
              >
                预览批准脱敏副本
              </button>
              <button
                disabled={
                  !canWrite ||
                  !local(evidence) ||
                  !evidenceValue.success ||
                  !evidenceValue.data.derivation ||
                  !form.redactionReason.trim()
                }
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'evidence',
                        'planRedactionReview',
                        {
                          ...scope,
                          evidence: choose('evidence'),
                          decision: 'reject',
                          reason: form.redactionReason,
                        },
                        'reviewRedaction',
                      ),
                    '请核对撤回此副本审阅及导出许可',
                  )
                }
              >
                预览拒绝或撤回审阅
              </button>
            </article>
          </div>
        )}
        {tab === '时间线' && (
          <section>
            <h2>固定窗口与事件分页</h2>
            <p>按采集顺序显示；人工时钟注释不验证真实时钟，也不证明因果。</p>
            <RefChecks
              title="整理完整证据窗口"
              options={nativeOptions('evidence')}
              values={evidenceKeys}
              onChange={setEvidenceKeys}
            />
            <button
              disabled={!openCase || !evidenceKeys.length}
              onClick={() =>
                void run(
                  () =>
                    store('timeline', 'assemble', {
                      ...scope,
                      evidence: selectedRefs('evidence', evidenceKeys),
                    }),
                  '固定时间线已保存',
                )
              }
            >
              整理所选窗口
            </button>
            {selector('timeline')}
            <button
              disabled={!selected.timeline}
              onClick={() => void run(() => eventPage(), '已读取固定修订的首个事件窗口')}
            >
              读取事件首窗
            </button>
            {events && (
              <>
                <p>
                  {events.origin === 'imported' ? '外来分析声明；事件 ID 只作原来源索引' : '本地固定窗口'} ·{' '}
                  {events.cursor + 1}–{events.cursor + events.items.length} / {events.total}
                </p>
                {events.items.map((event) => (
                  <article className="suite-card" key={event.id}>
                    <small>
                      {event.level} · 来源第 {event.sourceOrder + 1} 条 · {event.sourceAt ?? '来源时间未知'}
                    </small>
                    <p>{event.message}</p>
                    <code>{event.id.slice(0, 16)}</code>
                    <div>
                      <label className="suite-check">
                        <input
                          type="checkbox"
                          disabled={!editableEventWindow}
                          checked={support.includes(event.id)}
                          onChange={(input) => {
                            setSupport(
                              input.target.checked
                                ? [...support, event.id]
                                : support.filter((value) => value !== event.id),
                            );
                            if (input.target.checked)
                              setAgainst(against.filter((value) => value !== event.id));
                          }}
                        />
                        支持人工假设
                      </label>
                      <label className="suite-check">
                        <input
                          type="checkbox"
                          disabled={!editableEventWindow}
                          checked={against.includes(event.id)}
                          onChange={(input) => {
                            setAgainst(
                              input.target.checked
                                ? [...against, event.id]
                                : against.filter((value) => value !== event.id),
                            );
                            if (input.target.checked)
                              setSupport(support.filter((value) => value !== event.id));
                          }}
                        />
                        反对人工假设
                      </label>
                    </div>
                  </article>
                ))}
                <button
                  disabled={events.cursor === 0}
                  onClick={() =>
                    void run(() => eventPage(Math.max(0, events.cursor - 100)), '已读取前一窗口')
                  }
                >
                  前一窗
                </button>
                <button
                  disabled={events.next === null}
                  onClick={() => void run(() => eventPage(events.next!), '已读取后续窗口')}
                >
                  后一窗
                </button>
              </>
            )}
            <h3>人工时钟注释</h3>
            {selector('evidence', '此时间线中的证据')}
            <label>
              偏移毫秒
              <input
                type="number"
                value={form.clockOffset}
                onChange={(event) => edit('clockOffset', event.target.value)}
              />
            </label>
            <label>
              依据说明
              <textarea
                value={form.clockReason}
                onChange={(event) => edit('clockReason', event.target.value)}
              />
            </label>
            <button
              disabled={
                !canWrite ||
                !nativeOptions('timeline').some((option) => key(option.reference) === selected.timeline) ||
                !selected.evidence ||
                !form.clockReason.trim()
              }
              onClick={() =>
                void run(
                  () =>
                    store('timeline', 'annotateClock', {
                      ...scope,
                      timeline: choose('timeline'),
                      note: {
                        evidence: choose('evidence'),
                        offsetMs: Number(form.clockOffset),
                        reason: form.clockReason,
                        verified: false,
                      },
                    }),
                  '人工注释已另存固定时间线',
                )
              }
            >
              保存未经验证的时钟注释
            </button>
          </section>
        )}
        {tab === '假设与处置' && (
          <div className="suite-grid">
            <article>
              <h2>人工假设</h2>
              {selector('timeline')}
              <label>
                假设标题
                <input value={form.title} onChange={(event) => edit('title', event.target.value)} />
              </label>
              <label>
                解释
                <textarea
                  value={form.explanation}
                  onChange={(event) => edit('explanation', event.target.value)}
                />
              </label>
              <label>
                待核实项，每行一项
                <textarea value={form.pending} onChange={(event) => edit('pending', event.target.value)} />
              </label>
              <button
                disabled={!openCase || !selected.timeline || !form.title || !form.explanation}
                onClick={() =>
                  void run(
                    () =>
                      store('hypotheses', 'propose', {
                        ...scope,
                        timeline: choose('timeline'),
                        title: form.title,
                        explanation: form.explanation,
                        pending: lines(form.pending),
                      }),
                    '已保存人工假设',
                  )
                }
              >
                提出人工假设
              </button>
              {selector('hypotheses')}
              <button
                disabled={!selected.hypotheses}
                onClick={() => void run(() => load('hypotheses'), '已读取假设与原支持索引')}
              >
                读取假设
              </button>
              <p>
                已选支持 {support.length} 条、反对 {against.length}{' '}
                条。请在时间线分页中选择同一固定窗口的事件。
              </p>
              <button
                disabled={
                  !canWrite ||
                  !local(hypothesis) ||
                  !hypothesisDraft ||
                  key(hypothesisDraft.hypothesis) !== selected.hypotheses ||
                  key(hypothesisDraft.timeline) !== selected.timeline
                }
                onClick={() =>
                  void run(() => {
                    const reference = choose('hypotheses');
                    if (
                      !hypothesisDraft ||
                      key(hypothesisDraft.hypothesis) !== key(reference) ||
                      key(hypothesisDraft.timeline) !== key(choose('timeline'))
                    )
                      throw new Error('请重新读取当前固定假设，再保存支持与反对索引');
                    return store('hypotheses', 'linkEvidence', {
                      ...scope,
                      hypothesis: reference,
                      support,
                      against,
                    });
                  }, '支持与反对索引已保存')
                }
              >
                保存支持与反对索引
              </button>
              {hypothesisValue.success && (
                <p>
                  人工状态：{hypothesisValue.data.status} · {hypothesisValue.data.explanation}
                </p>
              )}
              <label>
                人工判断
                <select value={form.judgment} onChange={(event) => edit('judgment', event.target.value)}>
                  <option value="supported">支持</option>
                  <option value="contradicted">反对</option>
                  <option value="unresolved">未决</option>
                </select>
              </label>
              <label>
                判断理由
                <textarea
                  value={form.judgmentReason}
                  onChange={(event) => edit('judgmentReason', event.target.value)}
                />
              </label>
              <button
                disabled={!canWrite || !local(hypothesis) || !form.judgmentReason}
                onClick={() =>
                  void run(
                    () =>
                      store('hypotheses', 'decide', {
                        ...scope,
                        hypothesis: choose('hypotheses'),
                        status: form.judgment,
                        reason: form.judgmentReason,
                      }),
                    '人工判断已保存，不构成因果证明',
                  )
                }
              >
                保存人工判断
              </button>
              <h3>人工处置声明</h3>
              <label>
                声明名称
                <input value={form.manualName} onChange={(event) => edit('manualName', event.target.value)} />
              </label>
              <label>
                实际做过的操作与观察
                <textarea
                  value={form.manualStatement}
                  onChange={(event) => edit('manualStatement', event.target.value)}
                />
              </label>
              <button
                disabled={!openCase || !form.manualName || !form.manualStatement}
                onClick={() =>
                  void run(
                    () =>
                      store('actions', 'recordManual', {
                        ...scope,
                        name: form.manualName,
                        statement: form.manualStatement,
                        evidence: selectedRefs('evidence', evidenceKeys),
                      }),
                    '已保存人工声明，没有系统执行票据',
                  )
                }
              >
                记录人工处置
              </button>
            </article>
            <article>
              <h2>固定步骤与原提供者动作</h2>
              <label>
                步骤集名称
                <input
                  value={form.runbookName}
                  onChange={(event) => edit('runbookName', event.target.value)}
                />
              </label>
              {steps.map((step, index) => {
                const change = (value: Partial<StepDraft>) =>
                  setSteps((previous) =>
                    previous.map((old, position) => (index === position ? { ...old, ...value } : old)),
                  );
                return (
                  <fieldset key={step.id}>
                    <legend>步骤 {index + 1}</legend>
                    <label>
                      标签
                      <input value={step.label} onChange={(event) => change({ label: event.target.value })} />
                    </label>
                    <label>
                      类型
                      <select
                        value={step.kind}
                        onChange={(event) => change({ kind: event.target.value as StepDraft['kind'] })}
                      >
                        <option value="manual">人工核对</option>
                        <option value="query">只读查询</option>
                        <option value="maintenance-cleanup">原清理提供者</option>
                        <option value="resilience-reconcile">原演练核销</option>
                      </select>
                    </label>
                    {step.kind === 'manual' && (
                      <label>
                        人工说明
                        <textarea
                          value={step.instruction}
                          onChange={(event) => change({ instruction: event.target.value })}
                        />
                      </label>
                    )}
                    {step.kind === 'query' && (
                      <label>
                        查询
                        <select
                          value={step.query}
                          onChange={(event) => change({ query: event.target.value as StepDraft['query'] })}
                        >
                          <option value="evidence">证据</option>
                          <option value="timeline">时间线</option>
                          <option value="hypotheses">假设</option>
                        </select>
                      </label>
                    )}
                    {step.kind === 'maintenance-cleanup' && (
                      <label>
                        候选提供者
                        <select
                          value={step.provider}
                          onChange={(event) =>
                            change({ provider: event.target.value as StepDraft['provider'] })
                          }
                        >
                          <option value="job-logs">任务日志</option>
                          <option value="backup-blocks">备份块</option>
                        </select>
                      </label>
                    )}
                    {step.kind === 'resilience-reconcile' && (
                      <>
                        <label>
                          原演练空间
                          <input
                            value={step.workspace}
                            onChange={(event) => change({ workspace: event.target.value })}
                          />
                        </label>
                        <label>
                          原运行 ID
                          <input
                            value={step.runId}
                            onChange={(event) => change({ runId: event.target.value })}
                          />
                        </label>
                      </>
                    )}
                    <button
                      disabled={steps.length === 1}
                      onClick={() => setSteps(steps.filter((old) => old.id !== step.id))}
                    >
                      移除此步
                    </button>
                  </fieldset>
                );
              })}
              <button disabled={steps.length >= 50} onClick={() => setSteps([...steps, emptyStep()])}>
                增加一步
              </button>
              <button
                disabled={!openCase || !form.runbookName}
                onClick={() =>
                  void run(
                    () =>
                      store('runbooks', 'compile', {
                        ...scope,
                        name: form.runbookName,
                        steps: steps.map((step) => ({
                          id: step.id,
                          label: step.label,
                          ...(step.kind === 'manual'
                            ? { kind: 'manual', instruction: step.instruction }
                            : step.kind === 'query'
                              ? { kind: 'query', query: step.query }
                              : {
                                  kind: 'delegated',
                                  target:
                                    step.kind === 'maintenance-cleanup'
                                      ? { adapter: step.kind, provider: step.provider }
                                      : {
                                          adapter: step.kind,
                                          scope: { workspaceId: step.workspace },
                                          runId: step.runId,
                                        },
                                }),
                        })),
                      }),
                    '固定步骤已保存，尚未执行',
                  )
                }
              >
                保存固定步骤
              </button>
              {selector('runbooks')}
              <button
                disabled={!selected.runbooks}
                onClick={() => void run(() => load('runbooks'), '已读取固定步骤')}
              >
                读取步骤集
              </button>
              <label>
                拟执行的固定步骤
                <select value={stepId} onChange={(event) => setStepId(event.target.value)}>
                  <option value="">选择委派步骤</option>
                  {runbookValue.success &&
                    runbookValue.data.steps
                      .filter((step) => step.kind === 'delegated')
                      .map((step) => (
                        <option key={step.id} value={step.id}>
                          {step.label}
                        </option>
                      ))}
                </select>
              </label>
              <p>
                {view?.providers.actions
                  .map((provider) => `${provider.adapter}：${provider.available ? '可用' : '不可用'}`)
                  .join('；')}
              </p>
              <button
                disabled={
                  !openCase ||
                  !local(runbook) ||
                  !stepId ||
                  !runbookValue.success ||
                  !runbookValue.data.steps.some(
                    (step) =>
                      step.id === stepId &&
                      step.kind === 'delegated' &&
                      view?.providers.actions.some(
                        (provider) => provider.adapter === step.target.adapter && provider.available,
                      ),
                  )
                }
                onClick={() =>
                  void run(
                    () =>
                      preview(
                        'actions',
                        'planAction',
                        {
                          ...scope,
                          runbook: choose('runbooks'),
                          stepId,
                          evidence: selectedRefs('evidence', evidenceKeys),
                        },
                        'submitAction',
                      ),
                    '请核对原提供者候选与固定计划',
                  )
                }
              >
                预览原提供者动作
              </button>
              {selector('actions')}
              <button
                disabled={!selected.actions}
                onClick={() => void run(() => load('actions'), '已读取固定处置记录')}
              >
                读取处置记录
              </button>
              <button
                disabled={!local(action)}
                onClick={() =>
                  void run(async () => {
                    const result = await invoke<{
                      record: S.SuiteRecord;
                      provider: { status: string; result: S.SuiteJson; error: string | null } | null;
                      providerAvailable: boolean;
                    }>('actions', 'inspect', { ...scope, action: choose('actions') });
                    setInspection({
                      available: result.providerAvailable,
                      status: result.provider?.status ?? '无当前回执',
                      result: result.provider?.result ?? null,
                      error: result.provider?.error ?? null,
                    });
                  }, '已查询原提供者；未知状态继续保留')
                }
              >
                查询原提供者回执
              </button>
              {inspection && (
                <div role="status">
                  <p>
                    原提供者{inspection.available ? '可用' : '不可用'} · {inspection.status}
                  </p>
                  <pre>{JSON.stringify(inspection.result, null, 2)}</pre>
                  {inspection.error && <p>{inspection.error}</p>}
                </div>
              )}
              <label>
                未知状态的人工核对说明
                <textarea
                  value={form.acknowledgeReason}
                  onChange={(event) => edit('acknowledgeReason', event.target.value)}
                />
              </label>
              <button
                disabled={!local(action) || !form.acknowledgeReason}
                onClick={() =>
                  void run(
                    () =>
                      store('actions', 'acknowledge', {
                        ...scope,
                        action: choose('actions'),
                        reason: form.acknowledgeReason,
                      }),
                    '核对说明已保存，不改变资源核销事实',
                  )
                }
              >
                记录人工核对说明
              </button>
            </article>
          </div>
        )}
        {tab === '审阅与报告' && (
          <div className="suite-grid">
            <article>
              <h2>审阅完整选定窗口</h2>
              {selector('timeline')}
              <RefChecks
                title="与时间线完全一致的证据"
                options={nativeOptions('evidence')}
                values={evidenceKeys}
                onChange={setEvidenceKeys}
              />
              <RefChecks
                title="纳入审阅的人工假设"
                options={nativeOptions('hypotheses')}
                values={hypothesisKeys}
                onChange={setHypothesisKeys}
              />
              <RefChecks
                title="纳入审阅的处置记录"
                options={nativeOptions('actions')}
                values={actionKeys}
                onChange={setActionKeys}
              />
              <label>
                审阅名称
                <input value={form.reviewName} onChange={(event) => edit('reviewName', event.target.value)} />
              </label>
              <label>
                本窗口未决项，每行一项
                <textarea
                  value={form.unresolved}
                  onChange={(event) => edit('unresolved', event.target.value)}
                />
              </label>
              <button
                disabled={!canWrite || !selected.timeline || !evidenceKeys.length || !form.reviewName}
                onClick={() =>
                  void run(
                    () =>
                      store('reviews', 'open', {
                        ...scope,
                        name: form.reviewName,
                        timeline: choose('timeline'),
                        evidence: selectedRefs('evidence', evidenceKeys),
                        hypotheses: selectedRefs('hypotheses', hypothesisKeys),
                        actions: selectedRefs('actions', actionKeys),
                        unresolved: lines(form.unresolved),
                      }),
                    '已生成固定审阅窗口，尚未接受',
                  )
                }
              >
                打开人工审阅
              </button>
              {selector('reviews')}
              <button
                disabled={!selected.reviews}
                onClick={() => void run(() => load('reviews'), '已读取固定审阅')}
              >
                读取审阅
              </button>
              <button
                disabled={!local(review)}
                onClick={() =>
                  void run(
                    async () =>
                      setReviewCheck(
                        await invoke<R.IncidentReviewCheck>('reviews', 'recheck', {
                          ...scope,
                          review: choose('reviews'),
                        }),
                      ),
                    '已重新核对当前许可和原提供者状态',
                  )
                }
              >
                重新核对当前状态
              </button>
              {(reviewCheck?.assessment ?? (reviewValue.success ? reviewValue.data.assessment : null)) && (
                <details open>
                  <summary>选定窗口的核对结果</summary>
                  <p>只覆盖本次选择；未认证未知来源，也不推断根因。</p>
                  {(
                    reviewCheck?.assessment ?? (reviewValue.success ? reviewValue.data.assessment : undefined)
                  )?.findings.map((finding, index) => (
                    <p key={index}>
                      {finding.severity} · {finding.message}
                    </p>
                  ))}
                </details>
              )}
              {Object.entries({
                selectedScope: '选定范围完整',
                factsAndClaims: '事实与来源声明已区分',
                clockUncertainty: '时钟与跨来源顺序不确定性已披露',
                manualInferences: '人工推断及支持反对项已核对',
                actionReceipts: '原处置回执及未知状态已核对',
                unresolvedItems: '未决项已完整保留',
              }).map(([name, label]) => (
                <label className="suite-check" key={name}>
                  <input
                    type="checkbox"
                    checked={checklist[name as keyof typeof checklist]}
                    onChange={(event) => setChecklist({ ...checklist, [name]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <label>
                人工决定理由
                <textarea
                  value={form.reviewReason}
                  onChange={(event) => edit('reviewReason', event.target.value)}
                />
              </label>
              <button
                disabled={!local(review) || !Object.values(checklist).every(Boolean) || !form.reviewReason}
                onClick={() =>
                  void run(
                    () =>
                      store('reviews', 'decide', {
                        ...scope,
                        review: choose('reviews'),
                        decision: 'accept',
                        reason: form.reviewReason,
                        checklist,
                      }),
                    '人工审阅已接受；生成报告前请重新核对状态',
                  )
                }
              >
                接受此固定审阅
              </button>
              <button
                disabled={!local(review) || !form.reviewReason}
                onClick={() =>
                  void run(
                    () =>
                      store('reviews', 'decide', {
                        ...scope,
                        review: choose('reviews'),
                        decision: 'reject',
                        reason: form.reviewReason,
                        checklist,
                      }),
                    '已拒绝此固定审阅',
                  )
                }
              >
                拒绝此审阅
              </button>
            </article>
            <article>
              <h2>四栏人工复盘报告</h2>
              <p>报告保留所选审阅的固定事实摘要，人工叙述不能替代提供者证明。</p>
              <label>
                报告标题
                <input
                  value={form.reportTitle}
                  onChange={(event) => edit('reportTitle', event.target.value)}
                />
              </label>
              <label>
                概述
                <textarea value={form.summary} onChange={(event) => edit('summary', event.target.value)} />
              </label>
              {(['facts', 'inferences', 'measures', 'followUp'] as const).map((name) => (
                <label key={name}>
                  {
                    {
                      facts: '观察到的事实与来源声明',
                      inferences: '人工推断与不确定性',
                      measures: '实际处置与原回执状态',
                      followUp: '后续核实与未决项',
                    }[name]
                  }
                  <textarea
                    value={form[name]}
                    onChange={(event) => edit(name, event.target.value)}
                    rows={5}
                    maxLength={16000}
                  />
                </label>
              ))}
              <button
                disabled={
                  !local(review) ||
                  !reviewCheck?.accepted ||
                  key(reviewCheck.review) !== selected.reviews ||
                  !form.reportTitle ||
                  !form.summary
                }
                onClick={() =>
                  void run(
                    () =>
                      store('reports', 'draft', {
                        ...scope,
                        review: choose('reviews'),
                        title: form.reportTitle,
                        summary: form.summary,
                        narrative: {
                          facts: form.facts,
                          inferences: form.inferences,
                          measures: form.measures,
                          followUp: form.followUp,
                        },
                      }),
                    '报告草稿已保存',
                  )
                }
              >
                保存四栏报告草稿
              </button>
              <SuiteRecordSelect
                title="已读取的固定报告"
                rows={loaded.filter((row) => row.domain === 'incident-reports')}
                value={selected.reports ?? ''}
                onChange={(value) => select('reports', value)}
              />
              {selector('reports', '读取其他报告')}
              <button
                disabled={!selected.reports}
                onClick={() => void run(() => load('reports'), '已读取固定报告')}
              >
                读取报告
              </button>
              <button
                disabled={!local(report) || !reportValue.success || reportValue.data.status !== 'draft'}
                onClick={() =>
                  void run(
                    () => store('reports', 'seal', { ...scope, id: report!.id, revision: report!.revision }),
                    '复盘报告已封存',
                  )
                }
              >
                封存此报告
              </button>
              {reportValue.success && (
                <details>
                  <summary>
                    {reportValue.data.status} · {reportValue.data.summary}
                  </summary>
                  {Object.entries(reportValue.data.narrative).map(([name, text]) => (
                    <p key={name}>
                      {name}：{text}
                    </p>
                  ))}
                </details>
              )}
            </article>
          </div>
        )}
        {tab === '脱敏交接' && (
          <section>
            <h2>经过审阅的派生材料交接</h2>
            <p>
              仅选择本地封存报告。交接保持已审阅字节，省略私有祖先材料和活跃凭据；本地原来源的读取撤权继续生效。接收创建新空间和
              ID，原批准与执行权不转移。
            </p>
            {selector('reports', '封存报告')}
            <button
              disabled={!selected.reports}
              onClick={() => void run(() => load('reports'), '已读取报告供交接选择')}
            >
              读取选定报告用于交接
            </button>
            {selector('exchange', '已有交接记录')}
            <button
              disabled={!selected.exchange}
              onClick={() => void run(() => load('exchange'), '已读取交接记录供摘要核对下载')}
            >
              读取交接记录
            </button>
            <button
              onClick={() =>
                void run(
                  async () => setTransfers(await invoke<S.SuiteUpload[]>('exchange', 'transfers', scope)),
                  '已读取交接暂存',
                )
              }
            >
              核对交接暂存
            </button>
            <SuiteExchangePanel
              description="交接只包含选定封存报告、经人审的脱敏副本与历史声明；私有原证据及票据留在本机。当前上限 16 MiB。"
              invoke={invoke}
              workspaceId={workspaceId}
              domains={{ reports: '本地封存复盘报告' }}
              records={{
                reports: loaded.filter(
                  (row) =>
                    row.domain === 'incident-reports' &&
                    local(row) &&
                    R.incidentReport.safeParse(row.content).success &&
                    R.incidentReport.parse(row.content).status === 'sealed',
                ),
                exchange: loaded.filter((row) => row.domain === 'incident-exchange'),
              }}
              transfers={transfers}
              busy={busy}
              run={run}
              preview={preview}
              onAccepted={onSpacesChanged}
              downloadName="incident-desk.zip"
            />
          </section>
        )}
        {tab === '历史与恢复' && (
          <section>
            <h2>固定修订与清理恢复</h2>
            <button
              onClick={() =>
                void run(
                  async () => {
                    historyMode.current = true;
                    await refresh();
                  },
                  '已读取有界历史与归档摘要',
                  false,
                )
              }
            >
              读取历史与归档摘要
            </button>
            <button
              onClick={() =>
                void run(
                  async () => {
                    historyMode.current = false;
                    await refresh();
                  },
                  '已返回当前摘要',
                  false,
                )
              }
            >
              返回当前修订
            </button>
            <label>
              领域
              <select
                value={historyDomain}
                onChange={(event) => {
                  setHistoryDomain(event.target.value as Domain);
                  setCleanupKeys([]);
                }}
              >
                {Object.entries(titles).map(([domain, title]) => (
                  <option key={domain} value={domain}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <RefChecks
              title="明确选择拟归档或清理的固定记录"
              options={options(historyDomain)}
              values={cleanupKeys}
              onChange={setCleanupKeys}
            />
            <button
              disabled={!cleanupKeys.length}
              onClick={() =>
                void run(async () => {
                  for (const reference of selectedRefs(historyDomain, cleanupKeys))
                    await invoke(historyDomain, 'archive', {
                      ...scope,
                      id: reference.id,
                      revision: reference.revision,
                    });
                  setCleanupKeys([]);
                }, '选定记录已归档；有保护引用的材料仍保留')
              }
            >
              归档所选记录
            </button>
            <button
              disabled={!cleanupKeys.length}
              onClick={() =>
                void run(
                  () =>
                    preview(
                      historyDomain,
                      'previewCleanup',
                      { ...scope, references: selectedRefs(historyDomain, cleanupKeys) },
                      'cleanup',
                    ),
                  '请核对实际保护引用与清理范围',
                )
              }
            >
              预览清理所选固定记录
            </button>
            <label>
              原计划 ID
              <input
                value={form.recoveryPlan}
                onChange={(event) => edit('recoveryPlan', event.target.value)}
              />
            </label>
            <button
              disabled={!form.recoveryPlan}
              onClick={() =>
                void run(async () => {
                  const value = await invoke<S.SuitePlan>(historyDomain, 'inspectPlan', {
                    ...scope,
                    planId: form.recoveryPlan,
                  });
                  setNotice(`原计划 ${value.action} · ${value.state}`);
                }, '已核对原计划状态')
              }
            >
              查询原计划
            </button>
            <button
              disabled={!form.recoveryPlan}
              onClick={() =>
                void run(
                  () =>
                    preview(
                      historyDomain,
                      'previewRecovery',
                      { ...scope, planId: form.recoveryPlan },
                      'cleanup',
                    ),
                  '请核对原计划恢复范围',
                )
              }
            >
              预览原计划恢复
            </button>
            <SuitePublicationRecoveryPanel
              domain={historyDomain}
              workspaceId={workspaceId}
              invoke={invoke}
              run={run}
              preview={preview}
            />
          </section>
        )}
        <details>
          <summary>当前有界领域摘要与续页</summary>
          {view?.domains.map((page) => (
            <article className="suite-card" key={page.id}>
              <h3>{titles[page.id]}</h3>
              {page.error && <p role="alert">此领域暂不可读：{page.error}</p>}
              {page.records.map((row) => (
                <p key={key(row.reference)}>
                  {row.name} · {row.reference.revision.slice(0, 8)}
                  {row.sourceClaimOnly ? ' · 未经认证的外来声明' : ''}
                  {row.details.map((detail) => ` · ${detail.label}：${detail.value}`).join('')}
                </p>
              ))}
              {page.timelines.map((header) => (
                <p key={key(header.reference)}>
                  {header.name} · {header.eventCount} 条事件 · {header.reference.revision.slice(0, 8)}
                  {header.sourceClaimOnly ? ' · 原来源事件索引声明' : ''}
                </p>
              ))}
              {page.next !== null && (
                <button
                  onClick={() =>
                    void run(() => refresh({ [page.id]: page.next! }), '已读取后续摘要窗口', false)
                  }
                >
                  读取{titles[page.id]}后续摘要
                </button>
              )}
            </article>
          ))}
        </details>
      </fieldset>
      {plan && (
        <SuitePlanDialog
          key={plan.value.id}
          value={plan.value}
          busy={busy}
          onApprove={() => void approval()}
          onCancel={() => setPlan(undefined)}
        />
      )}
    </>
  );
}

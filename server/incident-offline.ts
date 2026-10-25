/** 事件交接的独立离线核验；只验证字节与来源声明之间的结构一致性。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as R from '../shared/contracts/incident-reviews.ts';
import { cleanupResultSchema } from '../shared/contracts/cleanup-plan.ts';
import {
  incidentPortableContent,
  assertIncidentPortableCredentials,
  assertIncidentPortableMaterial,
} from './suite-incident-portable.ts';
import { verifySuiteGraph, offlineKey, offlineHash } from './suite-offline.ts';

const domains = [
  'cases',
  'evidence',
  'timeline',
  'hypotheses',
  'runbooks',
  'actions',
  'reviews',
  'reports',
].map((name) => 'incident-' + name);
const portableCase = I.incidentCase
  .omit({ format: true, declaredBy: true, singleOwnerCase: true })
  .extend({ declaredByClaim: S.suiteId })
  .strict();
const portableEvidence = z
  .object({
    case: S.suiteRef,
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    sourceAt: I.incidentTime.nullable(),
    observedAt: I.incidentTime,
    claimedMethod: I.incidentEvidence.shape.method,
    externalStatement: z.literal(true),
    redaction: z
      .object({
        originalDigest: S.suiteDigest,
        rulesDigest: S.suiteDigest,
        reviewedDeclaration: z.literal(true),
        reviewerClaim: S.suiteId,
        reason: z.string().max(4000),
        policyRevisionClaim: z.number().int().positive(),
        replacements: z.number().int().nonnegative(),
        warnings: z.array(z.string().max(1000)).max(20),
      })
      .strict(),
  })
  .strict();
const containment = z.enum(['confirmed', 'pending', 'unknown']);
const resilienceFact = z
  .object({
    runId: S.suiteId,
    state: z.enum([
      'queued',
      'preparing',
      'baselining',
      'armed',
      'injecting',
      'observing',
      'recovering',
      'verifying',
      'containing',
      'cleaning',
      'completed',
      'reconcile-required',
    ]),
    containment,
    cleanup: containment,
    outcome: z.enum(['passed', 'failed', 'cancelled', 'inconclusive']),
    resultDigest: S.suiteDigest,
    source: z.literal('original-provider'),
  })
  .strict();
const actionFact = z.discriminatedUnion('adapter', [
  cleanupResultSchema.extend({ adapter: z.literal('maintenance-cleanup') }).strict(),
  resilienceFact.extend({ adapter: z.literal('resilience-reconcile') }).strict(),
]);
const portableAction = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('manual-history'),
      case: S.suiteRef,
      statement: z.string().min(1).max(16000),
      declaredByClaim: S.suiteId,
      systemExecution: z.literal(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('delegated-history'),
      case: S.suiteRef,
      phaseClaim: z.enum(['prepared', 'intent-recorded', 'provider-returned', 'unknown']),
      adapterClaim: z.enum(['maintenance-cleanup', 'resilience-reconcile']),
      providerClaim: z.enum(['official:maintenance', 'official:resilience-runs']),
      providerStatusClaim: z
        .enum(['ready', 'consumed', 'dispatching', 'returned', 'rejected', 'unknown', 'expired'])
        .nullable(),
      resultClaim: z
        .union([cleanupResultSchema, resilienceFact.omit({ runId: true, resultDigest: true, source: true })])
        .nullable(),
      submittedByClaim: S.suiteId,
      executionTrust: z.literal('source-claim-only'),
    })
    .strict(),
]);
const portableRunbook = z
  .object({
    case: S.suiteRef,
    steps: z
      .array(
        z.discriminatedUnion('kind', [
          I.incidentStep.options[0],
          I.incidentStep.options[1],
          z
            .object({
              id: S.suiteId,
              kind: z.literal('delegated-declaration'),
              label: S.suiteName,
              adapterClaim: z.enum(['maintenance-cleanup', 'resilience-reconcile']),
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(50),
    executionTransferred: z.literal(false),
  })
  .strict();

function fail(code: string): never {
  throw new Error('INCIDENT_VERIFY_' + code);
}
const same = (a: unknown, b: unknown) => offlineHash(a) === offlineHash(b);
function unique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) fail(code);
}
function sameRefs(a: S.SuiteRef[], b: S.SuiteRef[]) {
  unique(a.map(offlineKey), 'DUPLICATE_SELECTION');
  unique(b.map(offlineKey), 'DUPLICATE_SELECTION');
  return a.length === b.length && same(a.map(offlineKey).sort(), b.map(offlineKey).sort());
}

export function verifyIncidentBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(bytes, 'sakura-incident-desk/1', domains, 'incident-evidence');
  const contents = new Map<string, z.infer<typeof incidentPortableContent>>();
  const cases = new Map<string, z.infer<typeof portableCase>>();
  const evidence = new Map<string, z.infer<typeof portableEvidence>>();
  const timelines = new Map<string, z.infer<typeof I.incidentTimeline>>();
  const hypotheses = new Map<string, z.infer<typeof I.incidentHypothesis>>();
  const actions = new Map<string, z.infer<typeof portableAction>>();
  const reviews = new Map<string, z.infer<typeof R.incidentReview>>();
  const reports = new Map<string, z.infer<typeof R.incidentReport>>();
  const sources = new Set<string>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported' || row.parent !== null || row.sequence !== 1 || row.policyRevision !== 1)
      fail('PORTABLE_RECORD');
    unique(row.references.map(offlineKey), 'DUPLICATE_REFERENCE');
    assertIncidentPortableCredentials(S.suiteJson.parse(row));
    const key = offlineKey(row);
    if (row.kind === 'source') {
      const material = S.suiteMaterial.parse(row.content),
        data = graph.materials.get(key)!;
      if (row.references.length || !material.allowRead || material.allowExport) fail('SOURCE_POLICY');
      if (data.length > 8 * 1024 ** 2) fail('SOURCE_LIMIT');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
      if (!Buffer.from(text, 'utf8').equals(data)) fail('SOURCE_ENCODING');
      assertIncidentPortableMaterial(text, z.enum(['text', 'json']).parse(material.format));
      sources.add(key);
      continue;
    }
    if (row.kind !== (row.domain === 'incident-reviews' ? 'review' : 'result')) fail('KIND');
    const content = incidentPortableContent.parse(row.content);
    contents.set(key, content);
    const value = content.claims;
    switch (row.domain) {
      case 'incident-cases':
        cases.set(key, portableCase.parse(value));
        break;
      case 'incident-evidence':
        evidence.set(key, portableEvidence.parse(value));
        break;
      case 'incident-timeline':
        timelines.set(key, I.incidentTimeline.parse(value));
        break;
      case 'incident-hypotheses':
        hypotheses.set(key, I.incidentHypothesis.parse(value));
        break;
      case 'incident-actions':
        actions.set(key, portableAction.parse(value));
        break;
      case 'incident-reviews':
        reviews.set(key, R.incidentReview.parse(value));
        break;
      case 'incident-reports':
        reports.set(key, R.incidentReport.parse(value));
        break;
      case 'incident-runbooks':
        portableRunbook.parse(value);
        break;
      default:
        fail('DOMAIN');
    }
  }
  const expect = <T>(values: Map<string, T>, ref: S.SuiteRef): T =>
    values.get(offlineKey(ref)) ?? fail('DOMAIN_REFERENCE');
  const caseClaim = (ref: S.SuiteRef) => {
    expect(cases, ref);
    return contents.get(offlineKey(ref))!.sourceObjectDigest;
  };
  const sameCase = (a: S.SuiteRef, b: S.SuiteRef) => {
    if (caseClaim(a) !== caseClaim(b)) fail('CASE_CLAIM');
  };
  // 检查全部嵌套 Ref 都由强引用闭包覆盖，不将悬空外来声明作为完整对象接受。
  for (const row of graph.rows) {
    const closure = new Set<string>();
    const visit = (ref: S.SuiteRef) => {
      const key = offlineKey(ref);
      if (closure.has(key)) return;
      closure.add(key);
      graph.get(ref).references.forEach(visit);
    };
    row.references.forEach(visit);
    const nested = (value: S.SuiteJson): void => {
      if (Array.isArray(value)) {
        value.forEach(nested);
        return;
      }
      if (!value || typeof value !== 'object') return;
      if (Object.keys(value).sort().join(',') === 'domain,id,revision') {
        const ref = S.suiteRef.safeParse(value);
        if (ref.success) {
          if (!closure.has(offlineKey(ref.data))) fail('NESTED_REFERENCE');
          graph.get(ref.data);
          return;
        }
      }
      Object.values(value).forEach(nested);
    };
    nested(row.content);
    const key = offlineKey(row);
    if (cases.has(key) && row.references.length) fail('CASE_REFERENCE');
    if (evidence.has(key)) {
      const value = evidence.get(key)!;
      caseClaim(value.case);
      if (
        !sources.has(offlineKey(value.source)) ||
        !sameRefs(row.references, [value.case, value.source]) ||
        value.sourceDigest !== S.suiteMaterial.parse(graph.get(value.source).content).digest
      )
        fail('EVIDENCE_SOURCE');
    }
    if (actions.has(key) && !sameRefs(row.references, [actions.get(key)!.case])) fail('ACTION_REFERENCE');
    if (row.domain === 'incident-runbooks') caseClaim(portableRunbook.parse(contents.get(key)!.claims).case);
  }
  for (const key of sources) {
    if (![...evidence.values()].some((value) => offlineKey(value.source) === key)) fail('UNCLAIMED_SOURCE');
  }
  let eventCount = 0;
  for (const timeline of timelines.values()) {
    const selected = new Set(timeline.evidence.map(offlineKey));
    if (selected.size !== timeline.evidence.length) fail('TIMELINE_EVIDENCE');
    caseClaim(timeline.case);
    for (const ref of timeline.evidence) sameCase(timeline.case, expect(evidence, ref).case);
    unique(
      timeline.events.map((event) => event.id),
      'EVENT_ID',
    );
    unique(
      timeline.events.map((event) => offlineKey(event.evidence) + ':' + event.sourceOrder),
      'EVENT_INDEX',
    );
    for (const event of timeline.events) {
      const source = expect(evidence, event.evidence);
      if (!selected.has(offlineKey(event.evidence)) || source.observedAt !== event.observedAt)
        fail('EVENT_EVIDENCE');
    }
    unique(
      timeline.clockNotes.map((note) => offlineKey(note.evidence)),
      'CLOCK_NOTE',
    );
    if (timeline.clockNotes.some((note) => !selected.has(offlineKey(note.evidence)))) fail('CLOCK_NOTE');
    eventCount += timeline.events.length;
  }
  for (const hypothesis of hypotheses.values()) {
    const timeline = expect(timelines, hypothesis.timeline),
      ids = new Set(timeline.events.map((event) => event.id));
    sameCase(hypothesis.case, timeline.case);
    unique([...hypothesis.support, ...hypothesis.against], 'HYPOTHESIS_INDEX');
    if (
      [...hypothesis.support, ...hypothesis.against].some((id) => !ids.has(id)) ||
      (hypothesis.status === 'supported' && !hypothesis.support.length) ||
      (hypothesis.status === 'contradicted' && !hypothesis.against.length)
    )
      fail('HYPOTHESIS_INDEX');
  }
  for (const action of actions.values()) {
    caseClaim(action.case);
    if (action.kind === 'delegated-history') {
      if (
        action.providerClaim !==
        (action.adapterClaim === 'maintenance-cleanup' ? 'official:maintenance' : 'official:resilience-runs')
      )
        fail('ACTION_PROVIDER');
      if (action.resultClaim !== null) {
        if (action.providerStatusClaim !== 'returned') fail('ACTION_RESULT');
        const schema =
          action.adapterClaim === 'maintenance-cleanup'
            ? cleanupResultSchema
            : resilienceFact.omit({ runId: true, resultDigest: true, source: true });
        schema.parse(action.resultClaim);
      } else if (action.providerStatusClaim === 'returned') fail('ACTION_RESULT');
    }
  }
  for (const review of reviews.values()) {
    const selected = review.selection,
      assessment = review.assessment,
      timeline = expect(timelines, selected.timeline);
    if (
      review.decision !== 'accepted' ||
      !review.decidedBy ||
      !review.decidedAt ||
      !Object.values(review.checklist).every(Boolean) ||
      !assessment.exportReady ||
      assessment.findings.some((finding) => finding.severity === 'blocking')
    )
      fail('REVIEW_CLAIM');
    sameCase(selected.case, timeline.case);
    sameCase(selected.case, assessment.case);
    sameCase(selected.case, assessment.currentCase);
    if (
      assessment.caseState !== expect(cases, assessment.currentCase).status ||
      !sameRefs(selected.evidence, timeline.evidence) ||
      !sameRefs(
        selected.evidence,
        assessment.evidence.map((entry) => entry.ref),
      ) ||
      !sameRefs(
        selected.hypotheses,
        assessment.hypotheses.map((entry) => entry.ref),
      ) ||
      !sameRefs(
        selected.actions,
        assessment.actions.map((entry) => entry.ref),
      ) ||
      !same(assessment.timeline, {
        ref: selected.timeline,
        eventCount: timeline.events.length,
        displayOrder: timeline.displayOrder,
        crossSourceOrder: timeline.crossSourceOrder,
        clockAnnotations: timeline.clockNotes.length,
        clockNotes: timeline.clockNotes,
        clockAnnotationsVerified: false,
        unsupportedLines: timeline.unsupportedLines,
        truncatedMessages: timeline.truncatedMessages,
      })
    )
      fail('REVIEW_WINDOW');
    unique(
      assessment.permissions.map((entry) => offlineKey(entry.ref)),
      'REVIEW_PERMISSION',
    );
    for (const entry of assessment.evidence) {
      const value = expect(evidence, entry.ref);
      sameCase(selected.case, value.case);
      if (
        entry.name !== graph.get(entry.ref).name ||
        entry.method !== value.claimedMethod ||
        entry.sourceDigest !== value.sourceDigest ||
        entry.sourceAt !== value.sourceAt ||
        entry.observedAt !== value.observedAt ||
        !Object.values(entry.redaction).every(Boolean)
      )
        fail('REVIEW_EVIDENCE');
    }
    for (const entry of assessment.hypotheses) {
      const value = expect(hypotheses, entry.ref);
      sameCase(selected.case, value.case);
      if (
        !same(value.timeline, selected.timeline) ||
        !same(entry, {
          ref: entry.ref,
          name: graph.get(entry.ref).name,
          explanation: value.explanation,
          status: value.status,
          reason: value.reason,
          judgment: value.judgment,
          supportCount: value.support.length,
          againstCount: value.against.length,
          pending: value.pending,
        })
      )
        fail('REVIEW_HYPOTHESIS');
    }
    for (const entry of assessment.actions) {
      const value = expect(actions, entry.ref);
      sameCase(selected.case, value.case);
      if (
        entry.name !== graph.get(entry.ref).name ||
        entry.kind !== (value.kind === 'manual-history' ? 'manual' : 'delegated')
      )
        fail('REVIEW_ACTION');
      if (value.kind === 'manual-history') {
        if (
          entry.fact !== null ||
          entry.statement !== value.statement ||
          entry.status !== 'manual-declaration' ||
          entry.proofSource !== 'manual-declaration' ||
          entry.proofDigest !== null ||
          entry.resourceState !== 'manual-declaration'
        )
          fail('REVIEW_ACTION');
      } else {
        if (
          entry.statement !== null ||
          entry.status === 'manual-declaration' ||
          entry.proofSource === 'manual-declaration' ||
          entry.resourceState === 'manual-declaration'
        )
          fail('REVIEW_ACTION');
        if (entry.fact !== null) {
          const fact = actionFact.parse(entry.fact);
          if (
            fact.adapter !== value.adapterClaim ||
            !['returned', 'unavailable'].includes(entry.status) ||
            entry.proofDigest === null ||
            (entry.status === 'unavailable' &&
              (entry.proofSource !== 'saved-receipt' || entry.resourceState !== 'unknown'))
          )
            fail('REVIEW_ACTION');
        } else if (entry.status === 'returned') fail('REVIEW_ACTION');
      }
    }
  }
  for (const report of reports.values()) {
    const review = expect(reviews, report.review);
    sameCase(report.case, review.selection.case);
    if (
      report.status !== 'sealed' ||
      !report.sealedBy ||
      !report.sealedAt ||
      report.assessmentDigest !== review.assessmentDigest ||
      !same(report.facts, review.assessment)
    )
      fail('REPORT_REVIEW');
  }
  if (!reports.size) fail('REPORT_REQUIRED');
  const held = new Set<string>();
  const hold = (row: S.SuiteRecord) => {
    const key = offlineKey(row);
    if (held.has(key)) return;
    held.add(key);
    row.references.forEach((ref) => hold(graph.get(ref)));
  };
  for (const key of reports.keys()) hold(graph.index.get(key)!);
  if (held.size !== graph.rows.length) fail('UNSELECTED_OBJECT');
  return {
    format: 'sakura-incident-desk/1',
    byteIntegrity: 'verified',
    referenceIntegrity: 'verified',
    sourceTrust: 'unauthenticated',
    sourceAuthentication: 'unauthenticated',
    approvalsTransferred: false,
    sourceClaimOnly: true,
    objects: graph.rows.length,
    materials: graph.materials.size,
    reports: reports.size,
    sourceClaimEvents: eventCount,
    manifestDigest: graph.manifestDigest,
    notAuthenticated: [
      '原来源、作者和同案身份声明',
      '原人工审阅与执行结果声明',
      '当前来源许可与未知秘密',
      '事件 ID、摘要与支持/反对索引的原分析过程',
    ],
  };
}

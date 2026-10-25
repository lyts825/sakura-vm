/** 复盘审阅只覆盖明确选定的固定窗口，原动作状态仍通过原处置服务核对。 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as A from '../shared/contracts/incident-actions.ts';
import * as R from '../shared/contracts/incident-reviews.ts';
import { cleanupResultSchema } from '../shared/contracts/cleanup-plan.ts';
import { resilienceRunSchema } from '../shared/contracts/resilience-lab.ts';
import type { DelegatedReceipt } from '../shared/contracts/delegated-actions.ts';
import type {
  IncidentCasesV1,
  IncidentEvidenceV1,
  IncidentTimelineV1,
  IncidentHypothesesV1,
  IncidentActionsV1,
} from './service-contracts/incident-desk.ts';
import type { IncidentReviewsV1 } from './service-contracts/incident-reviews.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import {
  SuiteStore,
  suiteActor,
  suiteBytes,
  suiteHash,
  suiteFail,
  withSuiteReferenceBudget,
  type SuiteAuthorize,
} from './suite-store.ts';

const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const pin = (scope: S.SuiteScope, reference: S.SuiteRef) => ({
  ...scope,
  id: reference.id,
  revision: reference.revision,
});
const same = (a: S.SuiteRef, b: S.SuiteRef) => suiteHash(a) === suiteHash(b);
const json = (value: unknown) => S.suiteJson.parse(value);
const resilienceResult = z
  .object({
    runId: S.suiteId,
    state: resilienceRunSchema.shape.state,
    containment: resilienceRunSchema.shape.containment,
    cleanup: resilienceRunSchema.shape.cleanup,
    outcome: resilienceRunSchema.shape.outcome,
    resultDigest: S.suiteDigest,
    source: z.literal('original-provider'),
  })
  .strict();
const emptyChecklist = () => ({
  selectedScope: false,
  factsAndClaims: false,
  clockUncertainty: false,
  manualInferences: false,
  actionReceipts: false,
  unresolvedItems: false,
});

export class IncidentReviews extends SuiteStore implements IncidentReviewsV1 {
  constructor(
    metadata: PluginMetadata,
    authorize: SuiteAuthorize,
    private cases: IncidentCasesV1,
    private evidence: IncidentEvidenceV1,
    timeline: IncidentTimelineV1,
    hypotheses: IncidentHypothesesV1,
    private actions: IncidentActionsV1,
  ) {
    super('incident-reviews', metadata, authorize, cases, {
      'incident-cases': cases,
      'incident-evidence': evidence,
      'incident-timeline': timeline,
      'incident-hypotheses': hypotheses,
      'incident-actions': actions,
    });
  }
  private assertDomain(reference: S.SuiteRef, expected: string) {
    if (reference.domain !== expected) suiteFail('INCIDENT_REVIEW_DOMAIN', '所选对象不属于对应复盘领域');
  }
  private unique(references: S.SuiteRef[]) {
    if (new Set(references.map(suiteHash)).size !== references.length)
      suiteFail('INCIDENT_REVIEW_DUPLICATE', '复盘窗口含重复修订');
  }
  private all(selection: z.infer<typeof R.incidentReviewSelection>) {
    return [
      selection.case,
      selection.timeline,
      ...selection.evidence,
      ...selection.hypotheses,
      ...selection.actions,
    ];
  }
  private reviewValue(row: S.SuiteRecord) {
    if (row.kind !== 'review') suiteFail('INCIDENT_REVIEW_REQUIRED');
    const value = R.incidentReview.parse(row.content);
    if (suiteHash(value.assessment) !== value.assessmentDigest) suiteFail('INCIDENT_REVIEW_INTEGRITY');
    return value;
  }
  private protectDecision(row: S.SuiteRecord) {
    if (row.origin !== 'local' || row.kind !== 'review') return;
    const value = this.reviewValue(row);
    if (value.decision !== 'pending')
      suiteFail(
        'INCIDENT_REVIEW_DECISION_PROTECTED',
        '本地人工决定须保留，不能归档或清理；删除较新决定会使旧批准重新生效',
      );
  }
  private async protectCleanup(scope: S.SuiteScope, references: S.SuiteRef[]) {
    await this.access(scope);
    const state = await this.readState();
    for (const reference of references) {
      const row = state.rows.find(
        (candidate) =>
          candidate.workspaceId === scope.workspaceId &&
          candidate.actor === suiteActor() &&
          candidate.domain === reference.domain &&
          candidate.id === reference.id &&
          candidate.revision === reference.revision,
      );
      if (row) this.protectDecision(row);
    }
  }
  override async archive(raw: S.SuitePin): Promise<S.SuiteRecord> {
    const input = S.suitePin.parse(raw);
    this.protectDecision(await this.get(input));
    return super.archive(input);
  }
  override async previewCleanup(raw: S.SuiteScope & { references: S.SuiteRef[] }) {
    const input = S.suiteScope
      .extend({ references: z.array(S.suiteRef).min(1).max(50) })
      .strict()
      .parse(raw);
    await this.protectCleanup({ workspaceId: input.workspaceId }, input.references);
    return super.previewCleanup(input);
  }
  override async cleanup(raw: S.SuiteApproval): Promise<S.SuiteRecord> {
    const input = S.suiteApproval.parse(raw),
      scope = { workspaceId: input.workspaceId },
      plan = await this.inspectPlan({ ...scope, planId: input.planId });
    if (plan.action === 'cleanup' && plan.state !== 'completed') {
      const selection = z
        .object({
          recoveryOf: S.suiteId.optional(),
          selected: z
            .array(z.object({ reference: S.suiteRef, dependencies: z.array(S.suiteRef) }).strict())
            .min(1)
            .max(50),
        })
        .strict()
        .parse(plan.input);
      await this.protectCleanup(
        scope,
        selection.selected.map((item) => item.reference),
      );
    }
    return super.cleanup(input);
  }
  protected override async releaseOwned(_scope: S.SuiteScope, record: S.SuiteRecord): Promise<void> {
    // 兼容已签发的旧清理计划及恢复入口，最终物理删除前仍须拒绝决定记录。
    this.protectDecision(record);
  }
  private async assessment(
    scope: S.SuiteScope,
    selection: z.infer<typeof R.incidentReviewSelection>,
  ): Promise<R.IncidentReviewAssessment> {
    this.unique(this.all(selection));
    this.assertDomain(selection.case, 'incident-cases');
    this.assertDomain(selection.timeline, 'incident-timeline');
    const selectedCase = await this.fixed(scope, selection.case),
      caseValue = I.incidentCase.parse(selectedCase.content),
      currentCase = await this.cases.scope(scope),
      currentCaseValue = I.incidentCase.parse(currentCase.content),
      workspace = await this.cases.workspace(scope),
      timelineRecord = await this.fixed(scope, selection.timeline),
      timeline = I.incidentTimeline.parse(timelineRecord.content);
    if (
      timeline.case.id !== selectedCase.id ||
      timeline.case.domain !== selection.case.domain ||
      currentCase.id !== selectedCase.id
    )
      suiteFail('INCIDENT_REVIEW_CASE_MISMATCH', '所选窗口属于不同案例');
    const selectedKeys = new Set(selection.evidence.map(suiteHash));
    if (
      timeline.evidence.length !== selectedKeys.size ||
      timeline.evidence.some((reference) => !selectedKeys.has(suiteHash(reference)))
    )
      suiteFail('INCIDENT_REVIEW_EVIDENCE_WINDOW', '所选证据必须与该时间线的完整窗口一致');
    const permissions: R.IncidentReviewAssessment['permissions'] = [];
    const remember = (row: S.SuiteRecord) =>
      permissions.push({
        ref: ref(row),
        policyRevision: row.policyRevision,
        digest: row.authorizationDigest ?? suiteHash(row.policyRevision),
      });
    remember(selectedCase);
    remember(timelineRecord);
    const sources: R.IncidentReviewAssessment['evidence'] = [];
    let invalidCapture = false;
    for (const reference of selection.evidence) {
      this.assertDomain(reference, 'incident-evidence');
      const row = await this.fixed(scope, reference),
        value = I.incidentEvidence.parse(row.content);
      if (value.case.id !== selectedCase.id || value.case.domain !== selection.case.domain)
        suiteFail('INCIDENT_REVIEW_CASE_MISMATCH');
      this.assertDomain(value.source, 'incident-evidence');
      const source = await this.fixed(scope, value.source),
        material = S.suiteMaterial.parse(source.content);
      if (source.kind !== 'source' || material.digest !== value.sourceDigest)
        suiteFail('INCIDENT_REVIEW_SOURCE_DIGEST');
      if (['metrics', 'health'].includes(value.method) && !value.externalStatement && !value.capture)
        invalidCapture = true;
      const redaction = value.derivation
        ? await this.evidence.redactionStatus(pin(scope, reference))
        : { reviewed: false, exportGranted: false, effective: false };
      sources.push({
        ref: reference,
        name: row.name,
        method: value.method,
        externalStatement: value.externalStatement,
        sourceDigest: value.sourceDigest,
        sourceAt: value.sourceAt,
        observedAt: value.observedAt,
        redaction: { derived: !!value.derivation, ...redaction },
      });
      remember(row);
    }
    const hypotheses: R.IncidentReviewAssessment['hypotheses'] = [];
    const eventIds = new Set(timeline.events.map((event) => event.id));
    for (const reference of selection.hypotheses) {
      this.assertDomain(reference, 'incident-hypotheses');
      const row = await this.fixed(scope, reference),
        value = I.incidentHypothesis.parse(row.content);
      if (
        value.case.id !== selectedCase.id ||
        value.case.domain !== selection.case.domain ||
        !same(value.timeline, selection.timeline)
      )
        suiteFail('INCIDENT_REVIEW_HYPOTHESIS_WINDOW', '假设须引用此案例及同一时间线修订');
      if ([...value.support, ...value.against].some((id) => !eventIds.has(id)))
        suiteFail('INCIDENT_REVIEW_EVENT_REFERENCE');
      hypotheses.push({
        ref: reference,
        name: row.name,
        explanation: value.explanation,
        status: value.status,
        reason: value.reason,
        judgment: 'manual',
        supportCount: value.support.length,
        againstCount: value.against.length,
        pending: value.pending,
      });
      remember(row);
    }
    const actions: R.IncidentReviewAssessment['actions'] = [];
    for (const reference of selection.actions) {
      this.assertDomain(reference, 'incident-actions');
      const row = await this.fixed(scope, reference),
        value = A.incidentAction.parse(row.content);
      if (value.case.id !== selectedCase.id || value.case.domain !== selection.case.domain)
        suiteFail('INCIDENT_REVIEW_CASE_MISMATCH');
      if (value.kind === 'manual') {
        actions.push({
          ref: reference,
          name: row.name,
          kind: 'manual',
          status: 'manual-declaration',
          proofSource: 'manual-declaration',
          proofDigest: null,
          resourceState: 'manual-declaration',
          fact: null,
          statement: value.statement,
        });
      } else {
        let inspected: Awaited<ReturnType<IncidentActionsV1['inspect']>>;
        try {
          inspected = await this.actions.inspect({ ...scope, action: reference });
        } catch (error) {
          // 原提供者已压缩旧回执时，只保留本地历史声明；权限或代次失败仍传播。
          if (
            !(error instanceof AppError) ||
            !['DELEGATED_RECEIPT_NOT_FOUND', 'DELEGATED_PROVIDER_UNAVAILABLE'].includes(error.code || '')
          )
            throw error;
          inspected = {
            record: await this.fixed(scope, reference),
            provider: null,
            providerAvailable: false,
          };
        }
        if (!same(ref(inspected.record), reference)) suiteFail('INCIDENT_REVIEW_ACTION_CHANGED');
        const proof = inspected.providerAvailable ? inspected.provider : value.receipt;
        const result = this.actionFact(proof);
        actions.push({
          ref: reference,
          name: row.name,
          kind: 'delegated',
          status: inspected.providerAvailable ? result.status : 'unavailable',
          proofSource: inspected.providerAvailable
            ? 'current-provider'
            : proof
              ? 'saved-receipt'
              : 'unavailable',
          proofDigest: proof ? suiteHash(proof) : null,
          resourceState: inspected.providerAvailable ? result.resourceState : 'unknown',
          fact: result.fact,
          statement: null,
        });
      }
      remember(row);
    }
    const unresolved = [...selection.unresolved, ...caseValue.unresolved];
    for (const h of hypotheses)
      if (['open', 'unresolved'].includes(h.status) || h.pending.length)
        unresolved.push(`假设「${h.name}」状态为 ${h.status}，另有 ${h.pending.length} 项待验证。`);
    for (const a of actions)
      if (
        a.kind === 'delegated' &&
        (a.resourceState === 'unknown' ||
          ['unknown', 'consumed', 'dispatching', 'unavailable', 'invalid-proof', 'ready'].includes(a.status))
      )
        unresolved.push(`动作「${a.name}」当前为 ${a.status}，不能据此认定处置或资源核销已完成。`);
    if (currentCaseValue.status === 'open') unresolved.push('案例仍处于打开状态。');
    const findings: R.IncidentReviewAssessment['findings'] = [
      {
        code: 'SELECTED_SCOPE_ONLY',
        severity: 'note',
        message: '本次只覆盖明确选定的固定窗口，未声称已检查案例中的全部对象。',
      },
      {
        code: 'CLOCK_UNCERTAIN',
        severity: 'warning',
        message: '时间线按采集顺序显示；时钟注释均为人工声明，不能据此推断跨来源严格先后或因果。',
      },
    ];
    if (!same(selection.case, ref(currentCase)))
      findings.push({
        code: 'CASE_CHANGED',
        severity: 'blocking',
        message: '案例范围或状态已变化，须为当前案例修订重新打开审阅。',
      });
    if (!timeline.events.length)
      findings.push({
        code: 'NO_EVENTS',
        severity: 'blocking',
        message: '选定时间线没有事件，请补充有效材料。',
      });
    if (invalidCapture)
      findings.push({
        code: 'CAPTURE_PROOF_MISSING',
        severity: 'blocking',
        message: '本地采集声明缺少原采集凭据。',
      });
    if (sources.some((source) => source.externalStatement))
      findings.push({
        code: 'EXTERNAL_DECLARATIONS',
        severity: 'note',
        message: '窗口含外来上传或人工声明，不将这些内容当作原提供者执行证明。',
      });
    if (timeline.unsupportedLines || timeline.truncatedMessages)
      findings.push({
        code: 'DISPLAY_LIMITS',
        severity: 'warning',
        message: `时间线含 ${timeline.unsupportedLines} 项未结构化内容和 ${timeline.truncatedMessages} 项显示截短；原字节及摘要继续保留。`,
      });
    if (hypotheses.some((h) => h.supportCount && h.againstCount))
      findings.push({
        code: 'CONFLICTING_EVIDENCE',
        severity: 'warning',
        message: '选定假设同时存在支持与相反依据，人工判断不等于因果已证实。',
      });
    if (actions.some((a) => a.status === 'invalid-proof'))
      findings.push({
        code: 'PROVIDER_PROOF_INVALID',
        severity: 'blocking',
        message: '原处置回执格式或目标无法核对，须先核对原提供者。',
      });
    if (actions.some((a) => a.resourceState === 'unknown'))
      findings.push({
        code: 'ACTION_UNCONFIRMED',
        severity: 'warning',
        message: '窗口含未确认的处置或资源状态，复盘必须继续披露这些未决项。',
      });
    const result = R.incidentReviewAssessment.parse({
      format: 'sakura-incident-review-assessment/1',
      case: selection.case,
      currentCase: ref(currentCase),
      caseState: currentCaseValue.status,
      workspacePolicyRevision: workspace.policyRevision,
      selectedScopeOnly: true,
      evidence: sources,
      timeline: {
        ref: selection.timeline,
        eventCount: timeline.events.length,
        displayOrder: 'collection-order',
        crossSourceOrder: 'uncertain',
        clockAnnotations: timeline.clockNotes.length,
        clockNotes: timeline.clockNotes,
        clockAnnotationsVerified: false,
        unsupportedLines: timeline.unsupportedLines,
        truncatedMessages: timeline.truncatedMessages,
      },
      hypotheses,
      actions,
      unresolved: [...new Set(unresolved)],
      findings,
      permissions,
      noCausalConclusion: true,
      exportReady:
        sources.length > 0 &&
        sources.every((source) => source.redaction.derived && source.redaction.effective),
    });
    if (suiteBytes(result) > 2 * 1024 ** 2)
      suiteFail('INCIDENT_REVIEW_SCOPE_LIMIT', '审阅摘要超过 2 MiB，请选择较小窗口');
    await this.access(scope);
    return result;
  }
  private actionFact(
    receipt: DelegatedReceipt | null,
  ): Pick<R.IncidentReviewAssessment['actions'][number], 'status' | 'resourceState' | 'fact'> {
    if (!receipt) return { status: 'unknown', resourceState: 'unknown', fact: null };
    if (receipt.status !== 'returned')
      return {
        status: receipt.status,
        resourceState: ['ready', 'rejected', 'expired'].includes(receipt.status)
          ? 'not-dispatched'
          : 'unknown',
        fact: null,
      };
    if (receipt.plan.input.adapter === 'maintenance-cleanup') {
      const result = cleanupResultSchema.safeParse(receipt.result);
      if (!result.success || result.data.provider !== receipt.plan.input.provider)
        return { status: 'invalid-proof', resourceState: 'unknown', fact: null };
      return {
        status: 'returned',
        resourceState: 'request-returned',
        fact: { adapter: 'maintenance-cleanup', ...result.data },
      };
    }
    if (receipt.plan.input.adapter !== 'resilience-reconcile') return { status: 'invalid-proof', resourceState: 'unknown', fact: null };
    const result = resilienceResult.safeParse(receipt.result);
    if (!result.success || result.data.runId !== receipt.plan.input.runId)
      return { status: 'invalid-proof', resourceState: 'unknown', fact: null };
    return {
      status: 'returned',
      resourceState:
        result.data.cleanup === 'confirmed' && result.data.containment === 'confirmed'
          ? 'cleanup-confirmed'
          : 'unknown',
      fact: { adapter: 'resilience-reconcile', ...result.data },
    };
  }
  async open(raw: z.input<typeof R.incidentReviewOpen>) {
    const input = R.incidentReviewOpen.parse(raw),
      scope = { workspaceId: input.workspaceId },
      currentCase = await this.cases.scope(scope);
    const selection = R.incidentReviewSelection.parse({
      case: ref(currentCase),
      timeline: input.timeline,
      evidence: input.evidence,
      hypotheses: input.hypotheses,
      actions: input.actions,
      unresolved: input.unresolved,
    });
    const assessment = await this.assessment(scope, selection);
    return this.put(
      {
        ...scope,
        name: input.name,
        references: this.all(selection),
        content: json(
          R.incidentReview.parse({
            format: 'sakura-incident-review/1',
            selection,
            assessment,
            assessmentDigest: suiteHash(assessment),
            decision: 'pending',
            reason: '',
            checklist: emptyChecklist(),
            decidedBy: null,
            decidedAt: null,
          }),
        ),
      },
      'review',
      true,
    );
  }
  async decide(raw: z.infer<typeof R.incidentReviewDecide>) {
    const input = R.incidentReviewDecide.parse(raw),
      scope = { workspaceId: input.workspaceId };
    this.assertDomain(input.review, this.domain);
    const row = await this.fixed(scope, input.review),
      value = this.reviewValue(row),
      assessment = await this.assessment(scope, value.selection);
    if (input.decision === 'accept') {
      if (suiteHash(assessment) !== value.assessmentDigest)
        suiteFail('INCIDENT_REVIEW_CHANGED', '核对摘要已变化，请查看当前状态并重新打开审阅');
      if (!Object.values(input.checklist).every(Boolean))
        suiteFail('INCIDENT_REVIEW_CHECKLIST', '请逐项核对选定范围、声明、时钟、推断、回执及未决项');
      if (assessment.findings.some((finding) => finding.severity === 'blocking'))
        suiteFail('INCIDENT_REVIEW_BLOCKED', '审阅仍有必须先处理的缺口');
    }
    return this.put(
      {
        ...scope,
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        references: row.references,
        content: json(
          R.incidentReview.parse({
            ...value,
            assessment,
            assessmentDigest: suiteHash(assessment),
            decision: input.decision === 'accept' ? 'accepted' : 'rejected',
            reason: input.reason,
            checklist: input.checklist,
            decidedBy: suiteActor(),
            decidedAt: new Date().toISOString(),
          }),
        ),
      },
      'review',
      true,
    );
  }
  async recheck(raw: z.infer<typeof R.incidentReviewPin>): Promise<R.IncidentReviewCheck> {
    const input = R.incidentReviewPin.parse(raw),
      scope = { workspaceId: input.workspaceId };
    this.assertDomain(input.review, this.domain);
    const row = await this.fixed(scope, input.review),
      value = this.reviewValue(row),
      assessment = await this.assessment(scope, value.selection),
      digest = suiteHash(assessment),
      head = (await this.readState()).rows
        .filter((candidate) => candidate.workspaceId === scope.workspaceId && candidate.id === row.id)
        .at(-1),
      latest = head?.revision === row.revision && head.state === 'sealed',
      current =
        latest &&
        digest === value.assessmentDigest &&
        !assessment.findings.some((finding) => finding.severity === 'blocking');
    const reasons = assessment.findings
      .filter((finding) => finding.severity === 'blocking')
      .map((finding) => finding.message);
    if (!latest) reasons.push('此审阅已有较新决定，旧修订仅作历史参考。');
    if (digest !== value.assessmentDigest)
      reasons.push('选定窗口的当前许可、案例或原处置状态已改变，须重新人工审阅。');
    await this.fixed(scope, input.review);
    return R.incidentReviewCheck.parse({
      review: input.review,
      decision: value.decision,
      current,
      accepted: value.decision === 'accepted' && current,
      reasons,
      assessment,
      assessmentDigest: digest,
    });
  }
  async latestDecision(raw: z.infer<typeof R.incidentReviewPin>): Promise<R.IncidentReviewLatestDecision> {
    const input = R.incidentReviewPin.parse(raw),
      scope = { workspaceId: input.workspaceId };
    this.assertDomain(input.review, this.domain);
    await this.access(scope);
    const select = async () => {
      const state = await this.readState();
      if (state.rows.length > 5000)
        suiteFail('INCIDENT_REVIEW_LIST_LIMIT', '审阅元数据超过 5000 行，无法有界核对最新决定', 413);
      const rows = state.rows.filter(
          (row) =>
            row.workspaceId === scope.workspaceId &&
            row.actor === suiteActor() &&
            row.id === input.review.id &&
            row.domain === this.domain,
        ),
        requested = rows.find((row) => row.revision === input.review.revision),
        latest = rows.reduce<S.SuiteRecord | undefined>(
          (head, row) => (!head || row.sequence > head.sequence ? row : head),
          undefined,
        );
      if (!requested || !latest) suiteFail('SUITE_REVISION_NOT_FOUND', '固定审阅不存在', 404);
      for (const row of [requested, latest]) {
        const { id, parent, sequence, content, references } = row;
        if (row.revision !== suiteHash({ id, parent, sequence, content, references }))
          suiteFail('SUITE_DIGEST_MISMATCH');
        if (row.origin !== 'local') suiteFail('SUITE_IMPORTED_EVIDENCE', '外来审阅不能充当本地批准证明', 403);
        if (row.state !== 'sealed') suiteFail('SUITE_INPUT_NOT_SEALED', '审阅须为封存修订');
        const value = this.reviewValue(row);
        if (suiteHash(row.references) !== suiteHash(this.all(value.selection)))
          suiteFail('INCIDENT_REVIEW_INTEGRITY');
      }
      return { requested, latest };
    };
    const { requested, latest } = await select(),
      value = this.reviewValue(latest);
    // 此方法不重新评估历史事实，也不递归读取时间线正文。交换服务另行核对完整原图。
    await withSuiteReferenceBudget(async () => {
      const checked = new Set<string>();
      for (const selection of [this.reviewValue(requested).selection, value.selection]) {
        this.assertDomain(selection.case, 'incident-cases');
        if (!checked.has(suiteHash(selection.case))) {
          await this.fixed(scope, selection.case);
          checked.add(suiteHash(selection.case));
        }
        for (const source of selection.evidence) {
          this.assertDomain(source, 'incident-evidence');
          if (!checked.has(suiteHash(source))) {
            await this.evidence.pin(pin(scope, source));
            checked.add(suiteHash(source));
          }
        }
        for (const action of selection.actions) {
          this.assertDomain(action, 'incident-actions');
          if (!checked.has(suiteHash(action))) {
            await this.fixed(scope, action);
            checked.add(suiteHash(action));
          }
        }
      }
    });
    const confirmed = await select();
    if (confirmed.latest.revision !== latest.revision)
      suiteFail('INCIDENT_REVIEW_DECISION_CHANGED', '审阅决定在核对期间改变，请重新读取');
    await this.access(scope);
    return R.incidentReviewLatestDecision.parse({
      review: input.review,
      latest: ref(latest),
      decision: value.decision,
      current: latest.revision === requested.revision,
    });
  }
}

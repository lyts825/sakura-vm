/** 固定复盘报告通过已接受的审阅传递来源保护，人工叙述与原执行事实分开保存。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as R from '../shared/contracts/incident-reviews.ts';
import type { IncidentCasesV1 } from './service-contracts/incident-desk.ts';
import type { IncidentReviewsV1, IncidentReportsV1 } from './service-contracts/incident-reviews.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteStore, suiteActor, suiteHash, suiteFail, type SuiteAuthorize } from './suite-store.ts';
const ref = (row: S.SuiteRecord): S.SuiteRef => ({ domain: row.domain, id: row.id, revision: row.revision });
const pin = (scope: S.SuiteScope, reference: S.SuiteRef) => ({
  ...scope,
  id: reference.id,
  revision: reference.revision,
});
const json = (value: unknown) => S.suiteJson.parse(value);
export class IncidentReports extends SuiteStore implements IncidentReportsV1 {
  constructor(
    metadata: PluginMetadata,
    authorize: SuiteAuthorize,
    private cases: IncidentCasesV1,
    private reviews: IncidentReviewsV1,
  ) {
    super('incident-reports', metadata, authorize, cases, {
      'incident-cases': cases,
      'incident-reviews': reviews,
    });
  }
  private assertDomain(reference: S.SuiteRef, expected: string) {
    if (reference.domain !== expected) suiteFail('INCIDENT_REPORT_DOMAIN');
  }
  private reportValue(row: S.SuiteRecord) {
    if (row.kind !== 'result') suiteFail('INCIDENT_REPORT_REQUIRED');
    const value = R.incidentReport.parse(row.content);
    if (suiteHash(value.facts) !== value.assessmentDigest) suiteFail('INCIDENT_REPORT_INTEGRITY');
    return value;
  }
  private async accepted(scope: S.SuiteScope, review: S.SuiteRef) {
    this.assertDomain(review, 'incident-reviews');
    const reviewRecord = await this.fixed(scope, review),
      original = R.incidentReview.parse(reviewRecord.content);
    const checked = R.incidentReviewCheck.parse(await this.reviews.recheck({ ...scope, review }));
    if (
      reviewRecord.kind !== 'review' ||
      original.decision !== 'accepted' ||
      original.assessmentDigest !== checked.assessmentDigest ||
      suiteHash(checked.assessment) !== checked.assessmentDigest ||
      suiteHash(checked.review) !== suiteHash(review) ||
      !checked.accepted ||
      !checked.current
    )
      suiteFail('INCIDENT_REPORT_REVIEW_REQUIRED', '报告须引用已接受且当前仍有效的复盘审阅');
    const currentCase = await this.cases.scope(scope);
    if (suiteHash(ref(currentCase)) !== suiteHash(checked.assessment.case))
      suiteFail('INCIDENT_REPORT_CASE_CHANGED');
    return checked;
  }
  async draft(raw: z.infer<typeof R.incidentReportDraft>) {
    const input = R.incidentReportDraft.parse(raw),
      scope = { workspaceId: input.workspaceId },
      checked = await this.accepted(scope, input.review);
    let prior: S.SuiteRecord | undefined;
    if (input.report) {
      this.assertDomain(input.report, this.domain);
      prior = await this.fixed(scope, input.report);
      const value = this.reportValue(prior);
      if (value.status === 'sealed')
        suiteFail('INCIDENT_REPORT_SEALED', '封存报告保持固定；请另建草稿并比较版本');
      if (value.case.id !== checked.assessment.case.id) suiteFail('INCIDENT_REPORT_CASE_CHANGED');
    }
    return this.put(
      {
        ...scope,
        ...(prior ? { id: prior.id, expectedRevision: prior.revision } : {}),
        name: input.title,
        references: [checked.assessment.case, input.review],
        content: json(
          R.incidentReport.parse({
            format: 'sakura-incident-report/1',
            case: checked.assessment.case,
            review: input.review,
            status: 'draft',
            summary: input.summary,
            narrative: input.narrative,
            narrativeKind: 'manual',
            facts: checked.assessment,
            assessmentDigest: checked.assessmentDigest,
            author: suiteActor(),
            sealedBy: null,
            sealedAt: null,
            selectedScopeOnly: true,
            noCausalConclusion: true,
          }),
        ),
      },
      'result',
      true,
    );
  }
  override async seal(raw: S.SuitePin) {
    const input = R.incidentReportSeal.parse(raw),
      scope = { workspaceId: input.workspaceId },
      reference = { domain: this.domain, id: input.id, revision: input.revision };
    const row = await this.fixed(scope, reference),
      value = this.reportValue(row);
    if (value.status === 'sealed') return row;
    const head = (await this.readState()).rows
      .filter((record) => record.workspaceId === scope.workspaceId && record.id === row.id)
      .at(-1);
    if (
      head &&
      head.parent === row.revision &&
      R.incidentReport.safeParse(head.content).success &&
      this.reportValue(head).status === 'sealed'
    )
      return this.get(pin(scope, ref(head)));
    const checked = await this.accepted(scope, value.review);
    if (
      checked.assessmentDigest !== value.assessmentDigest ||
      suiteHash(checked.assessment) !== suiteHash(value.facts)
    )
      suiteFail('INCIDENT_REPORT_ASSESSMENT_CHANGED', '报告草稿与当前审阅摘要不一致，请重新生成草稿');
    return this.put(
      {
        ...scope,
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        references: row.references,
        content: json(
          R.incidentReport.parse({
            ...value,
            status: 'sealed',
            sealedBy: suiteActor(),
            sealedAt: new Date().toISOString(),
          }),
        ),
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof R.incidentReportCompare>) {
    const input = R.incidentReportCompare.parse(raw),
      scope = { workspaceId: input.workspaceId };
    this.assertDomain(input.before, this.domain);
    this.assertDomain(input.after, this.domain);
    const before = this.reportValue(await this.fixed(scope, input.before)),
      after = this.reportValue(await this.fixed(scope, input.after));
    if (before.case.id !== after.case.id) suiteFail('INCIDENT_REPORT_CASE_CHANGED', '比较须属于同一案例');
    const list = (facts: R.IncidentReviewAssessment) => [
        facts.timeline.ref,
        ...facts.evidence.map((item) => item.ref),
        ...facts.hypotheses.map((item) => item.ref),
        ...facts.actions.map((item) => item.ref),
      ],
      left = list(before.facts),
      right = list(after.facts),
      leftKeys = new Set(left.map(suiteHash)),
      rightKeys = new Set(right.map(suiteHash));
    return this.put(
      {
        ...scope,
        name: '复盘报告比较',
        references: [input.before, input.after],
        content: json({
          format: 'sakura-incident-report-comparison/1',
          before: input.before,
          after: input.after,
          caseChanged: !same(before.case, after.case),
          reviewChanged: !same(before.review, after.review),
          narrativeChanged:
            suiteHash({ summary: before.summary, narrative: before.narrative }) !==
            suiteHash({ summary: after.summary, narrative: after.narrative }),
          factsChanged: before.assessmentDigest !== after.assessmentDigest,
          added: right.filter((reference) => !leftKeys.has(suiteHash(reference))),
          removed: left.filter((reference) => !rightKeys.has(suiteHash(reference))),
          causalConclusion: null,
          selectedScopeOnly: true,
        }),
      },
      'result',
      true,
    );
  }
}
function same(a: S.SuiteRef, b: S.SuiteRef) {
  return suiteHash(a) === suiteHash(b);
}

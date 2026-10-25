/** 案例窗口只约束本案例的新动作；原提供者继续持有执行和中断后的证明。 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as I from '../shared/contracts/incident-desk.ts';
import * as A from '../shared/contracts/incident-actions.ts';
import { delegatedReceiptSchema } from '../shared/contracts/delegated-actions.ts';
import type { DelegatedActionsV1 } from './service-contracts/delegated-actions.ts';
import type {
  IncidentActionsV1,
  IncidentCasesV1,
  IncidentEvidenceV1,
  IncidentRunbooksV1,
} from './service-contracts/incident-desk.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { SuiteStore, suiteActor, suiteFail, suiteHash, type SuiteAuthorize } from './suite-store.ts';
const ref = (record: S.SuiteRecord): S.SuiteRef => ({
  domain: record.domain,
  id: record.id,
  revision: record.revision,
});
const json = (value: unknown) => S.suiteJson.parse(value);
export class IncidentActions extends SuiteStore implements IncidentActionsV1 {
  constructor(
    metadata: PluginMetadata,
    authorize: SuiteAuthorize,
    private cases: IncidentCasesV1,
    evidence: IncidentEvidenceV1,
    runbooks: IncidentRunbooksV1,
    private delegated: () => DelegatedActionsV1 | undefined,
  ) {
    super('incident-actions', metadata, authorize, cases, {
      'incident-cases': cases,
      'incident-evidence': evidence,
      'incident-runbooks': runbooks,
    });
  }
  private host() {
    return this.delegated() ?? suiteFail('DELEGATED_HOST_UNAVAILABLE', '原动作委派服务未运行', 503);
  }
  async providers() {
    await this.access();
    const host = this.delegated();
    return host
      ? host.providers()
      : [
          { adapter: 'maintenance-cleanup' as const, available: false },
          { adapter: 'resilience-reconcile' as const, available: false },
        ];
  }
  private async current(scope: S.SuiteScope, expected?: S.SuiteRef) {
    const record = await this.cases.scope(scope),
      value = I.incidentCase.parse(record.content);
    if (value.status !== 'open' || (expected && suiteHash(ref(record)) !== suiteHash(expected)))
      suiteFail('INCIDENT_CASE_CHANGED', '案例状态或修订已改变，请重新预览');
    return record;
  }
  private async sources(scope: S.SuiteScope, records: S.SuiteRef[], caseRef: S.SuiteRef) {
    const seen = new Set<string>();
    for (const source of records) {
      if (seen.has(suiteHash(source))) suiteFail('INCIDENT_EVIDENCE_DUPLICATE');
      seen.add(suiteHash(source));
      if (source.domain !== 'incident-evidence') suiteFail('INCIDENT_EVIDENCE_DOMAIN');
      const record = await this.fixed(scope, source),
        value = I.incidentEvidence.parse(record.content);
      if (value.case.id !== caseRef.id || value.case.domain !== caseRef.domain)
        suiteFail('INCIDENT_CASE_CHANGED');
    }
  }
  private async step(scope: S.SuiteScope, runbook: S.SuiteRef, stepId: string, caseRef: S.SuiteRef) {
    if (runbook.domain !== 'incident-runbooks') suiteFail('INCIDENT_RUNBOOK_DOMAIN');
    const record = await this.fixed(scope, runbook),
      value = I.incidentRunbook.parse(record.content);
    if (value.case.id !== caseRef.id || value.case.domain !== caseRef.domain)
      suiteFail('INCIDENT_CASE_CHANGED');
    const step = value.steps.find((step) => step.id === stepId);
    if (!step || step.kind !== 'delegated')
      suiteFail('INCIDENT_STEP_NOT_DELEGATED', '此步骤没有原提供者动作');
    return step;
  }
  async planAction(raw: z.infer<typeof A.incidentPlanAction>) {
    const input = A.incidentPlanAction.parse(raw),
      scope = { workspaceId: input.workspaceId };
    const record = await this.current(scope),
      caseRef = ref(record);
    await this.sources(scope, input.evidence, caseRef);
    const step = await this.step(scope, input.runbook, input.stepId, caseRef);
    const providerPlan = await this.host().preview(step.target);
    if (providerPlan.actorId !== suiteActor() || suiteHash(providerPlan.input) !== suiteHash(step.target))
      suiteFail('INCIDENT_PROVIDER_PLAN_CHANGED');
    await this.current(scope, caseRef);
    return this.plan(
      scope,
      'delegated-action',
      json(
        A.incidentActionPlanInput.parse({
          runbook: input.runbook,
          stepId: input.stepId,
          evidence: input.evidence,
          case: caseRef,
          providerPlan,
        }),
      ),
      [caseRef, input.runbook, ...input.evidence],
    );
  }
  async submitAction(raw: S.SuiteApproval, signal?: AbortSignal) {
    const plan = await this.consume(raw, 'delegated-action'),
      scope = { workspaceId: plan.workspaceId };
    if (plan.state === 'completed' && plan.result)
      return this.get({ ...scope, id: plan.result.id, revision: plan.result.revision });
    const input = A.incidentActionPlanInput.parse(plan.input);
    await this.current(scope, input.case);
    const step = await this.step(scope, input.runbook, input.stepId, input.case);
    await this.sources(scope, input.evidence, input.case);
    if (suiteHash(step.target) !== suiteHash(input.providerPlan.input))
      suiteFail('INCIDENT_PROVIDER_PLAN_CHANGED');
    const base = A.incidentDelegatedAction.parse({
      format: 'sakura-incident-action/1',
      kind: 'delegated',
      planId: plan.id,
      case: input.case,
      runbook: input.runbook,
      stepId: input.stepId,
      evidence: input.evidence,
      providerPlan: input.providerPlan,
      phase: 'prepared',
      receipt: null,
      submittedBy: suiteActor(),
      inference: 'provider-state-only',
    });
    // 派发前先保存票据的查询入口。请求随后被撤销时也能在新会话核对原提供者。
    let action = await this.put(
      { ...scope, name: step.label, content: json(base), references: plan.references },
      'result',
      true,
    );
    const outcome = await this.cases.withOpenCase({ ...scope, expected: input.case }, async () => {
      const receipt = await this.host().dispatch(
        input.providerPlan.ticket,
        async (original) => {
          if (suiteHash(original) !== suiteHash(input.providerPlan))
            suiteFail('INCIDENT_PROVIDER_PLAN_CHANGED');
          await this.current(scope, input.case);
          await this.sources(scope, input.evidence, input.case);
          action = await this.put(
            {
              ...scope,
              id: action.id,
              expectedRevision: action.revision,
              name: action.name,
              references: plan.references,
              content: json({ ...base, phase: 'intent-recorded' }),
            },
            'result',
            true,
          );
          return { intentDigest: action.revision };
        },
        signal,
      );
      const confirmed = delegatedReceiptSchema.parse(receipt);
      if (suiteHash(confirmed.plan) !== suiteHash(input.providerPlan))
        suiteFail('INCIDENT_PROVIDER_RECEIPT_CHANGED');
      action = await this.put(
        {
          ...scope,
          id: action.id,
          expectedRevision: action.revision,
          name: action.name,
          references: plan.references,
          content: json({
            ...base,
            phase: confirmed.status === 'unknown' ? 'unknown' : 'provider-returned',
            receipt: confirmed,
          }),
        },
        'result',
        true,
      );
      return json(ref(action));
    });
    const completed = S.suiteRef.parse(outcome),
      result = await this.get({ ...scope, id: completed.id, revision: completed.revision });
    await this.complete(plan, result);
    return result;
  }
  async inspect(raw: S.SuiteScope & { action: S.SuiteRef }) {
    const input = S.suiteScope.extend({ action: S.suiteRef }).strict().parse(raw),
      scope = { workspaceId: input.workspaceId };
    if (input.action.domain !== this.domain) suiteFail('INCIDENT_ACTION_DOMAIN');
    const record = await this.fixed(scope, input.action),
      value = A.incidentAction.parse(record.content);
    if (value.kind === 'manual') return { record, provider: null, providerAvailable: false };
    const host = this.delegated();
    if (!host) return { record, provider: null, providerAvailable: false };
    const absent = async () => ({
      record: await this.fixed(scope, input.action),
      provider: null,
      providerAvailable: false,
    });
    const available = (await host.providers()).find(
      (row) => row.adapter === value.providerPlan.input.adapter,
    )?.available;
    if (!available) return absent();
    let provider;
    try {
      provider = await host.inspect(value.providerPlan.ticket);
    } catch (error) {
      if (
        error instanceof AppError &&
        ['DELEGATED_RECEIPT_NOT_FOUND', 'DELEGATED_PROVIDER_UNAVAILABLE'].includes(error.code || '')
      )
        return absent();
      throw error;
    }
    if (suiteHash(provider.plan) !== suiteHash(value.providerPlan))
      suiteFail('INCIDENT_PROVIDER_RECEIPT_CHANGED');
    await this.fixed(scope, input.action);
    return { record, provider, providerAvailable: true };
  }
  private async acknowledgementHead(scope: S.SuiteScope, original: S.SuiteRecord, reason: string) {
    const head = (await this.readState()).rows
      .filter(
        (row) =>
          row.workspaceId === scope.workspaceId && row.actor === suiteActor() && row.id === original.id,
      )
      .reduce<S.SuiteRecord | undefined>(
        (selected, row) => (!selected || row.sequence > selected.sequence ? row : selected),
        undefined,
      );
    if (!head) suiteFail('SUITE_REVISION_CONFLICT');
    const record = await this.fixed(scope, ref(head)),
      value = A.incidentAction.parse(record.content),
      before = A.incidentDelegatedAction.parse(original.content);
    if (value.kind !== 'delegated' || suiteHash(value.providerPlan) !== suiteHash(before.providerPlan))
      suiteFail('SUITE_REVISION_CONFLICT');
    if (value.receipt?.acknowledgedAt) {
      if (value.receipt.acknowledgedBy !== suiteActor() || value.receipt.acknowledgementReason !== reason)
        suiteFail('DELEGATED_ACKNOWLEDGEMENT_CONFLICT', '此动作已有不同的核对记录');
      return { record, acknowledged: true };
    }
    return { record, acknowledged: false };
  }
  async acknowledge(raw: z.infer<typeof A.incidentActionAcknowledgement>) {
    const input = A.incidentActionAcknowledgement.parse(raw),
      scope = { workspaceId: input.workspaceId };
    if (input.action.domain !== this.domain) suiteFail('INCIDENT_ACTION_DOMAIN');
    const record = await this.fixed(scope, input.action),
      value = A.incidentAction.parse(record.content);
    if (record.origin !== 'local' || value.kind !== 'delegated')
      suiteFail('INCIDENT_DELEGATED_ACTION_REQUIRED', '只能核对本机原提供者动作');
    const head = await this.acknowledgementHead(scope, record, input.reason);
    if (head.acknowledged) return head.record;
    if (head.record.revision !== record.revision) suiteFail('SUITE_REVISION_CONFLICT');
    const receipt = delegatedReceiptSchema.parse(
      await this.host().acknowledge(value.providerPlan.ticket, input.reason),
    );
    if (
      suiteHash(receipt.plan) !== suiteHash(value.providerPlan) ||
      receipt.acknowledgedBy !== suiteActor() ||
      receipt.acknowledgementReason !== input.reason
    )
      suiteFail('INCIDENT_PROVIDER_RECEIPT_CHANGED');
    try {
      return await this.put(
        {
          ...scope,
          id: record.id,
          expectedRevision: record.revision,
          name: record.name,
          references: record.references,
          content: json({
            ...value,
            phase: receipt.status === 'unknown' ? 'unknown' : 'provider-returned',
            receipt,
          }),
        },
        'result',
        true,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === 'SUITE_REVISION_CONFLICT') {
        const latest = await this.acknowledgementHead(scope, record, input.reason);
        if (latest.acknowledged) return latest.record;
      }
      throw error;
    }
  }
  async recordManual(raw: z.infer<typeof A.incidentManualActionInput>) {
    const input = A.incidentManualActionInput.parse(raw),
      scope = { workspaceId: input.workspaceId };
    const record = await this.current(scope);
    await this.sources(scope, input.evidence, ref(record));
    return this.put(
      {
        ...scope,
        name: input.name,
        references: [ref(record), ...input.evidence],
        content: json(
          A.incidentManualAction.parse({
            format: 'sakura-incident-action/1',
            kind: 'manual',
            case: ref(record),
            statement: input.statement,
            evidence: input.evidence,
            declaredBy: suiteActor(),
            systemExecution: false,
          }),
        ),
      },
      'result',
      true,
    );
  }
}

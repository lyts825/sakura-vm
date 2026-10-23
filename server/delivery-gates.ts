/** 版本化交付规则；未知执行、完整性和清理证据不可豁免。 Versioned gates with non-waivable integrity and unknown outcomes. */
import { assertDeliveryCandidate } from './delivery-candidate.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { DeliveryScope } from '../shared/contracts/delivery-common.ts';
import {
  deliveryPolicyInputSchema,
  deliveryPolicySchema,
  deliveryDecisionSchema,
  deliveryEvaluateSchema,
  type DeliveryPolicy,
  type DeliveryDecision,
} from '../shared/contracts/delivery-quality.ts';
import type { DeliveryArtifactsV1, DeliveryInputsV1 } from './service-contracts/delivery-storage.ts';
import type { DeliveryRunnersV1, DeliveryPreviewsV1 } from './service-contracts/delivery-execution.ts';
import type { DeliveryReports } from './delivery-reports.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { DeliveryQualityStore, qualityHash, sameScope } from './delivery-quality-store.ts';
const stateSchema = z
  .object({
    schemaVersion: z.literal(1),
    policies: z.array(deliveryPolicySchema).max(1000),
    decisions: z.array(deliveryDecisionSchema).max(10000),
  })
  .strict();
export class DeliveryGates {
  private store: DeliveryQualityStore<z.infer<typeof stateSchema>>;
  /** 绑定本机证据服务和受管 metadata/authorize；构造时不评估或写入规则。 Bind local evidence services and managed metadata/authorization without evaluating or persisting policies. */
  constructor(
    private artifacts: DeliveryArtifactsV1,
    private inputs: DeliveryInputsV1,
    private runners: DeliveryRunnersV1,
    private reports: Pick<DeliveryReports, 'get'>,
    private previews: DeliveryPreviewsV1,
    metadata: PluginMetadata,
    authorize: (scope: DeliveryScope) => void | Promise<void>,
  ) {
    this.store = new DeliveryQualityStore(
      metadata,
      () => ({ schemaVersion: 1, policies: [], decisions: [] }),
      authorize,
      (value) => stateSchema.parse(value),
    );
  }
  /** 返回 scope 已校验的规则与判定历史，不写状态。 Return validated policy and decision history for scope without writing. */
  async view(scope: DeliveryScope) {
    return stateSchema.parse(await this.store.read(scope));
  }
  /** 按 value.expectedRevision 追加 scope 的规则版本，返回新规则；并发版本冲突时拒绝。 Append a scoped policy at value.expectedRevision and return it, rejecting revision conflicts. */
  async savePolicy(scope: DeliveryScope, value: z.input<typeof deliveryPolicyInputSchema>) {
    const input = deliveryPolicyInputSchema.parse(value);
    return this.store.mutate(scope, (state) => {
      stateSchema.parse(state);
      const prior = state.policies.filter((p) => p.kind === input.kind).at(-1);
      if ((prior?.revision ?? 0) !== input.expectedRevision)
        throw new AppError('交付规则已变化，请刷新', 409);
      const { expectedRevision, ...definition } = input;
      const raw = {
        ...definition,
        id: randomUUID(),
        scope,
        revision: expectedRevision + 1,
        createdAt: new Date().toISOString(),
      };
      const policy = deliveryPolicySchema.parse({ ...raw, digest: qualityHash(raw) });
      state.policies.push(policy);
      return policy;
    });
  }
  /**
   * 按 value 所选规则和本机证据评估候选，持久化并返回新判定，不覆盖旧结果。
   * Evaluate the candidate against value's policy and local evidence, then persist and return a new decision.
   * 设计 / Design：完整性、运行与清理先独立检查；矩阵必需报告全部计入，豁免仅作用于明确允许的失败项。
   * Check integrity, execution and cleanup independently; require all matrix reports and waive only explicitly eligible failures.
   * 来源信任延后到登记和通道更新核验。 Source trust remains deferred to registration and channel changes.
   */
  async evaluate(scope: DeliveryScope, value: z.input<typeof deliveryEvaluateSchema>) {
    const input = deliveryEvaluateSchema.parse(value),
      candidate = assertDeliveryCandidate(scope, input.candidate);
    if (!sameScope(scope, candidate.scope)) throw new AppError('候选范围不匹配', 403);
    const policy = (await this.view(scope)).policies.find((p) => p.id === input.policyId);
    if (!policy) throw new AppError('交付规则不存在', 404);
    const checks: DeliveryDecision['checks'] = [],
      check = (rule: string, ok: boolean, detail: string, waivable = false, incomplete = false) =>
        checks.push({ rule, status: ok ? 'passed' : incomplete ? 'incomplete' : 'failed', detail, waivable });
    const manifest = await this.artifacts.get(scope, candidate.manifestId);
    const integrity = await this.artifacts.verify(scope, manifest.id);
    check(
      'integrity',
      manifest.digest === candidate.manifestDigest &&
        integrity.digest === candidate.manifestDigest &&
        manifest.files.length > 0,
      '制品完整性及候选摘要',
    );
    const runId = input.runId ?? candidate.runId;
    const run = runId ? await this.runners.get(scope, runId) : undefined;
    check(
      'run',
      !!run && run.state === 'finished' && run.result === 'success' && run.exitCode === 0,
      '本机运行须完整成功',
      false,
      !run || run.state !== 'finished' || run.result === 'interrupted',
    );
    check(
      'cleanup',
      run?.cleanup === 'verified',
      '有限执行的清理必须已确认',
      false,
      run?.cleanup !== 'verified',
    );
    check(
      'identity',
      !!run &&
        run.inputDigest === candidate.inputDigest &&
        (run.mode === 'build'
          ? run.outputManifestIds.includes(candidate.manifestId)
          : run.candidateDigest === candidate.digest),
      '运行与候选及产物必须一致',
    );
    check(
      'mode',
      policy.kind === 'build' ? run?.mode === 'build' : run?.mode === 'validate-artifact',
      '规则类型与本机构建或接收验证一致',
    );
    if (policy.kind === 'build') {
      const snapshot = candidate.inputId ? await this.inputs.get(scope, candidate.inputId) : undefined;
      check('input', snapshot?.digest === candidate.inputDigest, '输入快照存在且身份一致');
    }
    if (policy.requireEnvironment)
      check(
        'environment',
        run?.environmentVerified === true,
        '本次实际执行须核验声明环境',
        false,
        run?.environmentVerified !== true,
      );
    for (const step of policy.requiredSteps)
      check(
        'step:' + step,
        !!run?.cells.length &&
          run.cells.every((cell) => cell.steps.some((s) => s.id === step && s.state === 'passed')),
        '每个矩阵单元均需步骤通过：' + step,
      );
    const evidence = await Promise.all(input.evidenceIds.map((id) => this.reports.get(scope, id)));
    check(
      'evidence-identity',
      evidence.every((e) => e.candidateDigest === candidate.digest && e.runId === run?.id && !e.external),
      '证据必须来自同一候选的本机运行',
    );
    check(
      'evidence-complete',
      evidence.every(
        (e) => !['missing', 'malformed', 'truncated', 'cancelled', 'unknown'].includes(e.status),
      ),
      '缺失、损坏、截断、取消和未知报告不可豁免',
      false,
      evidence.some((e) => e.status !== 'passed' && e.status !== 'failed'),
    );
    const deadline = Date.now() - policy.maxAgeHours * 3600000;
    check(
      'freshness',
      !!run?.finishedAt &&
        Date.parse(run.finishedAt) >= deadline &&
        evidence.every((e) => Date.parse(e.createdAt) >= deadline),
      '执行及报告必须在有效期内',
      false,
      true,
    );
    if (policy.requireTests) {
      const tests = evidence.filter((e) => e.format === 'junit');
      check(
        'tests',
        tests.length > 0 &&
          tests.reduce((sum, e) => sum + e.tests - e.skipped, 0) > 0 &&
          tests.every((e) => e.failures === 0 && e.status === 'passed'),
        '必须有实际测试且无失败',
        true,
      );
    }
    check(
      'reports-quality',
      evidence.every((e) => e.status !== 'failed'),
      '所选证据不可隐去失败',
      true,
    );
    if (policy.minCoverage > 0) {
      const coverage = evidence.filter((e) => e.coverage !== null);
      check(
        'coverage',
        coverage.length > 0 && coverage.every((e) => (e.coverage ?? 0) >= policy.minCoverage),
        '覆盖率最低 ' + policy.minCoverage + '%',
        true,
      );
    }
    if (run && candidate.inputId) {
      const snapshot = await this.inputs.get(scope, candidate.inputId),
        required = snapshot.definition.reports.filter((report) => report.required);
      let complete = true;
      for (const cell of run.cells) {
        const manifests = await Promise.all(
          cell.reportManifestIds.map((id) => this.artifacts.get(scope, id)),
        );
        for (const report of required) {
          if (
            !manifests.some(
              (manifest) =>
                manifest.files.some((file) => file.path === report.path) &&
                evidence.some(
                  (item) =>
                    item.manifestId === manifest.id &&
                    item.path === report.path &&
                    item.format === report.format,
                ),
            )
          )
            complete = false;
        }
      }
      check(
        'matrix-reports',
        complete && (!required.length || run.cells.length > 0),
        '每个矩阵单元的声明必需报告均须采集及选择',
        false,
        !complete,
      );
    }
    if (policy.requirePreview) {
      const entries = (await this.previews.list(scope)).filter(
          (p) =>
            p.candidateDigest === candidate.digest &&
            p.manifestDigest === candidate.manifestDigest &&
            p.startupDigest === qualityHash(candidate.startup),
        ),
        preview = entries.at(-1);
      check(
        'preview',
        !!preview?.healthAt &&
          Date.parse(preview.healthAt) > Date.now() - 5 * 60000 &&
          ((preview.state === 'healthy' && Date.parse(preview.expiresAt) > Date.now()) ||
            (preview.state === 'stopped' && preview.cleanup === 'verified')),
        '须有最近五分钟的同候选预览；停止后须清理完成',
        false,
        true,
      );
    }
    if (policy.manualReview) check('review', input.reviewed, '所有者明确审阅本候选', true);
    if (policy.requireTrusted)
      checks.push({
        rule: 'trust-at-registration',
        status: 'deferred',
        detail: '此判定仅覆盖质量；来源签名尚待版本登记及每次通道晋级独立核验，未授予可信资格',
        waivable: false,
      });
    for (const waiver of input.waivers) {
      const target = checks.find((c) => c.rule === waiver.rule);
      if (!target || !target.waivable || target.status !== 'failed')
        throw new AppError('此规则不能豁免：' + waiver.rule, 409);
      target.status = 'waived';
      target.reason = waiver.reason;
    }
    const status = checks.some((c) => c.status === 'incomplete')
      ? 'incomplete'
      : checks.some((c) => c.status === 'failed')
        ? 'failed'
        : checks.some((c) => c.status === 'waived')
          ? 'waived'
          : 'passed';
    const createdAt = new Date().toISOString(),
      expiresAt = new Date(
        Math.min(Date.now(), run?.finishedAt ? Date.parse(run.finishedAt) : Date.now()) +
          policy.maxAgeHours * 3600000,
      ).toISOString();
    const raw = {
      id: randomUUID(),
      scope,
      candidateDigest: candidate.digest,
      policyId: policy.id,
      runId: run?.id,
      policyRevision: policy.revision,
      policyDigest: policy.digest,
      evidenceIds: evidence.map((e) => e.id),
      evidenceDigests: evidence.map((e) => e.digest),
      status,
      checks,
      createdAt,
      expiresAt,
    };
    const decision = deliveryDecisionSchema.parse({ ...raw, digest: qualityHash(raw) });
    await this.store.mutate(scope, (state) => {
      stateSchema.parse(state);
      state.decisions.push(decision);
    });
    return decision;
  }
  /** 校验 scope/decisionId 与 candidateDigest、最新规则、时限及证据摘要，返回判定和规则或抛错。 Validate decisionId against scope, candidateDigest, latest policy, expiry and evidence digests; return decision/policy or throw. */
  async assertCurrent(scope: DeliveryScope, decisionId: string, candidateDigest: string) {
    const state = await this.view(scope),
      decision = state.decisions.find((d) => d.id === decisionId);
    if (!decision || decision.candidateDigest !== candidateDigest) throw new AppError('判定不属于候选', 409);
    const policy = state.policies.find((p) => p.id === decision.policyId),
      latest = state.policies.filter((p) => p.kind === policy?.kind).at(-1);
    if (
      !policy ||
      latest?.id !== policy.id ||
      policy.digest !== decision.policyDigest ||
      Date.parse(decision.expiresAt) <= Date.now() ||
      !['passed', 'waived'].includes(decision.status)
    )
      throw new AppError('判定未通过、已过期或规则已变化', 409);
    for (let i = 0; i < decision.evidenceIds.length; i++) {
      const evidence = await this.reports.get(scope, decision.evidenceIds[i]);
      if (evidence.digest !== decision.evidenceDigests[i] || evidence.candidateDigest !== candidateDigest)
        throw new AppError('判定证据已变化', 409);
    }
    return { decision, policy };
  }
}

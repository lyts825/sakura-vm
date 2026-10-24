/** 封存真实运行和断言关联；缺失证据不能通过。 Sealed reports with cross-checked run evidence. */
import { randomUUID } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  IntegrationReportsV1,
  IntegrationSpecsV1,
  IntegrationAssertionsV1,
  IntegrationRunnersV1,
  IntegrationLoadV1,
} from './service-contracts/integration-lab.ts';
import { IntegrationRows, ilHash, ilBytes, ilFail } from './integration-store.ts';
import {
  reportSchema,
  type IntegrationScope,
  type IntegrationRun,
} from '../shared/contracts/integration-lab.ts';
export class IntegrationReports implements IntegrationReportsV1 {
  private rows;
  constructor(
    meta: PluginMetadata,
    private specs: IntegrationSpecsV1,
    private assertions: IntegrationAssertionsV1,
    private runners: IntegrationRunnersV1,
    private load: IntegrationLoadV1,
  ) {
    this.rows = new IntegrationRows(meta, reportSchema);
  }
  async list(scope: IntegrationScope) {
    await this.specs.assertWorkspace(scope);
    return (await this.rows.all()).filter((r) => r.workspaceId === scope.workspaceId);
  }
  async get(scope: IntegrationScope, id: string) {
    const row = (await this.list(scope)).find((r) => r.id === id);
    if (!row) ilFail('REPORT_NOT_FOUND');
    const { digest, ...core } = row;
    if (ilHash(core) !== digest) ilFail('REPORT_DIGEST_MISMATCH');
    return row;
  }
  async seal(scope: IntegrationScope, runId: string) {
    const run = await this.runners.inspect(scope, runId);
    if (['queued', 'preparing', 'running', 'evaluating', 'cleanup', 'cancelling'].includes(run.state))
      ilFail('RUN_NOT_TERMINAL');
    const old = (await this.list(scope)).find((r) => r.runId === runId);
    if (old) return old;
    const evaluations = await this.assertions.evaluations(scope, runId);
    if (run.evaluation && !evaluations.some((e) => ilHash(e) === ilHash(run.evaluation)))
      ilFail('ASSERTION_EVIDENCE_MISMATCH');
    const uncertain =
      !run.cleanupConfirmed ||
      !!run.error ||
      run.state === 'effect-unknown' ||
      !run.evaluation ||
      run.evaluation.results.some((e) => e.outcome === 'unevaluated') ||
      run.load?.inconclusive;
    const failed = run.evaluation?.results.some((e) => e.outcome === 'violated');
    const base = {
      id: randomUUID(),
      workspaceId: scope.workspaceId,
      runId,
      createdAt: new Date().toISOString(),
      retainUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
      verdict: uncertain ? ('inconclusive' as const) : failed ? ('failed' as const) : ('passed' as const),
      evidenceCoverage: run.plan.retainFields.length
        ? ('selected-fields' as const)
        : ('record-only' as const),
      cannotRecompute: ['RESPONSE_BODY_DISCARDED'],
      origin: 'local' as const,
      run,
    };
    const row = reportSchema.parse({ ...base, digest: ilHash(base) });
    const size = ilBytes(row),
      capacity = await this.specs.reserveCapacity(scope, {
        objects: 1,
        revisions: 1,
        bytes: size * 2,
        metadataBytes: size,
        controlBytes: 0,
      });
    await this.rows.change((rows) => rows.push(row));
    await this.specs.commitCapacity(scope, capacity.token);
    return row;
  }
  async compare(scope: IntegrationScope, before: string, after: string) {
    const a = await this.get(scope, before),
      b = await this.get(scope, after);
    const reasons: string[] = [];
    const fixed = (r: IntegrationRun) => ({
      snapshot: r.plan.snapshotDigest,
      tool: r.plan.toolDigest,
      image: r.plan.image,
      rate: r.plan.rate,
      requests: r.plan.requests,
      seconds: r.plan.durationSeconds,
      mode: r.plan.mode,
      memoryMiB: 1024,
      cpus: 1,
      timing: 'guest-monotonic-v1',
    });
    const left = fixed(a.run),
      right = fixed(b.run);
    for (const k of Object.keys(left) as (keyof typeof left)[])
      if (ilHash(left[k]) !== ilHash(right[k])) reasons.push('DIFFERENT_' + k.toUpperCase());
    if (a.verdict === 'inconclusive' || b.verdict === 'inconclusive') reasons.push('INCOMPLETE_SAMPLES');
    return { comparable: !reasons.length, reasons, before: a, after: b };
  }
  async cleanupPlan(scope: IntegrationScope) {
    const reports = await this.list(scope),
      ids: string[] = [],
      protectedIds: string[] = [];
    for (const report of reports) {
      if (Date.parse(report.retainUntil) > Date.now() || !report.run.cleanupConfirmed)
        protectedIds.push(report.id);
      else ids.push(report.id);
    }
    return { digest: ilHash({ ids, protected: protectedIds }), ids, protected: protectedIds };
  }
  async cleanup(scope: IntegrationScope, digest: string) {
    const plan = await this.cleanupPlan(scope);
    if (plan.digest !== digest) ilFail('CLEANUP_PLAN_CHANGED');
    await this.rows.change((rows) => {
      for (let i = rows.length - 1; i >= 0; i--)
        if (rows[i].workspaceId === scope.workspaceId && plan.ids.includes(rows[i].id)) rows.splice(i, 1);
    });
    return { removed: plan.ids.length };
  }
  async close() {
    await this.rows.close();
  }
}

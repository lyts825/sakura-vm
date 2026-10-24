/** 报告封存与隔离导入；外部身份永远不能转为本机执行权。
 * Sealed evidence and quarantined imports never convert foreign identities into local authority. */
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { ROOT } from './paths.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import type {
  ResilienceReportsV1,
  ResilienceRunsV1,
  ResilienceProbesV1,
  ResilienceFixturesV1,
} from './service-contracts/resilience-lab.ts';
import {
  resilienceReportSchema,
  resilienceBundleSchema,
  resilienceImportSchema,
  type ResilienceScope as Scope,
  type ResilienceBundle as Bundle,
} from '../shared/contracts/resilience-lab.ts';
import {
  ResilienceStore,
  resilienceHash,
  resilienceId,
  resilienceNow,
  resilienceError,
  sameScope,
  type ResilienceAuthorize,
} from './resilience-store.ts';
const schema = z
  .object({
    reports: z.array(resilienceReportSchema).max(1000),
    imports: z.array(resilienceImportSchema).max(1000),
    discardedImports: z
      .array(
        z
          .object({
            id: z.uuid(),
            scope: z.object({ workspaceId: z.string() }).strict(),
            digest: z.string(),
            at: z.iso.datetime(),
          })
          .strict(),
      )
      .max(1000)
      .default([]),
    pinned: z.array(z.uuid()).default([]),
    archiving: z.array(z.uuid()).default([]),
    archived: z
      .array(
        z
          .object({
            id: z.uuid(),
            scope: z.object({ workspaceId: z.string() }).strict(),
            digest: z.string(),
            at: z.iso.datetime(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export async function verifyResilienceOffline(raw: unknown) {
  const bundle = resilienceBundleSchema.parse(raw);
  const module = await import(
    /* @vite-ignore */ pathToFileURL(join(ROOT, 'scripts', 'resilience-verify.mjs')).href
  );
  const result = module.verifyResilienceBundle(bundle);
  return { ...result, report: resilienceReportSchema.parse(result.report) } as {
    integrity: 'valid';
    sourceTrust: 'unauthenticated';
    bytes: number;
    digest: string;
    findings: string[];
    report: z.infer<typeof resilienceReportSchema>;
  };
}
export class ResilienceReports implements ResilienceReportsV1 {
  private store: ResilienceStore<z.infer<typeof schema>>;
  constructor(
    metadata: PluginMetadata<unknown>,
    private runs: ResilienceRunsV1,
    private probes: ResilienceProbesV1,
    private fixtures: ResilienceFixturesV1,
    authorize: ResilienceAuthorize,
  ) {
    this.store = new ResilienceStore(
      metadata,
      schema,
      () => ({ reports: [], imports: [], discardedImports: [], pinned: [], archiving: [], archived: [] }),
      authorize,
    );
  }
  async view(scope: Scope) {
    return (await this.store.read(scope)).reports.filter((x) => sameScope(x.scope, scope));
  }
  async imports(scope: Scope) {
    return (await this.store.read(scope)).imports
      .filter((item) => sameScope(item.scope, scope))
      .map(({ report: _report, ...summary }) => summary);
  }
  async discardImport(scope: Scope, id: string) {
    z.uuid().parse(id);
    return this.store.mutate(scope, (state) => {
      if (state.discardedImports.some((item) => sameScope(item.scope, scope) && item.id === id))
        return { id, discarded: true as const };
      const item = state.imports.find((item) => sameScope(item.scope, scope) && item.id === id);
      if (!item) resilienceError('原隔离导入不存在');
      if (state.discardedImports.length >= 1000)
        resilienceError('导入核销记录已达上限', 'RESILIENCE_BUDGET_EXCEEDED');
      state.discardedImports.push({ id, scope, digest: item.digest, at: resilienceNow() });
      state.imports = state.imports.filter((item) => item.id !== id);
      return { id, discarded: true as const };
    });
  }
  async retention(scope: Scope) {
    const state = await this.store.read(scope);
    return state.reports
      .filter((x) => sameScope(x.scope, scope))
      .map((r) => ({
        id: r.id,
        pinned: state.pinned.includes(r.id),
        expiresAt: new Date(Date.parse(r.createdAt) + 30 * 86400000).toISOString(),
        archiving: state.archiving.includes(r.id),
      }));
  }
  async pin(scope: Scope, id: string, pinned: boolean) {
    z.uuid().parse(id);
    z.boolean().parse(pinned);
    return this.store.mutate(scope, (state) => {
      if (
        !state.reports.some((r) => r.id === id && sameScope(r.scope, scope)) ||
        state.archiving.includes(id)
      )
        resilienceError('报告不存在或正在归档');
      state.pinned = state.pinned.filter((x) => x !== id);
      if (pinned) state.pinned.push(id);
      return { id, pinned };
    });
  }
  async archive(scope: Scope, id: string) {
    z.uuid().parse(id);
    const report = await this.store.mutate(scope, (state) => {
      if (state.archived.some((x) => x.id === id && sameScope(x.scope, scope))) return null;
      const report =
        state.reports.find((x) => x.id === id && sameScope(x.scope, scope)) || resilienceError('报告不存在');
      if (state.pinned.includes(id)) resilienceError('请先解除固定');
      if (!report.external && (report.run.cleanup !== 'confirmed' || report.run.containment !== 'confirmed'))
        resilienceError('原运行责任未核销，禁止归档');
      if (!state.archiving.includes(id)) state.archiving.push(id);
      return report;
    });
    if (report) {
      // 先阻止新导出，再让 fixtures 核对原读租约；响应丢失可重试同一归档。
      // Fence new exports before the original fixtures service checks read leases; retry the same archive safely.
      if (!report.external)
        await this.fixtures.releaseInput(scope, report.run.plan.scenario.target, 'report:' + id);
      await this.store.mutate(scope, (state) => {
        state.reports = state.reports.filter((x) => x.id !== id);
        state.archiving = state.archiving.filter((x) => x !== id);
        if (!state.archived.some((x) => x.id === id))
          state.archived.push({ id, scope, digest: report.digest, at: resilienceNow() });
      });
    }
    return { id, archived: true as const };
  }
  async seal(scope: Scope, runId: string) {
    const run = await this.runs.get(scope, runId),
      segments = await this.probes.view(scope, runId),
      id = resilienceId();
    const complete =
        run.state === 'completed' && run.containment === 'confirmed' && run.cleanup === 'confirmed',
      passed =
        complete &&
        run.outcome === 'passed' &&
        segments.some((s) => s.phase === 'baseline' && s.passed) &&
        segments.some((s) => s.phase === 'recovery' && s.passed) &&
        run.evidence.some((e) => e.effect === 'observed') &&
        run.intents.every((i) => i.status === 'confirmed');
    const base = {
      id,
      scope,
      run,
      segments,
      createdAt: resilienceNow(),
      classification: passed ? ('passed' as const) : complete ? ('failed' as const) : ('incomplete' as const),
      sourceTrust: 'local' as const,
      digest: '',
      pinned: false,
      external: false,
    };
    const report = resilienceReportSchema.parse({ ...base, digest: resilienceHash(base) });
    await this.fixtures.retainInput(scope, run.plan.scenario.target, 'report:' + id);
    return this.store.mutate(scope, (s) => {
      if (
        s.reports.length >= 30 ||
        Buffer.byteLength(JSON.stringify(s)) + Buffer.byteLength(JSON.stringify(report)) > 5 * 1024 ** 3
      )
        resilienceError('报告保留额度不足；先导出并归档旧报告', 'RESILIENCE_BUDGET_EXCEEDED');
      s.reports.push(report);
      return report;
    });
  }
  async export(scope: Scope, id: string) {
    if ((await this.store.read(scope)).archiving.includes(id)) resilienceError('报告正在归档');
    const report = (await this.view(scope)).find((x) => x.id === id) || resilienceError('报告不存在');
    let read: string | undefined;
    try {
      if (!report.external)
        read = (await this.fixtures.openInputRead(scope, report.run.plan.scenario.target)).id;
      if ((await this.store.read(scope)).archiving.includes(id)) resilienceError('报告已进入归档，停止导出');
      const entry = (path: string, purpose: 'report' | 'scenario' | 'samples', value: unknown) => {
        const data = JSON.stringify(value);
        return {
          path,
          purpose,
          bytes: Buffer.byteLength(data),
          digest: resilienceHash(data),
          contentType: 'application/json' as const,
          data: Buffer.from(data).toString('base64'),
        };
      };
      const bundle = resilienceBundleSchema.parse({
        format: 'sakura-resilience-1',
        sourceTrust: 'unauthenticated',
        entries: [
          entry('report.json', 'report', report),
          entry('scenario.json', 'scenario', report.run.plan.scenario),
          entry('samples.json', 'samples', report.segments),
        ],
      });
      await verifyResilienceOffline(bundle);
      return bundle;
    } finally {
      if (read) await this.fixtures.closeInputRead(scope, read);
    }
  }
  async import(scope: Scope, raw: Bundle) {
    await this.store.authorize(scope);
    const checked = await verifyResilienceOffline(raw);
    const value = resilienceImportSchema.parse({
      id: resilienceId(),
      scope,
      digest: checked.digest,
      createdAt: resilienceNow(),
      integrity: checked.integrity,
      sourceTrust: 'unauthenticated',
      state: 'quarantined',
      findings: checked.findings,
      report: checked.report,
      acceptedId: null,
    });
    return this.store.mutate(scope, (s) => {
      if (
        s.imports.length >= 30 ||
        Buffer.byteLength(JSON.stringify(s)) + Buffer.byteLength(JSON.stringify(value)) > 5 * 1024 ** 3
      )
        resilienceError('隔离报告容量不足', 'RESILIENCE_BUDGET_EXCEEDED');
      s.imports.push(value);
      return value;
    });
  }
  async accept(scope: Scope, id: string) {
    return this.store.mutate(scope, (s) => {
      const item =
        s.imports.find((x) => sameScope(x.scope, scope) && x.id === id) || resilienceError('隔离导入不存在');
      if (item.acceptedId) return item;
      const base = {
        ...item.report,
        id: resilienceId(),
        scope,
        sourceTrust: 'unauthenticated' as const,
        external: true,
        pinned: false,
        digest: '',
      };
      const report = resilienceReportSchema.parse({ ...base, digest: resilienceHash(base) });
      if (
        s.reports.length >= 30 ||
        Buffer.byteLength(JSON.stringify(s)) + Buffer.byteLength(JSON.stringify(report)) > 5 * 1024 ** 3
      )
        resilienceError('报告保留额度不足', 'RESILIENCE_BUDGET_EXCEEDED');
      s.reports.push(report);
      item.acceptedId = report.id;
      item.state = 'accepted';
      return item;
    });
  }
  async compare(scope: Scope, leftId: string, rightId: string) {
    const reports = await this.view(scope),
      left = reports.find((x) => x.id === leftId) || resilienceError('左报告不存在'),
      right = reports.find((x) => x.id === rightId) || resilienceError('右报告不存在');
    const differences: string[] = [];
    for (const key of ['image', 'sampleDigest', 'memoryMiB', 'cpus'] as const)
      if (JSON.stringify(left.run.plan.target[key]) !== JSON.stringify(right.run.plan.target[key]))
        differences.push(key);
    if (left.run.plan.scenario.revision !== right.run.plan.scenario.revision)
      differences.push('scenarioRevision');
    if (left.external || right.external) differences.push('sourceUnauthenticated');
    return { compatible: differences.length === 0, differences, left, right };
  }
}

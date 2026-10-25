/** 浏览器材料和固定判定由各自领域保存；导入声明不成为本机执行证明。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as B from '../shared/contracts/browser-lab.ts';
import { imageAssetSchema } from '../shared/contracts/image-assets.ts';
import type { ImageAssetsV1 } from './service-contracts/image-assets.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import {
  SuiteStore,
  suiteActor,
  suiteHash,
  suiteSha,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { readSuiteText } from './suite-compute.ts';
import { resourceContext } from './host-runtime/context.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { computeRuntime } from './compute-runtime.ts';

export const browserRef = (row: S.SuiteRecord): S.SuiteRef => ({
  domain: row.domain,
  id: row.id,
  revision: row.revision,
});
export const browserScope = (input: S.SuiteScope) => ({ workspaceId: input.workspaceId });
export const browserPin = (scope: S.SuiteScope, ref: S.SuiteRef) => ({
  ...browserScope(scope),
  id: ref.id,
  revision: ref.revision,
});
const json = (value: unknown) => S.suiteJson.parse(value);
export type BrowserPeers = Readonly<Record<string, S.SuiteRecordsV1>>;
export function requireBrowserLocal(row: S.SuiteRecord, domain: string) {
  if (row.domain !== domain || row.state !== 'sealed' || row.origin !== 'local')
    suiteFail('BROWSER_LOCAL_FIXED_REQUIRED', '此操作需要本机封存的固定对象，外来结果只作参考');
  return row;
}
export class BrowserTargets extends SuiteMaterials {
  constructor(
    meta: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    private imagesPort: ImageAssetsV1,
  ) {
    super('browser-targets', meta, uploads, auth, 32 * 1024 ** 3, 8 * 1024 ** 2, ['json', 'png']);
  }
  async images() {
    await this.access();
    const rows = await this.imagesPort.list();
    if (rows.length > 1000) suiteFail('BROWSER_IMAGE_LIST_LIMIT', '镜像列表超过 1000 项，请先整理镜像资产');
    return rows.map((value) => imageAssetSchema.parse(value));
  }
  async upload(raw: unknown) {
    const input = S.suiteScope
      .extend({ name: S.suiteName, site: B.browserSite, allowExport: z.boolean().default(false) })
      .strict()
      .parse(raw);
    return this.textSource(
      browserScope(input),
      input.name,
      JSON.stringify(input.site),
      'json',
      input.allowExport,
    );
  }
  async pin(raw: z.infer<typeof B.browserTargetInput>) {
    const input = B.browserTargetInput.parse(raw),
      scope = browserScope(input);
    if (input.source.domain !== this.domain) suiteFail('BROWSER_SOURCE_DOMAIN');
    const source = await this.get(browserPin(scope, input.source)),
      material = S.suiteMaterial.parse(source.content);
    const site = B.browserSite.parse(
      parseSuiteJson((await readSuiteText(this, scope, input.source, 8 * 1024 ** 2)).text),
    );
    await this.imagesPort.verify(input.image);
    const bytes = site.files.reduce(
      (size, file) => size + Buffer.byteLength(file.data, file.encoding === 'base64' ? 'base64' : 'utf8'),
      0,
    );
    if (bytes > 8 * 1024 ** 2) suiteFail('BROWSER_SITE_BUDGET');
    return this.put(
      {
        ...scope,
        name: input.name,
        references: [input.source],
        content: json({
          format: 'sakura-browser-target/1',
          source: input.source,
          sourceDigest: material.digest,
          image: input.image,
          entry: site.entry,
          files: site.files.length,
          bytes,
          isolatedSite: true,
          externalNetwork: false,
        }),
      },
      'result',
      true,
    );
  }
  async resolve(raw: S.SuitePin) {
    return requireBrowserLocal(await this.get(S.suitePin.parse(raw)), this.domain);
  }
  async publishArtifact(raw: unknown) {
    const input = S.suiteScope
      .extend({
        source: S.suiteRef,
        name: S.suiteName,
        data: z.string().max(6 * 1024 ** 2),
        digest: S.suiteDigest,
        allowExport: z.boolean(),
      })
      .strict()
      .parse(raw);
    const consumer = resourceContext()?.serviceConsumerPluginInstanceId;
    if (!consumer || !/^official:browser-runners(?::|$)/.test(consumer))
      suiteFail('BROWSER_ARTIFACT_CONSUMER', '只有原浏览器运行器可以发布实际截图', 403);
    const parent = await this.get(browserPin(input, input.source));
    if (parent.kind !== 'source') suiteFail('BROWSER_SOURCE_REQUIRED');
    const bytes = Buffer.from(input.data, 'base64');
    if (
      bytes.length > 4 * 1024 ** 2 ||
      suiteSha(bytes) !== input.digest ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      suiteFail('BROWSER_ARTIFACT_DIGEST');
    const existing = (await this.readState()).rows.find(
      (row) =>
        row.workspaceId === input.workspaceId &&
        row.actor === suiteActor() &&
        row.origin === 'local' &&
        row.kind === 'source' &&
        row.state === 'sealed' &&
        row.references.some((r) => suiteHash(r) === suiteHash(input.source)) &&
        S.suiteMaterial.safeParse(row.content).success &&
        S.suiteMaterial.parse(row.content).digest === input.digest,
    );
    if (existing) {
      const policy = await this.policy(browserPin(input, browserRef(existing)));
      if (policy.allowRead && policy.allowExport === input.allowExport)
        return this.get(browserPin(input, browserRef(existing)));
    }
    const upload = await this.beginDerivedUpload(
      {
        ...browserScope(input),
        name: input.name,
        format: 'png',
        bytes: bytes.length,
        digest: input.digest,
        allowExport: input.allowExport,
      },
      [input.source],
    );
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...browserScope(input),
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...browserScope(input), id: upload.id });
  }
  private async textSource(
    scope: S.SuiteScope,
    name: string,
    text: string,
    format: 'json',
    allowExport: boolean,
  ) {
    const bytes = Buffer.from(text),
      upload = await this.beginUpload({
        ...scope,
        name,
        format,
        bytes: bytes.length,
        digest: suiteSha(bytes),
        allowExport,
      });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...scope,
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...scope, id: upload.id });
  }
}
export class BrowserDomain extends SuiteStore {
  constructor(
    domain: string,
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    root: S.SuiteWorkspacePortV1,
    peers: BrowserPeers,
  ) {
    super(domain, meta, auth, root, peers);
  }
  protected override access(scope?: S.SuiteScope) {
    return super.access(scope ? browserScope(scope) : undefined);
  }
  override fixed(scope: S.SuiteScope, ref: S.SuiteRef, allowImported = false) {
    return super.fixed(browserScope(scope), ref, allowImported);
  }
  protected async native<T>(scope: S.SuiteScope, ref: S.SuiteRef, domain: string, schema: z.ZodType<T>) {
    const row = requireBrowserLocal(await this.fixed(scope, ref), domain);
    return { row, value: schema.parse(row.content) };
  }
  protected result(
    scope: S.SuiteScope,
    name: string,
    content: unknown,
    references: S.SuiteRef[],
    kind: 'result' | 'review' = 'result',
  ) {
    return this.put({ ...browserScope(scope), name, content: json(content), references }, kind, true);
  }
}
export class BrowserFixtures extends BrowserDomain {
  async generate(raw: z.infer<typeof B.browserFixtureInput>) {
    const input = B.browserFixtureInput.parse(raw);
    await this.native(input, input.target, 'browser-targets', B.browserTarget);
    return this.result(
      input,
      input.name,
      { format: 'sakura-browser-fixture/1', target: input.target, data: input.data, synthetic: true },
      [input.target],
    );
  }
  async validate(raw: S.SuitePin) {
    const row = await this.get(S.suitePin.parse(raw));
    B.browserFixture.parse(requireBrowserLocal(row, this.domain).content);
    return row;
  }
}
export class BrowserJourneys extends BrowserDomain {
  async compile(raw: z.infer<typeof B.browserCompile>) {
    const input = B.browserCompile.parse(raw),
      fixture = await this.native(input, input.fixture, 'browser-fixtures', B.browserFixture);
    await this.native(input, input.target, 'browser-targets', B.browserTarget);
    if (suiteHash(fixture.value.target) !== suiteHash(input.target)) suiteFail('BROWSER_FIXTURE_TARGET');
    return this.result(
      input,
      input.name,
      {
        format: 'sakura-browser-journey/1',
        target: input.target,
        fixture: input.fixture,
        definition: input.definition,
      },
      [input.target, input.fixture],
    );
  }
  async previewSteps(raw: S.SuitePin) {
    const input = S.suitePin.parse(raw),
      row = await this.get(input);
    requireBrowserLocal(row, this.domain);
    B.browserJourney.parse(row.content);
    return row;
  }
}
export class BrowserAssertions extends BrowserDomain {
  async evaluate(raw: z.infer<typeof B.browserRunSelect>) {
    const input = B.browserRunSelect.parse(raw),
      run = await this.native(input, input.run, 'browser-runners', B.browserRun),
      journey = await this.native(input, run.value.journey, 'browser-journeys', B.browserJourney);
    const checks = journey.value.definition.assertions.map((rule, index) => {
      const observed = run.value.observations.find((step) => step.sequence === rule.step),
        actual = observed?.assertions.find((item) => item.index === index);
      return {
        index,
        rule,
        observed: !!actual,
        passed: actual?.passed ?? null,
        actual: actual?.actual ?? null,
      };
    });
    const outcome = checks.some((item) => item.passed === false)
      ? 'failed'
      : !checks.length || checks.some((item) => !item.observed) || run.value.executionState !== 'completed'
        ? 'inconclusive'
        : 'passed';
    return this.result(
      input,
      '固定浏览器断言',
      {
        format: 'sakura-browser-assertions/1',
        run: input.run,
        journey: run.value.journey,
        checks,
        outcome,
        coverage: { selected: checks.length, observed: checks.filter((item) => item.observed).length },
      },
      [input.run, run.value.journey],
    );
  }
  async explain(raw: S.SuitePin) {
    return requireBrowserLocal(await this.get(raw), this.domain);
  }
}
const evaluation = z
  .object({
    format: z.literal('sakura-browser-accessibility/1'),
    run: S.suiteRef,
    selected: B.browserAccessibilityRules,
    findings: z.array(B.browserFinding).max(1000),
    truncated: z.boolean(),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    automatedCoverage: z.literal('selected-dom-rules'),
    manualReview: z
      .object({
        actor: S.suiteId,
        note: z.string().max(4000),
        accepted: z.boolean(),
        checks: z.array(z.string()).max(30),
      })
      .strict()
      .nullable(),
  })
  .strict();
export class BrowserAccessibility extends BrowserDomain {
  async evaluate(raw: z.infer<typeof B.browserRunSelect>) {
    const input = B.browserRunSelect.parse(raw),
      run = await this.native(input, input.run, 'browser-runners', B.browserRun),
      journey = await this.native(input, run.value.journey, 'browser-journeys', B.browserJourney);
    return this.result(
      input,
      '可访问性有限规则检查',
      {
        format: 'sakura-browser-accessibility/1',
        run: input.run,
        selected: journey.value.definition.accessibility,
        findings: run.value.accessibility,
        truncated: run.value.accessibilityTruncated,
        outcome: run.value.accessibility.length
          ? 'failed'
          : run.value.executionState !== 'completed' ||
              run.value.accessibilityTruncated ||
              !journey.value.definition.accessibility.length
            ? 'inconclusive'
            : 'passed',
        automatedCoverage: 'selected-dom-rules',
        manualReview: null,
      },
      [input.run],
    );
  }
  async review(raw: z.infer<typeof B.browserReviewInput>) {
    const input = B.browserReviewInput.parse(raw),
      record = await this.native(input, input.evaluation, this.domain, evaluation);
    return this.put(
      {
        ...browserScope(input),
        id: record.row.id,
        expectedRevision: record.row.revision,
        name: record.row.name,
        references: record.row.references,
        content: json({
          ...record.value,
          manualReview: {
            actor: suiteActor(),
            note: input.note,
            accepted: input.accepted,
            checks: input.manualChecks,
          },
        }),
      },
      'result',
      true,
    );
  }
}
type Pixels = { comparable: boolean; pixels: number; changed: number; ratio: number | null };
export class BrowserVisual extends BrowserDomain {
  private operations = new Map<string, Promise<unknown>>();
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private targets: S.SuiteMaterialsV1,
    peers: BrowserPeers,
  ) {
    super('browser-visual', meta, auth, targets, peers);
  }
  private exclusive<T>(scope: S.SuiteScope, work: () => Promise<T>) {
    const pending = (this.operations.get(scope.workspaceId) ?? Promise.resolve()).catch(() => {}).then(work);
    this.operations.set(scope.workspaceId, pending);
    void pending
      .finally(() => {
        if (this.operations.get(scope.workspaceId) === pending) this.operations.delete(scope.workspaceId);
      })
      .catch(() => {});
    return pending;
  }
  private async current(scope: S.SuiteScope, journey: S.SuiteRef) {
    await this.access(scope);
    const rows = (await this.readState()).rows
      .filter(
        (row) =>
          row.workspaceId === scope.workspaceId && row.actor === suiteActor() && row.origin === 'local',
      )
      .filter((row) => {
        const value = B.browserBaseline.safeParse(row.content);
        return (
          value.success &&
          value.data.status === 'active' &&
          suiteHash(value.data.journey) === suiteHash(journey)
        );
      });
    return rows.at(-1) ?? null;
  }
  async proposeBaseline(raw: z.infer<typeof B.browserBaselineInput>) {
    const input = B.browserBaselineInput.parse(raw),
      run = await this.native(input, input.run, 'browser-runners', B.browserRun);
    if (run.value.executionState !== 'completed' || !run.value.environment || !run.value.screenshots.length)
      suiteFail('BROWSER_BASELINE_INCOMPLETE');
    return this.result(
      input,
      '待人工审阅的视觉基线',
      {
        format: 'sakura-browser-baseline/1',
        run: input.run,
        journey: run.value.journey,
        environment: run.value.environment,
        shots: run.value.screenshots,
        status: 'proposed',
        note: input.note,
        reviewer: null,
        previous: null,
      },
      [input.run],
      'review',
    );
  }
  async acceptBaseline(raw: z.infer<typeof B.browserBaselineDecision>) {
    const input = B.browserBaselineDecision.parse(raw);
    return this.exclusive(input, async () => {
      const candidate = await this.native(input, input.baseline, this.domain, B.browserBaseline);
      if (candidate.value.status !== 'proposed') suiteFail('BROWSER_BASELINE_ALREADY_DECIDED');
      const current = await this.current(input, candidate.value.journey);
      if (suiteHash(current ? browserRef(current) : null) !== suiteHash(input.expectedActive))
        suiteFail('BROWSER_BASELINE_CONFLICT', '当前基线已经变化，请重新核对');
      return this.put(
        {
          ...browserScope(input),
          id: candidate.row.id,
          expectedRevision: candidate.row.revision,
          name: candidate.row.name,
          references: [...candidate.row.references, ...(current ? [browserRef(current)] : [])],
          content: json({
            ...candidate.value,
            status: 'active',
            note: input.note,
            reviewer: suiteActor(),
            previous: current ? browserRef(current) : null,
          }),
        },
        'review',
        true,
      );
    });
  }
  async active(raw: S.SuiteScope & { journey: S.SuiteRef }) {
    const input = S.suiteScope.extend({ journey: S.suiteRef }).strict().parse(raw);
    await this.native(input, input.journey, 'browser-journeys', B.browserJourney);
    const row = await this.current(input, input.journey);
    return row ? this.get(browserPin(input, browserRef(row))) : null;
  }
  override async archive(raw: S.SuitePin) {
    const row = await this.get(raw),
      value = B.browserBaseline.safeParse(row.content);
    if (value.success && value.data.status === 'active' && row.origin === 'local')
      suiteFail('BROWSER_BASELINE_HISTORY_PROTECTED');
    return super.archive(raw);
  }
  protected override async releaseOwned(_scope: S.SuiteScope, row: S.SuiteRecord) {
    const value = B.browserBaseline.safeParse(row.content);
    if (value.success && value.data.status === 'active' && row.origin === 'local')
      suiteFail('BROWSER_BASELINE_HISTORY_PROTECTED');
  }
  private async bytes(scope: S.SuiteScope, ref: S.SuiteRef) {
    const row = await this.targets.get(browserPin(scope, ref)),
      metadata = S.suiteMaterial.parse(row.content);
    if (metadata.bytes > 4 * 1024 ** 2) suiteFail('BROWSER_SCREENSHOT_BUDGET');
    const lease = await this.targets.openRead(browserPin(scope, ref)),
      parts: Buffer[] = [];
    try {
      for (let offset = 0; offset < metadata.bytes;) {
        const chunk = await this.targets.readLease({
            ...browserScope(scope),
            id: lease.id,
            offset,
            length: Math.min(512 * 1024, metadata.bytes - offset),
          }),
          part = Buffer.from(chunk.data, 'base64');
        if (!part.length || chunk.offset !== offset + part.length) suiteFail('BROWSER_SCREENSHOT_READ');
        parts.push(part);
        offset = chunk.offset;
      }
    } finally {
      await this.targets.closeRead({ ...browserScope(scope), id: lease.id });
    }
    const data = Buffer.concat(parts);
    if (suiteSha(data) !== metadata.digest) suiteFail('BROWSER_SCREENSHOT_DIGEST');
    return data;
  }
  async compare(raw: z.infer<typeof B.browserRunSelect>) {
    const input = B.browserRunSelect.parse(raw),
      run = await this.native(input, input.run, 'browser-runners', B.browserRun),
      journey = await this.native(input, run.value.journey, 'browser-journeys', B.browserJourney);
    const rule = journey.value.definition.visual,
      baseline = run.value.baseline
        ? await this.native(input, run.value.baseline, this.domain, B.browserBaseline)
        : null;
    const comparable =
      !!baseline &&
      baseline.value.status === 'active' &&
      !!baseline.value.environment &&
      suiteHash(baseline.value.environment) === suiteHash(run.value.environment) &&
      suiteHash(baseline.value.journey) === suiteHash(run.value.journey);
    const differences: {
      step: number;
      comparable: boolean;
      pixels: number;
      changed: number;
      ratio: number | null;
    }[] = [];
    if (rule.enabled && comparable) {
      for (const shot of run.value.screenshots) {
        const prior = baseline!.value.shots.find((value) => value.step === shot.step);
        if (!prior) {
          differences.push({ step: shot.step, comparable: false, pixels: 0, changed: 0, ratio: null });
          continue;
        }
        const result = await computeRuntime.run<Pixels>(
          {
            owner: this.domain,
            label: 'browser-pixel-comparison',
            memoryBytes: 64 * 1024 ** 2,
            timeoutMs: 30000,
            partition: { key: 'browser-pixels', limit: 1 },
          },
          async () => ({
            source: new URL('./browser-pixels-worker.mjs', import.meta.url),
            options: {
              workerData: {
                left: await this.bytes(input, prior.source),
                right: await this.bytes(input, shot.source),
                masks: rule.masks,
              },
              resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 4 },
            },
          }),
        );
        differences.push({ step: shot.step, ...result });
      }
    }
    await this.fixed(input, input.run);
    const complete =
      comparable &&
      run.value.executionState === 'completed' &&
      differences.length === baseline!.value.shots.length &&
      differences.length > 0 &&
      differences.every((item) => item.comparable);
    const outcome = !rule.enabled
      ? 'not-selected'
      : !complete
        ? 'inconclusive'
        : differences.some((item) => (item.ratio ?? 0) > rule.tolerance)
          ? 'failed'
          : 'passed';
    return this.result(
      input,
      '预先规则的视觉比较',
      {
        format: 'sakura-browser-visual/1',
        run: input.run,
        baseline: run.value.baseline,
        rule,
        comparable,
        environmentChanged: !!baseline && !comparable,
        differences,
        outcome,
      },
      [input.run, ...(run.value.baseline ? [run.value.baseline] : [])],
    );
  }
}
const recordObject = (row: S.SuiteRecord) => {
  if (!row.content || typeof row.content !== 'object' || Array.isArray(row.content))
    suiteFail('BROWSER_EVALUATION_FORMAT');
  return row.content;
};
export class BrowserReports extends BrowserDomain {
  override async seal(raw: S.SuitePin | z.infer<typeof B.browserReportInput>) {
    const input = B.browserReportInput.parse(raw),
      run = await this.native(input, input.run, 'browser-runners', B.browserRun),
      journey = await this.native(input, run.value.journey, 'browser-journeys', B.browserJourney);
    const references = [input.run, input.assertions, input.visual, input.accessibility, run.value.journey],
      evaluations = [];
    for (const [ref, domain, format] of [
      [input.assertions, 'browser-assertions', 'sakura-browser-assertions/1'],
      [input.visual, 'browser-visual', 'sakura-browser-visual/1'],
      [input.accessibility, 'browser-accessibility', 'sakura-browser-accessibility/1'],
    ] as const) {
      const row = requireBrowserLocal(await this.fixed(input, ref), domain),
        content = recordObject(row);
      if (content.format !== format || suiteHash(content.run) !== suiteHash(input.run))
        suiteFail('BROWSER_REPORT_WINDOW');
      evaluations.push(content);
    }
    const selected = [
      { kind: 'assertions', selected: journey.value.definition.assertions.length > 0, value: evaluations[0] },
      { kind: 'visual', selected: journey.value.definition.visual.enabled, value: evaluations[1] },
      {
        kind: 'accessibility',
        selected: journey.value.definition.accessibility.length > 0,
        value: evaluations[2],
      },
    ];
    const covered = selected.filter((value) => value.selected),
      missing = selected.filter((value) => !value.selected).map((value) => value.kind);
    const outcome =
      covered.some((item) => item.value.outcome === 'failed') || run.value.outcome === 'failed'
        ? 'failed'
        : !covered.length ||
            run.value.executionState !== 'completed' ||
            covered.some((item) => item.value.outcome !== 'passed')
          ? 'inconclusive'
          : 'passed';
    return this.result(
      input,
      input.title,
      {
        format: 'sakura-browser-report/1',
        run: input.run,
        assertions: input.assertions,
        visual: input.visual,
        accessibility: input.accessibility,
        selected: covered.map((item) => item.kind),
        notCovered: missing,
        outcome,
        cleanup: run.value.cleanup,
        note: input.note,
        limitations: [
          '仅覆盖固定站点和预先选定检查',
          '动画与时间依赖仍可能变化',
          '有限可访问性规则不构成完整规范认证',
        ],
        sealed: true,
      },
      references,
    );
  }
  async compare(raw: z.infer<typeof B.browserCompare>) {
    const input = B.browserCompare.parse(raw),
      left = requireBrowserLocal(await this.fixed(input, input.left), this.domain),
      right = requireBrowserLocal(await this.fixed(input, input.right), this.domain);
    const a = recordObject(left),
      b = recordObject(right);
    if (a.format !== 'sakura-browser-report/1' || b.format !== a.format) suiteFail('BROWSER_REPORT_FORMAT');
    return this.result(
      input,
      '复核报告差异',
      {
        format: 'sakura-browser-report-comparison/1',
        left: input.left,
        right: input.right,
        selectedComparable: suiteHash(a.selected) === suiteHash(b.selected),
        outcomes: [a.outcome, b.outcome],
        conclusion: 'fixed-source-claims',
      },
      [input.left, input.right],
    );
  }
}

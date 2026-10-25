/** 浏览器运行只消费本体固定会话；意图先保存，查询和重启均不重放。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as B from '../shared/contracts/browser-lab.ts';
import * as E from '../shared/contracts/suite-execution.ts';
import type { BrowserSessionsV1 } from './service-contracts/suite-execution.ts';
import type { BrowserTargetsV1 } from './service-contracts/browser-lab.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import {
  BrowserDomain,
  browserRef as ref,
  browserPin as pin,
  browserScope as scope,
  requireBrowserLocal,
  type BrowserPeers,
} from './suite-browser.ts';
import { suiteActor, suiteHash, suiteSha, suiteFail, type SuiteAuthorize } from './suite-store.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { readSuiteText } from './suite-compute.ts';
const savedPlan = z
  .object({
    journey: S.suiteRef,
    target: S.suiteRef,
    fixture: S.suiteRef,
    baseline: S.suiteRef.nullable(),
    exportArtifacts: z.boolean(),
    provider: E.suiteExecutionPlan,
  })
  .strict();
export class BrowserRunners extends BrowserDomain {
  private operations = new Map<string, Promise<unknown>>();
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private targets: BrowserTargetsV1,
    peers: BrowserPeers,
    private sessions: BrowserSessionsV1,
  ) {
    super('browser-runners', meta, auth, targets, peers);
  }
  private exclusive<T>(id: string, work: () => Promise<T>) {
    const next = (this.operations.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.operations.set(id, next);
    void next
      .finally(() => {
        if (this.operations.get(id) === next) this.operations.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async tool() {
    await this.access();
    return this.sessions.tool();
  }
  async preview(raw: z.input<typeof B.browserRunInput>) {
    const input = B.browserRunInput.parse(raw),
      journey = await this.native(input, input.journey, 'browser-journeys', B.browserJourney),
      target = await this.native(input, journey.value.target, 'browser-targets', B.browserTarget),
      fixture = await this.native(input, journey.value.fixture, 'browser-fixtures', B.browserFixture);
    if (suiteHash(fixture.value.target) !== suiteHash(journey.value.target))
      suiteFail('BROWSER_FIXTURE_TARGET');
    if (input.baseline) {
      const baseline = await this.native(input, input.baseline, 'browser-visual', B.browserBaseline);
      if (
        baseline.value.status !== 'active' ||
        suiteHash(baseline.value.journey) !== suiteHash(input.journey)
      )
        suiteFail('BROWSER_BASELINE_JOURNEY');
    }
    const source = await this.targets.get(pin(input, target.value.source)),
      material = S.suiteMaterial.parse(source.content);
    if (material.digest !== target.value.sourceDigest) suiteFail('BROWSER_TARGET_DIGEST');
    const site = B.browserSite.parse(
      parseSuiteJson(
        (await readSuiteText(this.targets, scope(input), target.value.source, 8 * 1024 ** 2)).text,
      ),
    );
    const manifest = B.browserWorkerManifest.parse({
      protocol: 'sakura-browser-tool/1',
      site,
      fixture: fixture.value.data,
      journey: journey.value.definition,
    });
    const provider = await this.sessions.preview({
      ...scope(input),
      image: target.value.image,
      input: S.suiteJson.parse(manifest),
      inputDigest: suiteHash(manifest),
      maxSeconds: Math.min(
        900,
        60 +
          journey.value.definition.steps.reduce(
            (seconds, step) => seconds + (step.action === 'wait' ? Math.ceil(step.timeoutMs / 1000) : 10),
            0,
          ),
      ),
    });
    return this.plan(
      scope(input),
      'browser-run',
      S.suiteJson.parse({
        journey: input.journey,
        target: journey.value.target,
        fixture: journey.value.fixture,
        baseline: input.baseline,
        exportArtifacts: input.exportArtifacts,
        provider,
      }),
      [
        input.journey,
        journey.value.target,
        journey.value.fixture,
        ...(input.baseline ? [input.baseline] : []),
      ],
    );
  }
  async start(raw: S.SuiteApproval) {
    const input = S.suiteApproval.parse(raw);
    return this.exclusive(input.planId, async () => {
      const plan = await this.consume(input, 'browser-run', true),
        selected = savedPlan.parse(plan.input);
      if (plan.result) return this.inspect({ ...scope(input), run: plan.result });
      const authorize = async () => {
        await this.access(scope(input));
        for (const guard of plan.permissions) {
          const record = await this.fixed(input, guard.ref);
          if (
            record.policyRevision !== guard.policyRevision ||
            (record.authorizationDigest ?? suiteHash(record.policyRevision)) !== guard.policyDigest
          )
            suiteFail('BROWSER_SOURCE_PERMISSION_CHANGED');
        }
      };
      let original: S.SuiteRecord | undefined;
      const receipt = await this.sessions.start(
        { ...scope(input), planId: selected.provider.id, digest: selected.provider.digest },
        async (challenge) => {
          await authorize();
          if (
            challenge.planId !== selected.provider.id ||
            challenge.digest !== selected.provider.digest ||
            challenge.inputDigest !== selected.provider.inputDigest
          )
            suiteFail('BROWSER_EXECUTION_CHALLENGE');
          original = await this.result(
            input,
            '浏览器运行',
            {
              format: 'sakura-browser-run/1',
              journey: selected.journey,
              target: selected.target,
              fixture: selected.fixture,
              baseline: selected.baseline,
              sessionId: challenge.sessionId,
              sessionDigest: selected.provider.digest,
              executionState: 'prepared',
              cleanup: 'pending',
              outcome: 'inconclusive',
              environment: null,
              observations: [],
              screenshots: [],
              accessibility: [],
              accessibilityTruncated: false,
              blockedRequests: [],
              error: null,
              systemExecution: true,
            },
            plan.references,
          );
          await this.complete(plan, original);
          return { intentDigest: suiteHash({ record: ref(original), challenge }) };
        },
        authorize,
      );
      if (!original) {
        const completed = await this.inspectPlan({ ...scope(input), planId: plan.id });
        if (!completed.result) suiteFail('BROWSER_INTENT_NOT_CONFIRMED');
        original = await this.get(pin(input, completed.result));
      }
      return this.synchronize(input, original, receipt, selected.exportArtifacts);
    });
  }
  async discardPreview(raw: S.SuiteApproval) {
    const input = S.suiteApproval.parse(raw),
      plan = await this.consume(input, 'browser-run', true),
      selected = savedPlan.parse(plan.input);
    if (plan.result) suiteFail('BROWSER_PREVIEW_ALREADY_STARTED');
    await this.sessions.discardPreview({
      ...scope(input),
      planId: selected.provider.id,
      digest: selected.provider.digest,
    });
    return this.inspectPlan({ ...scope(input), planId: plan.id });
  }
  private async output(input: S.SuiteScope, receipt: E.SuiteExecutionReceipt) {
    if (!receipt.output) suiteFail('BROWSER_OUTPUT_MISSING');
    const parts: Buffer[] = [];
    for (let offset = 0; offset < receipt.output.bytes;) {
      const chunk = await this.sessions.output({
          ...scope(input),
          id: receipt.id,
          offset,
          length: Math.min(512 * 1024, receipt.output.bytes - offset),
        }),
        data = Buffer.from(chunk.data, 'base64');
      if (
        !data.length ||
        chunk.offset !== offset + data.length ||
        chunk.total !== receipt.output.bytes ||
        chunk.digest !== receipt.output.digest
      )
        suiteFail('BROWSER_OUTPUT_CHANGED');
      parts.push(data);
      offset = chunk.offset;
    }
    const data = Buffer.concat(parts);
    if (data.length !== receipt.output.bytes || suiteSha(data) !== receipt.output.digest)
      suiteFail('BROWSER_OUTPUT_DIGEST');
    return B.browserToolResult.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
  }
  private async synchronize(
    input: S.SuiteScope,
    row: S.SuiteRecord,
    receipt: E.SuiteExecutionReceipt,
    exportArtifacts: boolean,
  ) {
    const current = B.browserRun.parse(requireBrowserLocal(row, this.domain).content);
    if (
      receipt.id !== current.sessionId ||
      receipt.profile !== 'browser' ||
      receipt.workspaceId !== row.workspaceId
    )
      suiteFail('BROWSER_SESSION_IDENTITY');
    const next: B.BrowserRun = {
      ...current,
      executionState: receipt.state === 'preparing' ? 'prepared' : receipt.state,
      cleanup: receipt.cleanup,
      outcome:
        receipt.outcome === 'passed' ? 'passed' : receipt.outcome === 'failed' ? 'failed' : 'inconclusive',
      error: receipt.error,
    };
    if (receipt.output && receipt.cleanup === 'confirmed' && !current.environment) {
      const value = await this.output(input, receipt),
        target = await this.native(input, current.target, 'browser-targets', B.browserTarget),
        journey = await this.native(input, current.journey, 'browser-journeys', B.browserJourney);
      next.environment = {
        image: target.value.image,
        toolDigest: receipt.toolDigest,
        browserVersion: value.browserVersion,
        fontDigest: value.fontDigest,
        platform: value.platform,
        viewport: journey.value.definition.viewport,
        timezone: journey.value.definition.timezone,
      };
      next.observations = value.observations;
      next.accessibility = value.accessibility;
      next.accessibilityTruncated = value.accessibilityTruncated;
      next.blockedRequests = value.blockedRequests;
      next.error = value.error ?? receipt.error;
      next.outcome = value.observations.some(
        (step) => step.status === 'failed' || step.assertions.some((rule) => !rule.passed),
      )
        ? 'failed'
        : !value.completed
          ? 'inconclusive'
          : 'passed';
      for (const shot of value.screenshots) {
        const artifact = await this.targets.publishArtifact({
          ...scope(input),
          source: target.value.source,
          name: `步骤 ${shot.step + 1} 截图`,
          data: shot.data,
          digest: shot.digest,
          allowExport: exportArtifacts,
        });
        next.screenshots.push({
          step: shot.step,
          source: ref(artifact),
          digest: shot.digest,
          width: shot.width,
          height: shot.height,
        });
      }
    }
    if (suiteHash(next) === suiteHash(current)) return row;
    return this.put(
      {
        ...scope(input),
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        content: S.suiteJson.parse(next),
        references: [
          ...row.references,
          ...next.screenshots
            .filter((shot) => !row.references.some((old) => suiteHash(old) === suiteHash(shot.source)))
            .map((shot) => shot.source),
        ],
      },
      'result',
      true,
    );
  }
  async inspect(raw: z.infer<typeof B.browserRunSelect>) {
    const input = B.browserRunSelect.parse(raw);
    return this.exclusive(input.run.id, async () => {
      // 固定输入用于定位逻辑运行；输出更新使用该逻辑对象的最新修订，避免重复发布截图。
      await this.native(input, input.run, this.domain, B.browserRun);
      const heads = (await this.readState()).rows.filter(
        (row) =>
          row.id === input.run.id && row.workspaceId === input.workspaceId && row.actor === suiteActor(),
      );
      const row = heads.at(-1) ?? suiteFail('BROWSER_RUN_NOT_FOUND'),
        value = B.browserRun.parse(requireBrowserLocal(row, this.domain).content);
      const plan = (await this.readState()).plans.find(
        (plan) => plan.action === 'browser-run' && plan.result?.id === row.id,
      );
      if (!plan) suiteFail('BROWSER_RUN_PLAN_NOT_FOUND');
      const selected = savedPlan.parse(plan.input);
      for (const reference of row.references) await this.fixed(input, reference);
      const receipt = await this.sessions.inspect({ ...scope(input), id: value.sessionId });
      return this.synchronize(input, row, receipt, selected.exportArtifacts);
    });
  }
  private async owned(raw: z.infer<typeof B.browserRunSelect>) {
    const input = B.browserRunSelect.parse(raw);
    await this.access();
    const row = (await this.readState()).rows.find(
      (row) =>
        row.domain === input.run.domain &&
        row.id === input.run.id &&
        row.revision === input.run.revision &&
        row.workspaceId === input.workspaceId &&
        row.actor === suiteActor() &&
        row.origin === 'local',
    );
    if (!row) suiteFail('BROWSER_RUN_NOT_OWNED');
    return { input, run: B.browserRun.parse(row.content) };
  }
  async cancel(raw: z.infer<typeof B.browserRunSelect>) {
    const { input, run } = await this.owned(raw);
    return this.sessions.cancel({ ...scope(input), id: run.sessionId });
  }
  async reconcile(raw: z.infer<typeof B.browserRunSelect>) {
    const { input, run } = await this.owned(raw);
    return this.sessions.reconcile({ ...scope(input), id: run.sessionId });
  }
  protected override async releaseOwned(input: S.SuiteScope, row: S.SuiteRecord) {
    if (row.origin !== 'local') return;
    const run = B.browserRun.safeParse(row.content);
    if (!run.success) return;
    const receipt = await this.sessions.inspect({ ...scope(input), id: run.data.sessionId });
    if (receipt.cleanup !== 'confirmed')
      suiteFail('BROWSER_RUN_RESOURCES_RETAINED', '原浏览器和 VM 尚未确认清理');
    if (
      (await this.readState()).rows.some(
        (other) =>
          other.id === row.id && other.workspaceId === row.workspaceId && other.revision !== row.revision,
      )
    )
      return;
    await this.sessions.release({ ...scope(input), id: run.data.sessionId });
  }
}

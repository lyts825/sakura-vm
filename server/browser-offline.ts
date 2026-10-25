/** 离线检查字节、固定对象关联和可重算断言；不证明外来浏览器实际运行过。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as B from '../shared/contracts/browser-lab.ts';
import { suitePortableClaim } from '../shared/contracts/suite-portable.ts';
import { verifySuiteGraph, offlineHash, offlineKey, offlineSha } from './suite-offline.ts';
export const browserDomains = [
  'targets',
  'fixtures',
  'journeys',
  'runners',
  'assertions',
  'visual',
  'accessibility',
  'reports',
].map((id) => 'browser-' + id);
export const browserSchemas: Record<string, z.ZodType> = {
  'browser-targets': B.browserTarget,
  'browser-fixtures': B.browserFixture,
  'browser-journeys': B.browserJourney,
  'browser-runners': B.browserRun,
  'browser-assertions': B.browserAssertionEvaluation,
  'browser-visual': z.union([B.browserBaseline, B.browserVisualEvaluation]),
  'browser-accessibility': B.browserAccessibilityEvaluation,
  'browser-reports': B.browserReport,
};
export function verifyBrowserBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(bytes, 'sakura-browser-lab/1', browserDomains, 'browser-targets'),
    claims = new Map<string, unknown>();
  for (const row of graph.rows) {
    if (row.origin !== 'imported') throw new Error('BROWSER_PORTABLE_ORIGIN');
    if (row.kind === 'source') continue;
    const portable = suitePortableClaim.parse(row.content);
    claims.set(offlineKey(row), browserSchemas[row.domain].parse(portable.claims));
  }
  const get = <T>(ref: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) => {
    const row = graph.get(ref, owner);
    return schema.parse(claims.get(offlineKey(row)));
  };
  let reports = 0,
    runs = 0,
    assertions = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const content = claims.get(offlineKey(row));
    if (row.domain === 'browser-targets') {
      const target = B.browserTarget.parse(content),
        source = graph.get(target.source, row),
        data = graph.materials.get(offlineKey(source));
      if (!data || offlineSha(data) !== target.sourceDigest) throw new Error('BROWSER_TARGET_DIGEST');
      const site = B.browserSite.parse(JSON.parse(data.toString('utf8')));
      if (site.entry !== target.entry || site.files.length !== target.files)
        throw new Error('BROWSER_TARGET_MANIFEST');
    }
    if (row.domain === 'browser-fixtures') {
      const fixture = B.browserFixture.parse(content);
      get(fixture.target, B.browserTarget, row);
    }
    if (row.domain === 'browser-journeys') {
      const journey = B.browserJourney.parse(content),
        fixture = get(journey.fixture, B.browserFixture, row);
      get(journey.target, B.browserTarget, row);
      if (offlineKey(fixture.target) !== offlineKey(journey.target))
        throw new Error('BROWSER_FIXTURE_TARGET');
    }
    if (row.domain === 'browser-runners') {
      const run = B.browserRun.parse(content),
        journey = get(run.journey, B.browserJourney, row);
      if (
        run.cleanup !== 'confirmed' ||
        ['prepared', 'running'].includes(run.executionState) ||
        offlineKey(run.target) !== offlineKey(journey.target) ||
        offlineKey(run.fixture) !== offlineKey(journey.fixture)
      )
        throw new Error('BROWSER_RUN_BINDING');
      for (const shot of run.screenshots) {
        const source = graph.get(shot.source, row),
          material = S.suiteMaterial.parse(source.content),
          data = graph.materials.get(offlineKey(source));
        if (
          material.format !== 'png' ||
          material.digest !== shot.digest ||
          !data ||
          !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          data.readUInt32BE(16) !== shot.width ||
          data.readUInt32BE(20) !== shot.height
        )
          throw new Error('BROWSER_SCREENSHOT_DIGEST');
      }
      runs++;
    }
    if (row.domain === 'browser-assertions') {
      const evaluation = B.browserAssertionEvaluation.parse(content),
        run = get(evaluation.run, B.browserRun, row),
        journey = get(evaluation.journey, B.browserJourney, row);
      const checks = journey.definition.assertions.map((rule, index) => {
        const actual = run.observations
          .find((o) => o.sequence === rule.step)
          ?.assertions.find((a) => a.index === index);
        return {
          index,
          rule,
          observed: !!actual,
          passed: actual?.passed ?? null,
          actual: actual?.actual ?? null,
        };
      });
      for (const check of checks)
        if (check.observed) {
          const actual = check.actual!,
            expected = check.rule.expected,
            passed =
              check.rule.comparison === 'absent'
                ? ['', 'false'].includes(actual)
                : check.rule.comparison === 'contains'
                  ? actual.includes(expected)
                  : actual === expected;
          if (passed !== check.passed) throw new Error('BROWSER_ASSERTION_OBSERVATION');
        }
      const outcome = checks.some((c) => c.passed === false)
        ? 'failed'
        : !checks.length || checks.some((c) => !c.observed) || run.executionState !== 'completed'
          ? 'inconclusive'
          : 'passed';
      if (
        offlineHash(checks) !== offlineHash(evaluation.checks) ||
        outcome !== evaluation.outcome ||
        evaluation.coverage.selected !== checks.length ||
        evaluation.coverage.observed !== checks.filter((c) => c.observed).length
      )
        throw new Error('BROWSER_ASSERTION_RESULT');
      assertions++;
    }
    if (row.domain === 'browser-accessibility') {
      const evaluation = B.browserAccessibilityEvaluation.parse(content),
        run = get(evaluation.run, B.browserRun, row),
        journey = get(run.journey, B.browserJourney);
      const outcome = run.accessibility.length
        ? 'failed'
        : run.executionState !== 'completed' ||
            run.accessibilityTruncated ||
            !journey.definition.accessibility.length
          ? 'inconclusive'
          : 'passed';
      if (
        offlineHash(evaluation.selected) !== offlineHash(journey.definition.accessibility) ||
        offlineHash(evaluation.findings) !== offlineHash(run.accessibility) ||
        evaluation.outcome !== outcome
      )
        throw new Error('BROWSER_ACCESSIBILITY_RESULT');
    }
    if (row.domain === 'browser-visual') {
      const baseline = B.browserBaseline.safeParse(content);
      if (baseline.success) {
        const run = get(baseline.data.run, B.browserRun, row);
        if (
          offlineHash(baseline.data.shots) !== offlineHash(run.screenshots) ||
          offlineHash(baseline.data.environment) !== offlineHash(run.environment)
        )
          throw new Error('BROWSER_BASELINE_RESULT');
      } else {
        const v = B.browserVisualEvaluation.parse(content),
          run = get(v.run, B.browserRun, row);
        if (offlineHash(v.baseline) !== offlineHash(run.baseline)) throw new Error('BROWSER_VISUAL_BINDING');
        for (const d of v.differences)
          if (d.changed > d.pixels || d.ratio !== (d.pixels ? d.changed / d.pixels : null))
            throw new Error('BROWSER_VISUAL_RATIO');
      }
    }
    if (row.domain === 'browser-reports') {
      const report = B.browserReport.parse(content),
        run = get(report.run, B.browserRun, row),
        journey = get(run.journey, B.browserJourney),
        a = get(report.assertions, B.browserAssertionEvaluation, row),
        v = get(report.visual, B.browserVisualEvaluation, row),
        c = get(report.accessibility, B.browserAccessibilityEvaluation, row);
      if ([a.run, v.run, c.run].some((ref) => offlineKey(ref) !== offlineKey(report.run)))
        throw new Error('BROWSER_REPORT_BINDING');
      const selected = [
          ...(journey.definition.assertions.length ? ['assertions'] : []),
          ...(journey.definition.visual.enabled ? ['visual'] : []),
          ...(journey.definition.accessibility.length ? ['accessibility'] : []),
        ],
        values = [
          ...(selected.includes('assertions') ? [a.outcome] : []),
          ...(selected.includes('visual') ? [v.outcome] : []),
          ...(selected.includes('accessibility') ? [c.outcome] : []),
        ];
      const outcome =
        values.includes('failed') || run.outcome === 'failed'
          ? 'failed'
          : !values.length || run.executionState !== 'completed' || values.some((v) => v !== 'passed')
            ? 'inconclusive'
            : 'passed';
      if (
        offlineHash(selected) !== offlineHash(report.selected) ||
        outcome !== report.outcome ||
        report.cleanup !== run.cleanup
      )
        throw new Error('BROWSER_REPORT_RESULT');
      reports++;
    }
  }
  if (!reports) throw new Error('BROWSER_REPORT_REQUIRED');
  return {
    format: 'sakura-browser-lab/1',
    valid: true,
    objects: graph.rows.length,
    runs,
    assertions,
    reports,
    sourceTrust: 'unauthenticated',
    browserExecutionVerified: false,
    visualPixelsRecomputed: false,
    approvalsTransferred: false,
    manifestDigest: graph.manifestDigest,
  };
}

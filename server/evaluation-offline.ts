/** 便携评测只核验来源声明和可重算规则，不证明模型身份或真实调用。 */
import { z } from 'zod';
import * as S from '../shared/contracts/suite-common.ts';
import * as E from '../shared/contracts/evaluation-studio.ts';
import { verifySuiteGraph, offlineHash, offlineKey } from './suite-offline.ts';
import {
  evaluateRule,
  compareEvaluation,
  evaluationVariables,
  renderEvaluation,
} from './evaluation-analysis.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
export const evaluationDomains = [
  'datasets',
  'prompts',
  'endpoints',
  'runners',
  'scorers',
  'comparisons',
  'reviews',
  'reports',
].map((id) => 'evaluation-' + id);
export const evaluationPortable = z
  .object({
    format: z.literal('sakura-evaluation-portable/1'),
    sourceTrust: z.literal('unauthenticated'),
    approvalsTransferred: z.literal(false),
    executionAllowed: z.literal(false),
    sourceRecordDigest: S.suiteDigest,
    claims: S.suiteJson,
  })
  .strict();
export const evaluationSchemas: Record<string, z.ZodType> = {
  'evaluation-datasets': E.evaluationDataset,
  'evaluation-prompts': E.evaluationPrompt,
  'evaluation-endpoints': E.evaluationEndpoint,
  'evaluation-runners': E.evaluationRun,
  'evaluation-scorers': E.evaluationScore,
  'evaluation-comparisons': E.evaluationComparison,
  'evaluation-reviews': E.evaluationReview,
  'evaluation-reports': E.evaluationReport,
};
export function verifyEvaluationBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(
      bytes,
      'sakura-model-evaluation/1',
      evaluationDomains,
      'evaluation-datasets',
    ),
    claims = new Map<string, unknown>();
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    const portable = evaluationPortable.parse(row.content),
      value = evaluationSchemas[row.domain].parse(portable.claims);
    claims.set(offlineKey(row), value);
    if (row.origin !== 'imported') throw new Error('EVALUATION_PORTABLE_ORIGIN');
  }
  const get = <T>(r: S.SuiteRef, schema: z.ZodType<T>, owner?: S.SuiteRecord) => {
    const row = graph.get(r, owner);
    return schema.parse(claims.get(offlineKey(row)));
  };
  let ruleScores = 0,
    comparisons = 0,
    reports = 0;
  for (const row of graph.rows) {
    if (row.kind === 'source') continue;
    if (row.domain === 'evaluation-datasets') {
      const d = E.evaluationDataset.parse(claims.get(offlineKey(row))),
        source = graph.get(d.source, row);
      if (
        S.suiteMaterial.parse(source.content).digest !== d.sourceDigest ||
        offlineHash(d.samples) !== d.selectionDigest ||
        new Set(d.samples.map((s) => s.id)).size !== d.samples.length
      )
        throw new Error('EVALUATION_DATASET_DIGEST');
      const material = graph.materials.get(offlineKey(source));
      if (!material) throw new Error('EVALUATION_DATASET_SOURCE');
      const sourceSamples = z
        .array(E.evaluationSample)
        .min(1)
        .max(100)
        .parse(parseSuiteJson(new TextDecoder('utf-8', { fatal: true }).decode(material), 1024 * 1024));
      if (
        d.samples.some(
          (sample) =>
            !sourceSamples.some(
              (original) => original.id === sample.id && offlineHash(original) === offlineHash(sample),
            ),
        )
      )
        throw new Error('EVALUATION_DATASET_SOURCE_MISMATCH');
      if (d.parent) {
        const parent = get(d.parent, E.evaluationDataset, row);
        if (
          offlineKey(parent.source) !== offlineKey(d.source) ||
          d.samples.some(
            (sample) => !parent.samples.some((original) => offlineHash(original) === offlineHash(sample)),
          )
        )
          throw new Error('EVALUATION_DATASET_PARENT');
      }
    }
    if (row.domain === 'evaluation-prompts') {
      const p = E.evaluationPrompt.parse(claims.get(offlineKey(row))),
        d = get(p.dataset, E.evaluationDataset, row);
      if (offlineHash(p.variables) !== offlineHash(evaluationVariables(p.template)))
        throw new Error('EVALUATION_PROMPT_VARIABLES');
      d.samples.forEach((sample) => renderEvaluation(p, sample));
    }
    if (row.domain === 'evaluation-runners') {
      const r = E.evaluationRun.parse(claims.get(offlineKey(row))),
        d = get(r.dataset, E.evaluationDataset, row),
        p = get(r.prompt, E.evaluationPrompt, row),
        keys = r.items.map((item) => item.sampleId + ':' + item.repeat);
      if (
        r.planId ||
        r.planDigest ||
        r.items.some((item) => item.callId) ||
        offlineKey(p.dataset) !== offlineKey(r.dataset) ||
        new Set(keys).size !== keys.length ||
        r.items.length !== d.samples.length * r.repeats ||
        r.items.some(
          (item) => item.repeat >= r.repeats || !d.samples.some((sample) => sample.id === item.sampleId),
        )
      )
        throw new Error('EVALUATION_RUN_BINDING');
    }
    if (row.domain === 'evaluation-endpoints') {
      const e = E.evaluationEndpoint.parse(claims.get(offlineKey(row)));
      if (e.secret || e.target.secretVersion) throw new Error('EVALUATION_PORTABLE_CREDENTIAL');
    }
    if (row.domain === 'evaluation-scorers') {
      const s = E.evaluationScore.parse(claims.get(offlineKey(row))),
        run = get(s.run, E.evaluationRun, row),
        d = get(s.dataset, E.evaluationDataset, row);
      if (
        offlineKey(run.dataset) !== offlineKey(s.dataset) ||
        s.judgeReceipts.length ||
        s.judgeIntents.length
      )
        throw new Error('EVALUATION_SCORE_BINDING');
      const keys = run.items.map((item) => item.sampleId + ':' + item.repeat),
        scoreKeys = s.scores.map((item) => item.sampleId + ':' + item.repeat);
      if (
        new Set(scoreKeys).size !== scoreKeys.length ||
        scoreKeys.length !== keys.length ||
        scoreKeys.some((k) => !keys.includes(k)) ||
        s.scores.some((item) => item.basis !== s.basis)
      )
        throw new Error('EVALUATION_SCORE_COVERAGE');
      if (s.basis === 'rule') {
        if (!s.rule || offlineHash(evaluateRule(run, d, s.rule)) !== offlineHash(s.scores))
          throw new Error('EVALUATION_RULE_MISMATCH');
        ruleScores++;
      }
    }
    if (row.domain === 'evaluation-comparisons') {
      const c = E.evaluationComparison.parse(claims.get(offlineKey(row))),
        l = get(c.left, E.evaluationRun, row),
        r = get(c.right, E.evaluationRun, row),
        a = get(c.leftScore, E.evaluationScore, row),
        b = get(c.rightScore, E.evaluationScore, row);
      const actual = compareEvaluation(
        l,
        r,
        a,
        b,
        get(l.dataset, E.evaluationDataset),
        get(r.dataset, E.evaluationDataset),
        get(l.prompt, E.evaluationPrompt),
        get(r.prompt, E.evaluationPrompt),
      );
      if (offlineKey(a.run) !== offlineKey(c.left) || offlineKey(b.run) !== offlineKey(c.right))
        throw new Error('EVALUATION_COMPARISON_RUN');
      for (const [key, value] of Object.entries(actual))
        if (offlineHash(value) !== offlineHash(c[key as keyof typeof c]))
          throw new Error('EVALUATION_COMPARISON_MISMATCH');
      comparisons++;
    }
    if (row.domain === 'evaluation-reports') {
      const r = E.evaluationReport.parse(claims.get(offlineKey(row))),
        review = get(r.review, E.evaluationReview, row);
      if (review.decision !== 'accepted' || offlineKey(review.comparison) !== offlineKey(r.comparison))
        throw new Error('EVALUATION_REPORT_REVIEW');
      reports++;
    }
  }
  if (!reports) throw new Error('EVALUATION_REPORT_REQUIRED');
  return {
    format: 'sakura-model-evaluation/1',
    valid: true,
    objects: graph.rows.length,
    ruleScores,
    comparisons,
    reports,
    sourceTrust: 'unauthenticated',
    modelExecutionVerified: false,
    approvalsTransferred: false,
    manifestDigest: graph.manifestDigest,
  };
}

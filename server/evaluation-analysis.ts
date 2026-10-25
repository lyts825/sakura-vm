/** 无 I/O 的固定模板与逐样例评分，模型文本不参与权限或动态执行。 */
import { z } from 'zod';
import * as E from '../shared/contracts/evaluation-studio.ts';
import { createHash } from 'node:crypto';
import { canonicalBundle } from '../scripts/suite-bundle.mjs';
import { AppError } from '../shared/errors.ts';
const suiteHash = (v: unknown) => createHash('sha256').update(canonicalBundle(v)).digest('hex');
function suiteFail(code: string): never {
  throw new AppError(code, 400, code);
}
export function evaluationVariables(template: string) {
  const all = [...template.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);
  if (
    all.some((v) => !['input', 'id', 'label', 'reference'].includes(v)) ||
    template.replace(/\{\{(?:input|id|label|reference)\}\}/g, '').includes('{{')
  )
    suiteFail('EVALUATION_TEMPLATE_VARIABLE');
  if (!all.includes('input')) suiteFail('EVALUATION_TEMPLATE_INPUT_REQUIRED');
  return [...new Set(all)] as ('input' | 'id' | 'label' | 'reference')[];
}
export function renderEvaluation(
  prompt: z.infer<typeof E.evaluationPrompt>,
  sample: z.infer<typeof E.evaluationSample>,
) {
  evaluationVariables(prompt.template);
  const value = prompt.template.replace(/\{\{(input|id|label|reference)\}\}/g, (_m, k: keyof typeof sample) =>
    String(sample[k]),
  );
  if (Buffer.byteLength(value) > 65536) suiteFail('EVALUATION_PROMPT_LIMIT');
  return value;
}
export function evaluateRule(
  run: E.EvaluationRun,
  dataset: E.EvaluationDataset,
  rule: z.infer<typeof E.evaluationRule>,
) {
  const rows = run.items.map((item) => {
    const sample = dataset.samples.find((s) => s.id === item.sampleId);
    if (!sample) suiteFail('EVALUATION_SAMPLE_MISMATCH');
    let value: number | null = null,
      reason = '结果未知或截断，不能评分';
    if (item.status === 'returned' && !item.truncated) {
      if (rule.kind === 'exact') {
        let a = item.text,
          b = sample.reference;
        if (rule.trim) {
          a = a.trim();
          b = b.trim();
        }
        if (!rule.caseSensitive) {
          a = a.toLocaleLowerCase('en-US');
          b = b.toLocaleLowerCase('en-US');
        }
        value = a === b ? 1 : 0;
        reason = '与固定参考答案比较';
      } else if (rule.kind === 'contains') {
        value = item.text.includes(rule.text) ? 1 : 0;
        reason = '固定字面量包含检查';
      } else {
        try {
          const parsed = JSON.parse(item.text);
          value =
            parsed &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed) &&
            rule.fields.every((f) => Object.hasOwn(parsed, f))
              ? 1
              : 0;
        } catch {
          value = 0;
        }
        reason = 'JSON 对象及明确字段检查';
      }
    }
    return E.evaluationScoreRow.parse({
      sampleId: item.sampleId,
      repeat: item.repeat,
      value,
      reason,
      basis: 'rule',
      uncertain: value === null,
    });
  });
  return rows;
}
export function compareEvaluation(
  left: E.EvaluationRun,
  right: E.EvaluationRun,
  a: z.infer<typeof E.evaluationScore>,
  b: z.infer<typeof E.evaluationScore>,
  ld: E.EvaluationDataset,
  rd: E.EvaluationDataset,
  lp: z.infer<typeof E.evaluationPrompt>,
  rp: z.infer<typeof E.evaluationPrompt>,
) {
  const key = (x: { sampleId: string; repeat: number }) => x.sampleId + ':' + x.repeat,
    am = new Map(a.scores.map((r) => [key(r), r])),
    bm = new Map(b.scores.map((r) => [key(r), r]));
  const common = [...am.keys()].filter((k) => bm.has(k)),
    missingLeft = [...bm.keys()].filter((k) => !am.has(k)),
    missingRight = [...am.keys()].filter((k) => !bm.has(k));
  const changedSamples = ld.samples
    .filter((s) => {
      const r = rd.samples.find((i) => i.id === s.id);
      return (
        r &&
        suiteHash({ input: s.input, label: s.label, reference: s.reference }) !==
          suiteHash({ input: r.input, label: r.label, reference: r.reference })
      );
    })
    .map((s) => s.id);
  const settingsEqual =
    suiteHash({ template: lp.template, system: lp.system, options: lp.options, repeats: left.repeats }) ===
    suiteHash({ template: rp.template, system: rp.system, options: rp.options, repeats: right.repeats });
  const basisEqual =
    suiteHash({ basis: a.basis, rule: a.rule, rubric: a.rubric }) ===
    suiteHash({ basis: b.basis, rule: b.rule, rubric: b.rubric });
  const pairs = common.map((k) => {
    const l = am.get(k)!.value,
      r = bm.get(k)!.value;
    return { key: k, left: l, right: r, delta: l !== null && r !== null ? r - l : null };
  });
  const comparable =
    common.length > 0 &&
    !changedSamples.length &&
    !missingLeft.length &&
    !missingRight.length &&
    settingsEqual &&
    basisEqual &&
    pairs.every((p) => p.delta !== null) &&
    ld.role === 'evaluation' &&
    rd.role === 'evaluation';
  return {
    common,
    missingLeft,
    missingRight,
    changedSamples,
    pairs,
    comparable,
    settingsEqual,
    basisEqual,
    roles: [ld.role, rd.role] as ['evaluation' | 'tuning', 'evaluation' | 'tuning'],
    limitations: [
      ...(!settingsEqual ? ['生成设置不同，仅列出观测差异'] : []),
      ...(!basisEqual ? ['评分依据不同，不给出统一优劣结论'] : []),
      ...(ld.role === 'tuning' || rd.role === 'tuning' ? ['包含调参样例，不能据此宣称泛化能力'] : []),
      '共同样例不代表总体或独立抽样',
      '人工评分来自当前单一账户，模型评分仅为模型意见',
    ],
  };
}

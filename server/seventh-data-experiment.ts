/** 固定分配、分层平均差/比例差及有界百分位重采样；来源声明不证明外部随机化。 */
import { z } from 'zod';
import { parseTemporal, temporalTimestamp } from './seventh-data-temporal.ts';
import {
  dataCompare,
  dataId,
  dataError,
  uniqueDataIds,
  checkDataSignal,
  makeDataRng,
  dataQuantile,
} from '../shared/seventh-data-contracts.ts';

const seed = z.number().int().min(0).max(4294967295);
export function validateExperimentQuestion(raw: unknown) {
  const stoppingRule = z.discriminatedUnion('kind', [z.object({ kind: z.literal('fixed-sample'), units: z.number().int().min(2).max(100000) }).strict(), z.object({ kind: z.literal('fixed-cutoff'), cutoff: temporalTimestamp }).strict()]);
  const input = z.object({ question: z.string().trim().min(1).max(4096), schemeA: z.string().trim().min(1).max(1024), schemeB: z.string().trim().min(1).max(1024), unit: z.string().trim().min(1).max(1024), population: z.string().trim().min(1).max(4096), scopeLimitations: z.array(z.string().trim().min(1).max(2048)).min(1).max(100), unitModel: z.enum(['independent', 'cluster', 'crossover', 'repeated']), hypothesis: z.literal('two-sided'), targetDifference: z.number().finite().optional(), stoppingRule }).strict().parse(raw);
  if (input.schemeA === input.schemeB) dataError('EXPERIMENT_IDENTICAL_SCHEMES', '比较的 A 与 B 方案必须不同');
  const cutoffNanos = input.stoppingRule.kind === 'fixed-cutoff' ? parseTemporal(input.stoppingRule.cutoff).nanos.toString() : null;
  return { ...input, cutoffNanos, direction: 'B-minus-A', analysisSupported: input.unitModel === 'independent', unsupportedReason: input.unitModel === 'independent' ? null : '首版估计只支持两组独立单位；已登记的簇、交叉或重复结构不能当独立单位计算', verdict: input.unitModel === 'independent' ? 'passed' : 'unsupported', externalTimingVerified: false, causalClaim: false };
}

export function validateExperimentOutcomes(raw: unknown) {
  const definition = z.object({ id: dataId, name: z.string().trim().min(1).max(512), role: z.enum(['primary', 'secondary']), kind: z.enum(['continuous', 'binary']), unit: z.string().trim().min(1).max(256), numerator: z.enum(['sum-values', 'success-count']), denominator: z.literal('valid-observed-units'), missingPolicy: z.literal('exclude-and-report'), window: z.object({ start: temporalTimestamp, end: temporalTimestamp }).strict(), exclusions: z.array(z.string().trim().min(1).max(1024)).max(100), values: z.array(z.number().finite().nullable()).max(100000).optional() }).strict();
  const input = z.object({ outcomes: z.array(definition).min(1).max(64) }).strict().parse(raw); uniqueDataIds(input.outcomes.map(outcome => outcome.id), '指标');
  if (input.outcomes.filter(outcome => outcome.role === 'primary').length !== 1) dataError('EXPERIMENT_PRIMARY_OUTCOME', '须固定恰好一个主要指标');
  let valueCount = 0;
  const outcomes = input.outcomes.map(outcome => {
    const start = parseTemporal(outcome.window.start).nanos, end = parseTemporal(outcome.window.end).nanos;
    if (start >= end) dataError('EXPERIMENT_OUTCOME_WINDOW', '指标观察窗口须为正向非空区间');
    if ((outcome.kind === 'binary') !== (outcome.numerator === 'success-count')) dataError('EXPERIMENT_OUTCOME_NUMERATOR', '二元指标须使用成功计数，连续指标须使用数值之和');
    const values = outcome.values; valueCount += values?.length ?? 0; if (valueCount > 100000) dataError('EXPERIMENT_OUTCOME_LIMIT', '全部指标示例值合计最多 10 万项');
    if (outcome.kind === 'binary' && values?.some(value => value !== null && value !== 0 && value !== 1)) dataError('EXPERIMENT_BINARY', '二元指标值只能为 0、1 或缺失');
    const observed = values?.filter((value): value is number => value !== null), numerator = observed?.reduce((sum, value) => sum + value, 0);
    if (numerator !== undefined && !Number.isFinite(numerator)) dataError('EXPERIMENT_NUMERIC_OVERFLOW', '指标分子求和溢出');
    const { values: _values, ...defined } = outcome;
    return { ...defined, startNanos: start.toString(), endNanos: end.toString(), interval: '[start,end)', example: observed ? { numerator: numerator!, denominator: observed.length, missing: values!.length - observed.length, estimate: observed.length ? numerator! / observed.length : null, unavailableReason: observed.length ? null : 'zero-valid-observed-denominator' } : null };
  });
  return { outcomes, primaryOutcome: outcomes.find(outcome => outcome.role === 'primary')!.id, verdict: 'passed', examplesAreObservations: false, intervalMethod: 'within-group-within-stratum-percentile-bootstrap-v1', direction: 'B-minus-A' };
}

export function validateExperimentAllocation(raw: unknown, signal?: AbortSignal) {
  const result = assignExperiment(raw, signal);
  const emptyGroups = result.counts.filter(row => row.A === 0 || row.B === 0).map(row => ({ stratum: row.stratum, empty: row.A === 0 ? 'A' : 'B' }));
  const insufficientForInterval = result.counts.filter(row => row.A < 2 || row.B < 2).map(row => row.stratum);
  const blocks = new Map<string, { stratum: string; block: number; A: number; B: number }>();
  for (const assignment of result.assignments) { const key = assignment.stratum + '\0' + assignment.block; const row = blocks.get(key) ?? { stratum: assignment.stratum, block: assignment.block, A: 0, B: 0 }; row[assignment.group]++; blocks.set(key, row); }
  return { ...result, blocks: [...blocks.values()], emptyGroups, insufficientForInterval, allocationFeasible: emptyGroups.length === 0, intervalFeasibleBeforeMissingness: insufficientForInterval.length === 0, verdict: emptyGroups.length ? 'failed' : 'passed', groupingOnly: true, externalRandomizationVerified: false, interpretation: 'fixed-design-feasibility-not-evidence-of-external-randomization' };
}
export function assignExperiment(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({
      units: z
        .array(z.object({ id: dataId, stratum: dataId.default('all') }).strict())
        .min(1)
        .max(100000),
      proportionB: z.number().gt(0).lt(1).default(0.5),
      seed,
      blockSize: z.number().int().min(2).max(1000).nullable().default(null),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(
    input.units.map((u) => u.id),
    '实验单位',
  );
  const random = makeDataRng(input.seed),
    strata = new Map<string, typeof input.units>();
  for (const unit of input.units) {
    const existing = strata.get(unit.stratum);
    if (existing) existing.push(unit);
    else strata.set(unit.stratum, [unit]);
  }
  if (strata.size > 100) dataError('EXPERIMENT_STRATA_LIMIT', '实验分层超过 100');
  const assignments: { id: string; stratum: string; group: 'A' | 'B'; block: number }[] = [],
    counts: { stratum: string; A: number; B: number }[] = [];
  for (const [stratum, members] of [...strata].sort(([a], [b]) => dataCompare(a, b))) {
    checkDataSignal(signal);
    const shuffled = [...members].sort((a, b) => dataCompare(a.id, b.id));
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let assignedB = 0;
    const blockSize = input.blockSize ?? shuffled.length;
    for (let start = 0; start < shuffled.length; start += blockSize) {
      const block = shuffled.slice(start, start + blockSize),
        bCount = Math.round(block.length * input.proportionB);
      for (let i = 0; i < block.length; i++) {
        const group = i < bCount ? 'B' : 'A';
        if (group === 'B') assignedB++;
        assignments.push({ id: block[i].id, stratum, group, block: Math.floor(start / blockSize) });
      }
    }
    counts.push({ stratum, A: members.length - assignedB, B: assignedB });
  }
  return {
    assignments: assignments.sort((a, b) => dataCompare(a.id, b.id)),
    counts,
    seed: input.seed,
    algorithm: 'mulberry32-fisher-yates-stratified-v1',
    rounding: 'per-block-nearest-ties-up',
    externalRandomizationVerified: false,
    verdict: 'passed',
  };
}
const observation = z
  .object({
    id: dataId,
    group: z.enum(['A', 'B']),
    assignedGroup: z.enum(['A', 'B']).optional(),
    stratum: dataId.default('all'),
    value: z.number().finite().nullable(),
  })
  .strict();
const analysisSchema = z
  .object({
    observations: z.array(observation).max(100000),
    outcome: z.enum(['continuous', 'binary']),
    weights: z.record(dataId, z.number().nonnegative().max(1)).default({ all: 1 }),
    seed,
    repetitions: z.number().int().min(100).max(10000).default(2000),
    level: z.number().gt(0).lt(1).default(0.95),
    unitModel: z.literal('independent').default('independent'),
    grouping: z.enum(['assigned', 'received']).default('assigned'),
  })
  .strict();
type AnalysisInput = z.infer<typeof analysisSchema>;
function analyzeParsed(input: AnalysisInput, signal?: AbortSignal) {
  uniqueDataIds(
    input.observations.map((o) => o.id),
    '观测单位',
  );
  const strata = Object.keys(input.weights).sort();
  if (
    !strata.length ||
    strata.length > 100 ||
    Math.abs(Object.values(input.weights).reduce((s, n) => s + n, 0) - 1) > 1e-12
  )
    dataError('EXPERIMENT_WEIGHTS', '分层权重须非负且和为 1，最多 100 层');
  if (input.observations.some((o) => !Object.hasOwn(input.weights, o.stratum)))
    dataError('EXPERIMENT_STRATUM_MISSING', '观测分层未在预设权重中声明');
  if (
    input.outcome === 'binary' &&
    input.observations.some((o) => o.value !== null && o.value !== 0 && o.value !== 1)
  )
    dataError('EXPERIMENT_BINARY', '二元指标仅支持 0、1 或缺失值');
  if (input.repetitions * input.observations.length > 50000000)
    dataError('EXPERIMENT_WORK_LIMIT', '重采样单位展开超过 5000 万');
  const byStratum = strata.map((stratum) => {
    const rows = input.observations.filter((o) => o.stratum === stratum),
      select = (group: 'A' | 'B') =>
        rows.filter(
          (o) => (input.grouping === 'assigned' ? (o.assignedGroup ?? o.group) : o.group) === group,
        ),
      aRows = select('A'),
      bRows = select('B'),
      A = aRows.filter((o) => o.value !== null).map((o) => o.value!),
      B = bRows.filter((o) => o.value !== null).map((o) => o.value!);
    const sumA = A.reduce((s, n) => s + n, 0),
      sumB = B.reduce((s, n) => s + n, 0);
    if (!Number.isFinite(sumA) || !Number.isFinite(sumB))
      dataError('EXPERIMENT_NUMERIC_OVERFLOW', '指标求和溢出');
    return {
      stratum,
      weight: input.weights[stratum],
      A,
      B,
      totalA: aRows.length,
      totalB: bRows.length,
      missingA: aRows.length - A.length,
      missingB: bRows.length - B.length,
      numeratorA: sumA,
      numeratorB: sumB,
      denominatorA: A.length,
      denominatorB: B.length,
      meanA: A.length ? sumA / A.length : null,
      meanB: B.length ? sumB / B.length : null,
      difference: A.length && B.length ? sumB / B.length - sumA / A.length : null,
    };
  });
  const estimate = byStratum.every((s) => s.difference !== null || s.weight === 0)
    ? byStratum.reduce((sum, s) => sum + (s.difference ?? 0) * s.weight, 0)
    : null;
  let reason: string | null = byStratum.some((s) => s.weight > 0 && (s.A.length < 2 || s.B.length < 2))
    ? 'each-active-stratum-group-needs-two-valid-units'
    : null;
  const random = makeDataRng(input.seed),
    replicates: number[] = [];
  const resampleMean = (values: number[]) => {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)];
    return sum / values.length;
  };
  if (!reason)
    for (let repeat = 0; repeat < input.repetitions; repeat++) {
      checkDataSignal(signal);
      let value = 0;
      for (const stratum of byStratum)
        if (stratum.weight > 0) value += stratum.weight * (resampleMean(stratum.B) - resampleMean(stratum.A));
      if (!Number.isFinite(value)) dataError('EXPERIMENT_NUMERIC_OVERFLOW', '重采样估计溢出');
      replicates.push(value);
    }
  replicates.sort((a, b) => a - b);
  if (replicates.length && replicates[0] === replicates.at(-1))
    reason = 'degenerate-single-point-resampling-distribution';
  const alpha = (1 - input.level) / 2,
    interval =
      !reason && replicates.length
        ? {
            lower: dataQuantile(replicates, alpha),
            upper: dataQuantile(replicates, 1 - alpha),
            level: input.level,
          }
        : null;
  return {
    estimate,
    interval,
    intervalUnavailableReason: reason,
    strata: byStratum.map(({ A, B, ...row }) => row),
    missingPolicy: 'exclude-and-report',
    outcome: input.outcome,
    direction: 'B-minus-A',
    grouping: input.grouping,
    crossoverCount: input.observations.filter(
      (o) => o.assignedGroup !== undefined && o.assignedGroup !== o.group,
    ).length,
    method: 'within-group-within-stratum-percentile-bootstrap-v1',
    quantile: 'linear-n-minus-one',
    repetitions: replicates.length,
    requestedRepetitions: input.repetitions,
    seed: input.seed,
    verdict: interval ? 'passed' : 'inconclusive',
    causalClaim: false,
  };
}
export function analyzeExperiment(raw: unknown, signal?: AbortSignal) {
  return analyzeParsed(analysisSchema.parse(raw), signal);
}
export function validateExperimentObservations(raw: unknown) {
  const input = z
    .object({
      observations: z.array(observation).max(100000),
      assigned: z
        .array(z.object({ id: dataId, group: z.enum(['A', 'B']), stratum: dataId.default('all') }).strict())
        .max(100000),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(
    input.observations.map((o) => o.id),
    '观测',
  );
  uniqueDataIds(
    input.assigned.map((o) => o.id),
    '分配',
  );
  const assigned = new Map(input.assigned.map((o) => [o.id, o])),
    observations = new Map(input.observations.map((o) => [o.id, o]));
  return {
    missingObservations: input.assigned.filter((a) => !observations.has(a.id)).map((a) => a.id),
    unassignedObservations: input.observations.filter((a) => !assigned.has(a.id)).map((a) => a.id),
    crossovers: input.observations
      .filter((a) => assigned.has(a.id) && assigned.get(a.id)!.group !== a.group)
      .map((a) => a.id),
    stratumChanges: input.observations
      .filter((a) => assigned.has(a.id) && assigned.get(a.id)!.stratum !== a.stratum)
      .map((a) => a.id),
    missingOutcomes: input.observations.filter((o) => o.value === null).map((o) => o.id),
    externalAssignmentVerified: false,
  };
}
const scenario = z.discriminatedUnion('distribution', [
  z
    .object({
      id: dataId,
      distribution: z.literal('normal'),
      nA: z.number().int().min(2).max(10000),
      nB: z.number().int().min(2).max(10000),
      meanA: z.number().finite(),
      meanB: z.number().finite(),
      sdA: z.number().positive().finite(),
      sdB: z.number().positive().finite(),
    })
    .strict(),
  z
    .object({
      id: dataId,
      distribution: z.literal('bernoulli'),
      nA: z.number().int().min(2).max(10000),
      nB: z.number().int().min(2).max(10000),
      probabilityA: z.number().min(0).max(1),
      probabilityB: z.number().min(0).max(1),
    })
    .strict(),
]);
export function simulateExperiment(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({
      scenarios: z.array(scenario).min(1).max(200),
      seed,
      simulations: z.number().int().min(1).max(10000).default(100),
      bootstrapRepetitions: z.number().int().min(100).max(10000).default(200),
      level: z.number().gt(0).lt(1).default(0.95),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(
    input.scenarios.map((s) => s.id),
    '规模情景',
  );
  if (input.scenarios.length * input.simulations * input.bootstrapRepetitions > 1000000)
    dataError('EXPERIMENT_RESAMPLE_LIMIT', '单任务重采样超过 100 万');
  if (
    input.scenarios.reduce((sum, s) => sum + s.nA + s.nB, 0) *
      input.simulations *
      input.bootstrapRepetitions >
    50000000
  )
    dataError('EXPERIMENT_WORK_LIMIT', '规模模拟单位展开超过 5000 万');
  const random = makeDataRng(input.seed),
    gaussian = () =>
      Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, random()))) * Math.cos(2 * Math.PI * random());
  const results = input.scenarios.map((s) => {
    let detected = 0,
      valid = 0,
      failed = 0;
    for (let repetition = 0; repetition < input.simulations; repetition++) {
      checkDataSignal(signal);
      const observations: AnalysisInput['observations'] = [];
      for (const group of ['A', 'B'] as const)
        for (let i = 0; i < (group === 'A' ? s.nA : s.nB); i++) {
          const value =
            s.distribution === 'normal'
              ? (group === 'A' ? s.meanA : s.meanB) + (group === 'A' ? s.sdA : s.sdB) * gaussian()
              : random() < (group === 'A' ? s.probabilityA : s.probabilityB)
                ? 1
                : 0;
          if (!Number.isFinite(value)) dataError('EXPERIMENT_NUMERIC_OVERFLOW', '模拟值超出数值范围');
          observations.push({ id: group + i, group, stratum: 'all', value });
        }
      const result = analyzeParsed(
        {
          observations,
          outcome: s.distribution === 'normal' ? 'continuous' : 'binary',
          weights: { all: 1 },
          seed: Math.floor(random() * 4294967296),
          repetitions: input.bootstrapRepetitions,
          level: input.level,
          unitModel: 'independent',
          grouping: 'assigned',
        },
        signal,
      );
      if (!result.interval) failed++;
      else {
        valid++;
        if (result.interval.lower > 0 || result.interval.upper < 0) detected++;
      }
    }
    return {
      id: s.id,
      assumptions: s,
      simulations: input.simulations,
      detected,
      valid,
      failed,
      detectionRateAmongValid: valid ? detected / valid : null,
      detectionRateAmongAll: detected / input.simulations,
    };
  });
  return {
    results,
    seed: input.seed,
    source: 'synthetic-simulation',
    meaning: 'detection-rate-under-declared-distribution-not-guarantee',
    verdict: results.some((r) => r.failed) ? 'inconclusive' : 'passed',
  };
}

/** 多批次质量、固定分母及精确双侧对账的纯计算。 */
import { z } from 'zod';
import {
  dataCompare,
  checkDataSignal,
  dataRows,
  dataId,
  dataError,
  scalarKey,
  stableData,
  exactDecimal,
  decimalAt,
  decimalText,
  type DataRow,
} from '../shared/seventh-data-contracts.ts';

const profileSchema = z
  .object({
    rows: dataRows,
    columns: z.array(dataId).min(1).max(2000),
    buckets: z.record(dataId, z.array(z.number().finite()).max(31)).default({}),
    expectedPartitions: z.array(dataId).max(10000).default([]),
    partitionColumn: dataId.optional(),
    sample: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
export function qualityProfile(raw: unknown, signal?: AbortSignal) {
  const input = profileSchema.parse(raw);
  const rows = input.sample ? input.rows.slice(0, input.sample) : input.rows;
  const profiles = input.columns.map((column) => {
    checkDataSignal(signal);
    const values = rows.map((row) => row[column] ?? null),
      present = values.filter((v) => v !== null);
    const categories = new Map<string, number>();
    for (const v of present) {
      const key = stableData(v);
      categories.set(key, (categories.get(key) ?? 0) + 1);
    }
    const edges = input.buckets[column];
    let buckets: { lower: number | null; upper: number | null; count: number }[] | null = null;
    if (edges) {
      if (edges.some((v, i) => i > 0 && v <= edges[i - 1]))
        dataError('QUALITY_BUCKET_ORDER', '桶边界须严格递增');
      buckets = Array.from({ length: edges.length + 1 }, (_, i) => ({
        lower: i ? edges[i - 1] : null,
        upper: i < edges.length ? edges[i] : null,
        count: 0,
      }));
      for (const v of present) {
        if (typeof v !== 'number') dataError('QUALITY_BUCKET_TYPE', '数值分桶遇到非数值：' + column);
        let at = 0;
        while (at < edges.length && v >= edges[at]) at++;
        buckets[at].count++;
      }
    }
    return {
      column,
      total: rows.length,
      missing: values.length - present.length,
      missingRate: rows.length ? (values.length - present.length) / rows.length : null,
      distinct: categories.size,
      categories: [...categories]
        .sort(([a], [b]) => dataCompare(a, b))
        .slice(0, 1000)
        .map(([value, count]) => ({ value, count })),
      categoriesTruncated: categories.size > 1000,
      buckets,
    };
  });
  const observedPartitions = input.partitionColumn
    ? [...new Set(rows.map((row) => String(row[input.partitionColumn!] ?? '')))].sort()
    : [];
  const missingPartitions = input.expectedPartitions.filter((p) => !observedPartitions.includes(p));
  return {
    rowCount: rows.length,
    inputRowCount: input.rows.length,
    coverage: input.sample && rows.length < input.rows.length ? 'sample' : 'full',
    profiles,
    observedPartitions,
    missingPartitions,
    verdict: missingPartitions.length ? 'failed' : 'passed',
  };
}
const reconcileSchema = z
  .object({
    left: dataRows,
    right: dataRows,
    keys: z.array(dataId).min(1).max(16),
    decimalColumns: z.array(dataId).max(64).default([]),
    mode: z.enum(['one-to-one', 'aggregate']).default('one-to-one'),
    maxDetails: z.number().int().min(1).max(10000).default(1000),
  })
  .strict();
export function qualityReconcile(raw: unknown, signal?: AbortSignal) {
  const input = reconcileSchema.parse(raw);
  function group(rows: DataRow[]) {
    const groups = new Map<string, DataRow[]>();
    for (const row of rows) {
      checkDataSignal(signal);
      for (const key of input.keys) if (!(key in row)) dataError('QUALITY_KEY_MISSING', '缺少业务键：' + key);
      const key = scalarKey(row, input.keys),
        existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }
    return groups;
  }
  const left = group(input.left),
    right = group(input.right);
  const duplicates = [...left]
    .filter(([, rows]) => rows.length > 1)
    .map(([key]) => ({ side: 'left', key }))
    .concat([...right].filter(([, rows]) => rows.length > 1).map(([key]) => ({ side: 'right', key })));
  if (input.mode === 'one-to-one' && duplicates.length)
    dataError(
      'QUALITY_DUPLICATE_KEY',
      '一对一对账出现重复键：' +
        duplicates
          .slice(0, 5)
          .map((v) => v.side + ':' + v.key)
          .join('；'),
    );
  let differenceCount = 0,
    matched = 0,
    leftOnly = 0,
    rightOnly = 0;
  const differences: unknown[] = [];
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    checkDataSignal(signal);
    const l = left.get(key),
      r = right.get(key);
    let item: unknown;
    if (!l) {
      rightOnly++;
      item = { key, kind: 'right-only', rightCount: r!.length };
    } else if (!r) {
      leftOnly++;
      item = { key, kind: 'left-only', leftCount: l.length };
    } else {
      matched++;
      const decimals = input.decimalColumns.map((column) => {
        const values = [...l, ...r].map((row) => exactDecimal(row[column]));
        const scale = values.reduce((max, value) => Math.max(max, value.scale), 0);
        const lv = values.slice(0, l.length).reduce((sum, v) => sum + decimalAt(v, scale), 0n);
        const rv = values.slice(l.length).reduce((sum, v) => sum + decimalAt(v, scale), 0n);
        return {
          column,
          left: decimalText(lv, scale),
          right: decimalText(rv, scale),
          difference: decimalText(rv - lv, scale),
          equal: lv === rv,
        };
      });
      const different =
        input.mode === 'one-to-one'
          ? stableData(
              Object.fromEntries(Object.entries(l[0]).filter(([c]) => !input.decimalColumns.includes(c))),
            ) !==
            stableData(
              Object.fromEntries(Object.entries(r[0]).filter(([c]) => !input.decimalColumns.includes(c))),
            )
          : l.length !== r.length;
      if (different || decimals.some((v) => !v.equal))
        item = {
          key,
          kind: 'changed',
          leftCount: l.length,
          rightCount: r.length,
          decimals,
          nonDecimalDifference: different,
        };
    }
    if (item) {
      differenceCount++;
      if (differences.length < input.maxDetails) differences.push(item);
    }
  }
  return {
    verdict: differenceCount ? 'failed' : 'passed',
    matched,
    leftOnly,
    rightOnly,
    differenceCount,
    details: differences,
    detailsTruncated: differenceCount > differences.length,
    duplicates,
    direction: 'right-minus-left',
    coverage: 'full',
  };
}
const ruleSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('row-count-ratio'),
      minimum: z.number().nonnegative(),
      maximum: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({ kind: z.literal('missing-rate-change'), column: dataId, maximum: z.number().min(0).max(1) })
    .strict(),
  z.object({ kind: z.literal('category-l1'), column: dataId, maximum: z.number().min(0).max(2) }).strict(),
  z.object({ kind: z.literal('bucket-l1'), column: dataId, maximum: z.number().min(0).max(2) }).strict(),
]);
const checkSchema = z
  .object({
    currentId: dataId,
    current: profileSchema,
    baseline: z
      .array(z.object({ id: dataId, profile: profileSchema }).strict())
      .min(1)
      .max(32),
    rules: z.array(ruleSchema).max(200),
  })
  .strict();
export function qualityCheck(raw: unknown, signal?: AbortSignal) {
  const input = checkSchema.parse(raw);
  if (input.baseline.some((b) => b.id === input.currentId))
    dataError('QUALITY_BASELINE_SELF', '待检批次不能进入冻结基线');
  const current = qualityProfile(input.current, signal),
    historical = input.baseline.map((b) => ({ id: b.id, profile: qualityProfile(b.profile, signal) }));
  const currentColumns = new Set(current.profiles.map((p) => p.column));
  const results = input.rules.map((rule) => {
    checkDataSignal(signal);
    let observed: number | null = null;
    let reason: string | null = null;
    if (current.coverage !== 'full' || historical.some((v) => v.profile.coverage !== 'full'))
      reason = '样本不能作为全量质量结论';
    else if (rule.kind === 'row-count-ratio') {
      const base = historical.reduce((sum, v) => sum + v.profile.rowCount, 0) / historical.length;
      observed = base ? current.rowCount / base : null;
      if (!base) reason = '基线分母为 0';
    } else {
      const column = current.profiles.find((p) => p.column === rule.column),
        bases = historical.map((v) => v.profile.profiles.find((p) => p.column === rule.column));
      if (!currentColumns.has(rule.column) || bases.some((v) => !v)) reason = '比较列缺失';
      else if (column!.total === 0 || bases.some((v) => !v!.total)) reason = '比较分母为 0';
      else if (rule.kind === 'missing-rate-change')
        observed = Math.abs(
          column!.missingRate! - bases.reduce((sum, p) => sum + p!.missingRate!, 0) / bases.length,
        );
      else if (rule.kind === 'bucket-l1') {
        if (
          !column!.buckets ||
          bases.some((p) => !p!.buckets) ||
          bases.some(
            (p) =>
              stableData(p!.buckets!.map((b) => [b.lower, b.upper])) !==
              stableData(column!.buckets!.map((b) => [b.lower, b.upper])),
          )
        )
          reason = '固定桶不相容或未声明';
        else
          observed = column!.buckets.reduce(
            (sum, bucket, i) =>
              sum +
              Math.abs(
                bucket.count / column!.total -
                  bases.reduce((s, p) => s + p!.buckets![i].count / p!.total, 0) / bases.length,
              ),
            0,
          );
      } else if (column!.categoriesTruncated || bases.some((p) => p!.categoriesTruncated))
        reason = '类别明细超限，无法完整比较';
      else {
        const keys = new Set([
          ...column!.categories.map((c) => c.value),
          ...bases.flatMap((p) => p!.categories.map((c) => c.value)),
        ]);
        observed = [...keys].reduce(
          (sum, key) =>
            sum +
            Math.abs(
              (column!.categories.find((c) => c.value === key)?.count ?? 0) / column!.total -
                bases.reduce(
                  (s, p) => s + (p!.categories.find((c) => c.value === key)?.count ?? 0) / p!.total,
                  0,
                ) /
                  bases.length,
            ),
          0,
        );
      }
    }
    const pass =
      observed !== null &&
      (rule.kind === 'row-count-ratio'
        ? observed >= rule.minimum && observed <= rule.maximum
        : observed <= rule.maximum);
    return { rule, observed, verdict: reason ? 'inconclusive' : pass ? 'passed' : 'failed', reason };
  });
  return {
    current,
    baselineIds: historical.map((v) => v.id),
    results,
    verdict:
      current.missingPartitions.length || results.some((v) => v.verdict === 'failed')
        ? 'failed'
        : !results.length || results.some((v) => v.verdict === 'inconclusive')
          ? 'inconclusive'
          : 'passed',
  };
}
export function validateQualityRules(raw: unknown) {
  const input = z
    .object({ rules: z.array(ruleSchema).max(200) })
    .strict()
    .parse(raw);
  for (const rule of input.rules)
    if (rule.kind === 'row-count-ratio' && rule.minimum > rule.maximum)
      dataError('QUALITY_RULE_RANGE', '行数比例下限大于上限');
  return {
    rules: input.rules,
    valid: true,
    ruleLanguage: 'sakura-batch-quality/1',
    coverage: input.rules.length ? 'declared-rules' : 'no-rules',
  };
}
export function calculateQualityBaseline(raw: unknown, signal?: AbortSignal) {
  const input = z
    .object({
      currentId: dataId,
      batches: z
        .array(z.object({ id: dataId, profile: profileSchema }).strict())
        .min(1)
        .max(32),
      excluded: z
        .array(z.object({ id: dataId, reason: z.string().min(1).max(1024) }).strict())
        .max(1000)
        .default([]),
    })
    .strict()
    .parse(raw);
  if (input.batches.some((b) => b.id === input.currentId))
    dataError('QUALITY_BASELINE_SELF', '待检批次不能进入冻结基线');
  const ids = input.batches.map((b) => b.id);
  if (new Set(ids).size !== ids.length) dataError('QUALITY_BASELINE_DUPLICATE', '基线批次重复');
  if (input.excluded.some((b) => ids.includes(b.id)))
    dataError('QUALITY_BASELINE_EXCLUDED', '排除批次不能同时进入基线');
  const batches = input.batches.map((b) => ({ id: b.id, profile: qualityProfile(b.profile, signal) }));
  if (batches.some((b) => b.profile.coverage !== 'full'))
    dataError('QUALITY_BASELINE_SAMPLE', '样本画像不能封存为全量质量基线');
  return {
    batches,
    meanRowCount: batches.reduce((s, b) => s + b.profile.rowCount, 0) / batches.length,
    excluded: input.excluded,
    frozenCurrentId: input.currentId,
    verdict: 'passed',
  };
}

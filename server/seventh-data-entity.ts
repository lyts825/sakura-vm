/** 有限规则的实体候选、传递冲突、人工取值及来源可逆映射。 */
import { z } from 'zod';
import {
  dataCompare,
  dataId,
  dataRow,
  dataError,
  stableData,
  checkDataSignal,
  uniqueDataIds,
  exactDecimal,
  decimalAt,
  decimalText,
  type DataRow,
} from '../shared/seventh-data-contracts.ts';

const recordSchema = z
  .object({ id: dataId, source: dataId, values: dataRow, businessTime: z.string().datetime().optional() })
  .strict();
const recordsSchema = z.array(recordSchema).max(100000);
const normalRule = z
  .object({
    field: dataId,
    operations: z
      .array(z.enum(['trim', 'collapse-whitespace', 'lowercase', 'uppercase', 'nfkc']))
      .max(8)
      .default([]),
    dictionary: z.record(z.string().max(1024), z.string().max(1024)).optional(),
  })
  .strict();
export function normalizeEntities(raw: unknown) {
  const input = z
    .object({ records: recordsSchema, rules: z.array(normalRule).max(200) })
    .strict()
    .parse(raw);
  uniqueDataIds(input.records.map((r) => r.id));
  uniqueDataIds(
    input.rules.map((r) => r.field),
    '标准化字段',
  );
  return {
    records: input.records.map((row) => {
      const values: DataRow = { ...row.values },
        changes: { field: string; original: unknown; normalized: string }[] = [];
      for (const rule of input.rules) {
        const original = values[rule.field];
        if (original === null || original === undefined) continue;
        if (typeof original !== 'string') {
          if (rule.operations.length || rule.dictionary)
            dataError('ENTITY_NORMALIZE_TYPE', '字符串规则遇到非字符串：' + rule.field);
          continue;
        }
        let value = original;
        for (const operation of rule.operations) {
          if (operation === 'trim') value = value.trim();
          else if (operation === 'collapse-whitespace') value = value.replace(/\s+/gu, ' ');
          else if (operation === 'lowercase') value = value.toLowerCase();
          else if (operation === 'uppercase') value = value.toUpperCase();
          else value = value.normalize('NFKC');
        }
        if (rule.dictionary && Object.hasOwn(rule.dictionary, value)) value = rule.dictionary[value];
        values[rule.field] = value;
        if (original !== value) changes.push({ field: rule.field, original, normalized: value });
      }
      return { ...row, values, changes };
    }),
    ruleVersion: 'unicode-normalization-v1',
    originalsPreserved: true,
  };
}
const comparator = z
  .object({
    field: dataId,
    kind: z.enum(['exact', 'edit-distance', 'numeric-tolerance']),
    weight: z.number().positive().max(1000).default(1),
    tolerance: z.string().max(132).optional(),
    missing: z.enum(['zero', 'exclude', 'reject']).default('zero'),
  })
  .strict();
const candidateInput = z
  .object({
    records: recordsSchema,
    blockFields: z.array(dataId).max(16),
    comparators: z.array(comparator).min(1).max(64),
    crossSourceOnly: z.boolean().default(true),
    threshold: z.number().min(0).max(1).default(0.8),
    maxPairs: z.number().int().min(1).max(100000).default(100000),
  })
  .strict();
function editScore(a: string, b: string) {
  const left = Array.from(a),
    right = Array.from(b);
  if (left.length > 512 || right.length > 512) dataError('ENTITY_EDIT_LIMIT', '编辑距离输入最多 512 个字符');
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const row = [i];
    for (let j = 1; j <= right.length; j++)
      row.push(
        Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)),
      );
    previous = row;
  }
  return Math.max(left.length, right.length)
    ? 1 - previous[right.length] / Math.max(left.length, right.length)
    : 1;
}
function compareEntityValue(a: unknown, b: unknown, rule: z.infer<typeof comparator>) {
  if (a === null || a === undefined || b === null || b === undefined) {
    if (rule.missing === 'reject') dataError('ENTITY_MISSING_FIELD', '比较字段缺失：' + rule.field);
    return { score: rule.missing === 'exclude' ? null : 0, reason: 'missing' };
  }
  if (rule.kind === 'exact') return { score: stableData(a) === stableData(b) ? 1 : 0, reason: 'exact' };
  if (rule.kind === 'edit-distance') {
    if (typeof a !== 'string' || typeof b !== 'string')
      dataError('ENTITY_COMPARE_TYPE', '编辑距离须比较字符串');
    return { score: editScore(a, b), reason: 'normalized-levenshtein' };
  }
  if (!rule.tolerance) dataError('ENTITY_TOLERANCE', '数值比较须指定精确容差');
  const l = exactDecimal(a),
    r = exactDecimal(b),
    t = exactDecimal(rule.tolerance);
  if (t.units < 0n) dataError('ENTITY_TOLERANCE', '容差须非负');
  const scale = Math.max(l.scale, r.scale, t.scale),
    delta = decimalAt(l, scale) - decimalAt(r, scale),
    absolute = delta < 0n ? -delta : delta;
  return {
    score: absolute <= decimalAt(t, scale) ? 1 : 0,
    reason: 'within-exact-tolerance',
    difference: decimalText(absolute, scale),
  };
}
export function computeEntityCandidates(raw: unknown, signal?: AbortSignal, estimateOnly = false) {
  const input = candidateInput.parse(raw);
  uniqueDataIds(input.records.map((r) => r.id));
  uniqueDataIds(
    input.comparators.map((r) => r.field),
    '比较字段',
  );
  const blocks = new Map<string, typeof input.records>();
  for (const row of input.records) {
    if (input.blockFields.some((f) => row.values[f] === undefined || row.values[f] === null))
      dataError('ENTITY_BLOCK_MISSING', '候选分组键缺失：' + row.id);
    const key = stableData(input.blockFields.map((f) => row.values[f])),
      existing = blocks.get(key);
    if (existing) existing.push(row);
    else blocks.set(key, [row]);
  }
  let pairCount = 0;
  for (const block of blocks.values()) {
    if (input.crossSourceOnly) {
      const counts = new Map<string, number>();
      for (const row of block) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
      pairCount += (block.length ** 2 - [...counts.values()].reduce((sum, n) => sum + n ** 2, 0)) / 2;
    } else pairCount += (block.length * (block.length - 1)) / 2;
  }
  if (pairCount > input.maxPairs) dataError('ENTITY_CANDIDATE_LIMIT', '候选对超过计划上限：' + pairCount);
  if (estimateOnly)
    return {
      pairCount,
      blocks: blocks.size,
      maxBlock: Math.max(0, ...[...blocks.values()].map((b) => b.length)),
      coverage: input.blockFields.length ? 'declared-blocks-only' : 'all-pairs',
    };
  const candidates: {
    left: string;
    right: string;
    score: number | null;
    selected: boolean;
    fields: unknown[];
  }[] = [];
  for (const block of blocks.values())
    for (let i = 0; i < block.length; i++)
      for (let j = i + 1; j < block.length; j++) {
        checkDataSignal(signal);
        const left = block[i],
          right = block[j];
        if (input.crossSourceOnly && left.source === right.source) continue;
        let numerator = 0,
          denominator = 0;
        const fields = input.comparators.map((rule) => {
          const result = compareEntityValue(left.values[rule.field], right.values[rule.field], rule);
          if (result.score !== null) {
            numerator += result.score * rule.weight;
            denominator += rule.weight;
          }
          return { field: rule.field, weight: rule.weight, ...result };
        });
        const score = denominator ? numerator / denominator : null;
        candidates.push({
          left: left.id < right.id ? left.id : right.id,
          right: left.id < right.id ? right.id : left.id,
          score,
          selected: score !== null && score >= input.threshold,
          fields,
        });
      }
  candidates.sort((a, b) => dataCompare(a.left, b.left) || dataCompare(a.right, b.right));
  return {
    candidates,
    pairCount,
    blockCount: blocks.size,
    threshold: input.threshold,
    scoreMeaning: 'comparator-score-not-probability',
    coverage: input.blockFields.length ? 'declared-blocks-only' : 'all-pairs',
    totalPossiblePairs: (input.records.length * (input.records.length - 1)) / 2,
  };
}
const pair = z.tuple([dataId, dataId]);
const clusterInput = z
  .object({
    recordIds: z.array(dataId).max(100000),
    acceptedPairs: z.array(pair).max(100000),
    mustLink: z.array(pair).max(100000).default([]),
    cannotLink: z.array(pair).max(100000).default([]),
    mutuallyExclusiveSources: z.array(dataId).max(1000).default([]),
    sources: z.record(dataId, dataId).default({}),
  })
  .strict();
export function clusterEntities(raw: unknown, signal?: AbortSignal) {
  const input = clusterInput.parse(raw);
  uniqueDataIds(input.recordIds);
  const parent = new Map(input.recordIds.map((id) => [id, id]));
  const root = (id: string): string => {
    if (!parent.has(id)) dataError('ENTITY_RECORD_MISSING', '约束引用记录不存在：' + id);
    let current = id;
    while (parent.get(current)! !== current) current = parent.get(current)!;
    let cursor = id;
    while (parent.get(cursor)! !== cursor) {
      const next = parent.get(cursor)!;
      parent.set(cursor, current);
      cursor = next;
    }
    return current;
  };
  for (const [a, b] of [...input.acceptedPairs, ...input.mustLink]) {
    checkDataSignal(signal);
    const l = root(a),
      r = root(b);
    if (l !== r) parent.set(l < r ? r : l, l < r ? l : r);
  }
  const groups = new Map<string, string[]>();
  for (const id of input.recordIds) {
    const key = root(id),
      existing = groups.get(key);
    if (existing) existing.push(id);
    else groups.set(key, [id]);
  }
  const conflicts: { kind: string; members: string[] }[] = [];
  for (const [a, b] of input.cannotLink)
    if (root(a) === root(b)) conflicts.push({ kind: 'cannot-link-through-transitivity', members: [a, b] });
  for (const members of groups.values())
    for (const source of input.mutuallyExclusiveSources) {
      const matching = members.filter((id) => input.sources[id] === source);
      if (matching.length > 1) conflicts.push({ kind: 'exclusive-source', members: matching });
    }
  return {
    clusters: [...groups.values()].map((members) => members.sort()).sort((a, b) => dataCompare(a[0], b[0])),
    conflicts,
    sealable: !conflicts.length,
    verdict: conflicts.length ? 'failed' : 'passed',
    interpretation: 'proposal-requires-cluster-decision',
  };
}
export function evaluateEntities(raw: unknown) {
  const input = z
    .object({
      labels: z.array(z.object({ left: dataId, right: dataId, same: z.boolean() }).strict()).max(100000),
      predictions: z
        .array(z.object({ left: dataId, right: dataId, selected: z.boolean() }).strict())
        .max(100000),
      labelScope: z.string().min(1).max(1024),
    })
    .strict()
    .parse(raw);
  const key = (a: string, b: string) => stableData(a < b ? [a, b] : [b, a]);
  uniqueDataIds(
    input.labels.map((p) => key(p.left, p.right)),
    '标注对',
  );
  uniqueDataIds(
    input.predictions.map((p) => key(p.left, p.right)),
    '预测对',
  );
  const predictions = new Map(input.predictions.map((p) => [key(p.left, p.right), p.selected]));
  let tp = 0,
    fp = 0,
    fn = 0,
    tn = 0,
    missingCandidates = 0;
  for (const label of input.labels) {
    const k = key(label.left, label.right);
    if (!predictions.has(k)) missingCandidates++;
    const selected = predictions.get(k) ?? false;
    if (label.same) {
      if (selected) tp++;
      else fn++;
    } else if (selected) fp++;
    else tn++;
  }
  return {
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    trueNegative: tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    missingCandidates,
    scope: input.labelScope,
    populationRecallClaim: false,
    interpretation: 'metrics-on-fixed-labelled-pairs-only',
  };
}

export function validateEntityComparators(raw: unknown) {
  const input = z.object({ comparators: z.array(comparator).min(1).max(64), samples: z.array(z.object({ left: dataRow, right: dataRow }).strict()).max(1000).default([]) }).strict().parse(raw);
  uniqueDataIds(input.comparators.map(rule => rule.field), '比较字段');
  for (const rule of input.comparators) {
    if (rule.kind === 'numeric-tolerance') { if (rule.tolerance === undefined || exactDecimal(rule.tolerance).units < 0n) dataError('ENTITY_TOLERANCE', '数值比较须声明非负精确十进制容差'); }
    else if (rule.tolerance !== undefined) dataError('ENTITY_TOLERANCE_UNUSED', '非数值比较器不能声明未使用的容差');
  }
  return { comparators: input.comparators, samples: input.samples.map(sample => {
    let numerator = 0, denominator = 0;
    const fields = input.comparators.map(rule => { const result = compareEntityValue(sample.left[rule.field], sample.right[rule.field], rule); if (result.score !== null) { numerator += result.score * rule.weight; denominator += rule.weight; } return { field: rule.field, weight: rule.weight, ...result }; });
    return { fields, score: denominator ? numerator / denominator : null, effectiveWeight: denominator };
  }), scoreMeaning: 'comparator-score-not-probability', verdict: 'passed' };
}

export function explainEntityClusters(raw: unknown, signal?: AbortSignal) {
  const { explainPairs, ...input } = clusterInput.extend({ explainPairs: z.array(pair).max(1000) }).strict().parse(raw);
  const result = clusterEntities(input, signal), ids = new Set(input.recordIds);
  const adjacency = new Map(input.recordIds.map(id => [id, [] as { to: string; kind: 'accepted' | 'must-link' }[]]));
  for (const [edges, kind] of [[input.acceptedPairs, 'accepted'], [input.mustLink, 'must-link']] as const)
    for (const [left, right] of edges) { adjacency.get(left)!.push({ to: right, kind }); adjacency.get(right)!.push({ to: left, kind }); }
  let visitedEdges = 0;
  const explanations = explainPairs.map(([left, right]) => {
    if (!ids.has(left) || !ids.has(right)) dataError('ENTITY_RECORD_MISSING', '解释引用记录不存在');
    const previous = new Map<string, { from: string; kind: string }>(), found = new Set([left]), queue = [left];
    for (let at = 0; at < queue.length && !found.has(right); at++) for (const edge of adjacency.get(queue[at])!) {
      checkDataSignal(signal); if (++visitedEdges > 2000000) dataError('ENTITY_EXPLANATION_LIMIT', '连通性解释超过 200 万条边访问');
      if (!found.has(edge.to)) { found.add(edge.to); previous.set(edge.to, { from: queue[at], kind: edge.kind }); queue.push(edge.to); }
    }
    const path: { left: string; right: string; kind: string }[] = [];
    if (found.has(right)) for (let cursor = right; cursor !== left;) { const edge = previous.get(cursor)!; path.push({ left: edge.from, right: cursor, kind: edge.kind }); cursor = edge.from; }
    return { left, right, connected: found.has(right), path: path.reverse(), interpretation: found.has(right) ? 'connectivity-is-not-entity-identity' : 'no-path-in-declared-proposal' };
  });
  return { ...result, explanations, traversal: 'undirected-breadth-first-declared-edges' };
}

export function splitEntityClusters(raw: unknown, signal?: AbortSignal) {
  const { partition, reason, ...input } = clusterInput.extend({ partition: z.array(z.array(dataId).min(1).max(100000)).min(1).max(100000), reason: z.string().trim().min(1).max(2048) }).strict().parse(raw);
  const original = clusterEntities(input, signal), flattened = partition.flat(); uniqueDataIds(flattened, '拆分成员');
  const expected = new Set(input.recordIds); if (flattened.length !== expected.size || flattened.some(id => !expected.has(id))) dataError('ENTITY_SPLIT_COVERAGE', '拆分须恰好覆盖全部原记录且不能添加记录');
  const group = new Map(partition.flatMap((members, index) => members.map(id => [id, index] as const)));
  const originalGroup = new Map(original.clusters.flatMap((members, index) => members.map(id => [id, index] as const)));
  for (const members of partition) if (members.some(id => originalGroup.get(id) !== originalGroup.get(members[0]))) dataError('ENTITY_SPLIT_MERGE', '拆分不能合并原本不连通的簇');
  if (input.mustLink.some(([a, b]) => group.get(a) !== group.get(b))) dataError('ENTITY_SPLIT_MUST_LINK', '拆分不能切断固定必须同组约束');
  const removedPairs = input.acceptedPairs.filter(([a, b]) => group.get(a) !== group.get(b));
  const retainedPairs = input.acceptedPairs.filter(([a, b]) => group.get(a) === group.get(b));
  const result = clusterEntities({ ...input, acceptedPairs: retainedPairs }, signal);
  if (result.clusters.length !== partition.length || result.clusters.some(members => members.length !== partition[group.get(members[0])!].length)) dataError('ENTITY_SPLIT_DISCONNECTED', '请求分组本身不连通；请明确拆成实际连通分量');
  return { ...result, originalClusters: original.clusters, removedPairs, retainedPairs, reason, humanDecisionRecorded: false, interpretation: 'split-proposal-requires-fixed-cluster-decision' };
}

export function compareEntityEvaluations(raw: unknown) {
  const label = z.object({ left: dataId, right: dataId, same: z.boolean() }).strict(), prediction = z.object({ left: dataId, right: dataId, selected: z.boolean() }).strict();
  const input = z.object({ labels: z.array(label).min(1).max(100000), left: z.array(prediction).max(100000), right: z.array(prediction).max(100000), labelScope: z.string().min(1).max(1024) }).strict().parse(raw);
  if (input.labels.some(row => row.left === row.right) || [...input.left, ...input.right].some(row => row.left === row.right)) dataError('ENTITY_EVALUATION_SELF_PAIR', '标注和预测必须比较两个不同记录');
  const left = evaluateEntities({ labels: input.labels, predictions: input.left, labelScope: input.labelScope }), right = evaluateEntities({ labels: input.labels, predictions: input.right, labelScope: input.labelScope });
  const delta = Object.fromEntries((['truePositive', 'falsePositive', 'falseNegative', 'trueNegative', 'precision', 'recall', 'missingCandidates'] as const).map(key => [key, left[key] === null || right[key] === null ? null : right[key]! - left[key]!]));
  const key = (a: string, b: string) => stableData(a < b ? [a, b] : [b, a]), l = new Map(input.left.map(row => [key(row.left, row.right), row.selected])), r = new Map(input.right.map(row => [key(row.left, row.right), row.selected]));
  return { left, right, delta, changedLabelledPairs: input.labels.filter(row => (l.get(key(row.left, row.right)) ?? false) !== (r.get(key(row.left, row.right)) ?? false)), direction: 'right-minus-left', fixedLabelScope: input.labelScope, statisticalSignificanceClaim: false, populationRecallClaim: false };
}
export function resolveEntitySurvivors(raw: unknown) {
  const input = z
    .object({
      records: recordsSchema,
      clusters: z
        .array(
          z
            .object({ id: dataId, members: z.array(dataId).min(1).max(100000), accepted: z.boolean() })
            .strict(),
        )
        .max(100000),
      fields: z.array(dataId).max(2000),
      strategy: z.enum(['source-priority', 'latest-business-time', 'explicit']),
      sourcePriority: z.array(dataId).max(1000).default([]),
      explicit: z.record(dataId, z.record(dataId, dataId)).default({}),
    })
    .strict()
    .parse(raw);
  uniqueDataIds(input.records.map((r) => r.id));
  uniqueDataIds(
    input.clusters.map((c) => c.id),
    '簇',
  );
  uniqueDataIds(
    input.clusters.flatMap((c) => c.members),
    '簇成员',
  );
  const byId = new Map(input.records.map((r) => [r.id, r])),
    conflicts: { cluster: string; field: string; records: string[]; reason: string }[] = [];
  const entities = input.clusters.map((cluster) => {
    if (!cluster.accepted) dataError('ENTITY_DECISION_REQUIRED', '规范实体须有完整簇接受决定：' + cluster.id);
    const rows = cluster.members.map((id) => {
        const row = byId.get(id);
        if (!row) dataError('ENTITY_RECORD_MISSING', '簇成员不存在：' + id);
        return row;
      }),
      values: DataRow = {},
      provenance: Record<string, string> = {};
    for (const field of input.fields) {
      let candidates = rows.filter((row) => row.values[field] !== null && row.values[field] !== undefined);
      if (!candidates.length) {
        values[field] = null;
        continue;
      }
      const explicitId = input.explicit[cluster.id]?.[field];
      if (explicitId) {
        const selected = candidates.find((r) => r.id === explicitId);
        if (!selected) dataError('ENTITY_SELECTION_INVALID', '人工字段选择不属于此簇或无有效值');
        candidates = [selected];
      } else if (input.strategy === 'explicit') {
        conflicts.push({
          cluster: cluster.id,
          field,
          records: candidates.map((r) => r.id),
          reason: 'explicit-selection-required',
        });
        continue;
      } else if (input.strategy === 'source-priority') {
        if (candidates.some((r) => !input.sourcePriority.includes(r.source))) {
          conflicts.push({
            cluster: cluster.id,
            field,
            records: candidates.map((r) => r.id),
            reason: 'source-priority-missing',
          });
          continue;
        }
        const rank = candidates.reduce(
          (min, r) => Math.min(min, input.sourcePriority.indexOf(r.source)),
          Infinity,
        );
        candidates = candidates.filter((r) => input.sourcePriority.indexOf(r.source) === rank);
      } else {
        if (candidates.some((r) => !r.businessTime)) {
          conflicts.push({
            cluster: cluster.id,
            field,
            records: candidates.map((r) => r.id),
            reason: 'business-time-missing',
          });
          continue;
        }
        const newest = candidates
          .map((r) => r.businessTime!)
          .sort()
          .at(-1)!;
        candidates = candidates.filter((r) => r.businessTime === newest);
      }
      if (new Set(candidates.map((r) => stableData(r.values[field]))).size > 1) {
        conflicts.push({
          cluster: cluster.id,
          field,
          records: candidates.map((r) => r.id),
          reason: 'equal-priority-value-conflict',
        });
        continue;
      }
      const selected = [...candidates].sort((a, b) => dataCompare(a.id, b.id))[0];
      values[field] = selected.values[field];
      provenance[field] = selected.id;
    }
    return { id: cluster.id, values, provenance, sourceRecords: cluster.members };
  });
  const assigned = new Set(input.clusters.flatMap((c) => c.members));
  return {
    entities,
    conflicts,
    mappings: entities.flatMap((e) => e.sourceRecords.map((sourceId) => ({ sourceId, entityId: e.id }))),
    sealable: !conflicts.length,
    verdict: conflicts.length ? 'inconclusive' : 'passed',
    unassignedRecords: input.records.filter((r) => !assigned.has(r.id)).map((r) => r.id),
  };
}

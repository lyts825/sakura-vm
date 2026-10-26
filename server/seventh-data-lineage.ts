/** 资产身份、来源声明和有限血缘影响；上传声明不升级为原执行证据。 */
import { z } from 'zod';
import {
  dataCompare,
  dataId,
  dataError,
  uniqueDataIds,
  stableData,
  checkDataSignal,
} from '../shared/seventh-data-contracts.ts';
import { graphComponents, type FiniteGraph } from './seventh-data-graph.ts';
import { parseTemporal } from './seventh-data-temporal.ts';

const asset = z
  .object({
    id: dataId,
    namespace: dataId,
    externalId: dataId,
    version: dataId,
    name: z.string().max(1024),
    kind: z.enum(['dataset', 'field', 'process', 'report']).default('dataset'),
  })
  .strict();
const assertion = z
  .object({
    id: dataId,
    source: dataId,
    target: dataId,
    relation: z.enum(['copy', 'rename', 'arithmetic', 'aggregate', 'unknown']),
    evidence: z.enum(['observed', 'external', 'manual']),
    claim: z.enum(['exists', 'absent']).default('exists'),
    decision: z.enum(['accepted', 'rejected', 'unreviewed']).default('unreviewed'),
    validFrom: z.string().datetime().nullable().default(null),
    validTo: z.string().datetime().nullable().default(null),
  })
  .strict();
const lineage = z
  .object({ assets: z.array(asset).max(100000), assertions: z.array(assertion).max(500000) })
  .strict();
export function validateLineage(raw: unknown, signal?: AbortSignal) {
  const graph = lineage.parse(raw);
  uniqueDataIds(
    graph.assets.map((a) => a.id),
    '资产',
  );
  uniqueDataIds(
    graph.assertions.map((a) => a.id),
    '声明',
  );
  const ids = new Set(graph.assets.map((a) => a.id));
  const identities = new Set<string>();
  for (const a of graph.assets) {
    const key = stableData([a.namespace, a.externalId, a.version]);
    if (identities.has(key)) dataError('LINEAGE_IDENTITY_COLLISION', '同一资产身份重复：' + key);
    identities.add(key);
  }
  const times = new Map(
    graph.assertions.map((a) => [
      a.id,
      {
        start: a.validFrom ? parseTemporal({ kind: 'iso', value: a.validFrom }).nanos : null,
        end: a.validTo ? parseTemporal({ kind: 'iso', value: a.validTo }).nanos : null,
      },
    ]),
  );
  for (const a of graph.assertions) {
    checkDataSignal(signal);
    if (!ids.has(a.source) || !ids.has(a.target))
      dataError('LINEAGE_ASSET_MISSING', '声明引用缺失资产：' + a.id);
    const interval = times.get(a.id)!;
    if (interval.start !== null && interval.end !== null && interval.start >= interval.end)
      dataError('LINEAGE_INTERVAL', '声明有效区间为空或反向：' + a.id);
  }
  const groups = new Map<string, typeof graph.assertions>();
  for (const a of graph.assertions) {
    const key = stableData([a.source, a.target]),
      existing = groups.get(key);
    if (existing) {
      if (existing.length >= 2000) dataError('LINEAGE_ASSERTION_GROUP_LIMIT', '同一关系的声明超过 2000');
      existing.push(a);
    } else groups.set(key, [a]);
  }
  const overlaps = (a: (typeof graph.assertions)[number], b: (typeof graph.assertions)[number]) => {
    const x = times.get(a.id)!,
      y = times.get(b.id)!;
    return (
      (x.end === null || y.start === null || y.start < x.end) &&
      (y.end === null || x.start === null || x.start < y.end)
    );
  };
  const conflicts: { assertionIds: string[]; reason: string }[] = [];
  let comparisons = 0;
  for (const rows of groups.values())
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        checkDataSignal(signal);
        if (++comparisons > 2000000) dataError('LINEAGE_COMPARISON_LIMIT', '声明冲突比较超过 200 万次');
        if (
          overlaps(rows[i], rows[j]) &&
          (rows[i].claim !== rows[j].claim || rows[i].relation !== rows[j].relation)
        )
          conflicts.push({
            assertionIds: [rows[i].id, rows[j].id],
            reason: 'overlapping-contradictory-claims',
          });
        if (conflicts.length > 10000) dataError('LINEAGE_CONFLICT_LIMIT', '冲突明细超过 10000');
      }
  const selected = graph.assertions.filter((a) => a.decision === 'accepted' && a.claim === 'exists');
  const finite: FiniteGraph = {
    directed: true,
    nodes: graph.assets.map((a) => ({ id: a.id, attributes: {} })),
    edges: selected.map((a) => ({
      id: a.id,
      source: a.source,
      target: a.target,
      type: a.relation,
      weight: 1,
      attributes: {},
    })),
  };
  return {
    ...graph,
    conflicts,
    components: graphComponents(finite, signal),
    evidenceSummary: {
      observed: graph.assertions.filter((a) => a.evidence === 'observed').length,
      external: graph.assertions.filter((a) => a.evidence === 'external').length,
      manual: graph.assertions.filter((a) => a.evidence === 'manual').length,
    },
    verdict: conflicts.length ? 'inconclusive' : 'passed',
  };
}
export function traceLineage(raw: unknown, signal?: AbortSignal) {
  const input = z
      .object({
        graph: lineage,
        changes: z.array(dataId).min(1).max(1000),
        direction: z.enum(['downstream', 'upstream']).default('downstream'),
        at: z.string().datetime().optional(),
        maxDepth: z.number().int().min(1).max(100).default(50),
        maxNodes: z.number().int().min(1).max(100000).default(100000),
      })
      .strict()
      .parse(raw),
    graph = validateLineage(input.graph, signal);
  const ids = new Set(graph.assets.map((a) => a.id));
  for (const id of input.changes)
    if (!ids.has(id)) dataError('LINEAGE_CHANGE_MISSING', '变更资产不存在：' + id);
  const at = input.at ? parseTemporal({ kind: 'iso', value: input.at }).nanos : null;
  const assertions = graph.assertions.filter(
    (a) =>
      a.decision === 'accepted' &&
      a.claim === 'exists' &&
      (at === null ||
        ((!a.validFrom || parseTemporal({ kind: 'iso', value: a.validFrom }).nanos <= at) &&
          (!a.validTo || at < parseTemporal({ kind: 'iso', value: a.validTo }).nanos))),
  );
  const adjacency = new Map<string, typeof assertions>();
  for (const a of assertions) {
    const from = input.direction === 'downstream' ? a.source : a.target,
      existing = adjacency.get(from);
    if (existing) existing.push(a);
    else adjacency.set(from, [a]);
  }
  const visited = new Map<string, { id: string; depth: number; path: string[] }>(
    input.changes.map((id) => [id, { id, depth: 0, path: [] }]),
  );
  const queue = [...visited.values()],
    boundaries: { asset: string; assertion: string | null; reason: string }[] = [];
  for (let index = 0; index < queue.length; index++) {
    checkDataSignal(signal);
    const cur = queue[index];
    for (const a of adjacency.get(cur.id) ?? []) {
      const next = input.direction === 'downstream' ? a.target : a.source;
      if (a.relation === 'unknown') {
        boundaries.push({ asset: cur.id, assertion: a.id, reason: 'unknown-transform' });
        continue;
      }
      if (cur.depth >= input.maxDepth) {
        boundaries.push({ asset: cur.id, assertion: a.id, reason: 'depth-limit' });
        continue;
      }
      if (!visited.has(next)) {
        if (visited.size >= input.maxNodes) {
          boundaries.push({ asset: cur.id, assertion: a.id, reason: 'node-limit' });
          continue;
        }
        const item = { id: next, depth: cur.depth + 1, path: [...cur.path, a.id] };
        visited.set(next, item);
        queue.push(item);
      }
    }
  }
  for (const conflict of graph.conflicts)
    if (
      conflict.assertionIds.some((id) =>
        graph.assertions.some((a) => a.id === id && (visited.has(a.source) || visited.has(a.target))),
      )
    )
      boundaries.push({
        asset: graph.assertions.find((a) => a.id === conflict.assertionIds[0])!.source,
        assertion: conflict.assertionIds[0],
        reason: 'conflicting-evidence',
      });
  return {
    affected: [...visited.values()].sort((a, b) => a.depth - b.depth || dataCompare(a.id, b.id)),
    boundaries,
    components: graph.components,
    coverage: boundaries.length ? 'partial' : 'declared-graph',
    verdict: boundaries.length ? 'inconclusive' : 'passed',
    meaning: 'reachable-in-accepted-declarations; not-causal-proof',
    evidenceSummary: graph.evidenceSummary,
  };
}
export function compareLineage(raw: unknown) {
  const { left: a, right: b } = z.object({ left: lineage, right: lineage }).strict().parse(raw),
    left = validateLineage(a),
    right = validateLineage(b);
  const diff = (l: { id: string }[], r: { id: string }[]) => {
    const left = new Map(l.map((v) => [v.id, v])),
      right = new Set(r.map((v) => v.id));
    return {
      added: r.filter((v) => !left.has(v.id)).map((v) => v.id),
      removed: l.filter((v) => !right.has(v.id)).map((v) => v.id),
      changed: r
        .filter((v) => left.has(v.id) && stableData(left.get(v.id)) !== stableData(v))
        .map((v) => v.id),
    };
  };
  return {
    assets: diff(left.assets, right.assets),
    assertions: diff(left.assertions, right.assertions),
    leftConflicts: left.conflicts,
    rightConflicts: right.conflicts,
  };
}
export function matchLineageIdentity(raw: unknown) {
  const { assets } = z
    .object({ assets: z.array(asset).max(100000) })
    .strict()
    .parse(raw);
  uniqueDataIds(
    assets.map((a) => a.id),
    '资产',
  );
  const groups = new Map<string, typeof assets>();
  const names = new Map<string, string>();
  const sameNameDifferentIdentity: string[] = [];
  for (const a of assets) {
    const key = stableData([a.namespace, a.externalId, a.version]),
      existing = groups.get(key);
    if (existing) existing.push(a);
    else groups.set(key, [a]);
    if (names.has(a.name) && names.get(a.name) !== key) sameNameDifferentIdentity.push(a.id);
    else names.set(a.name, key);
  }
  return {
    sameIdentity: [...groups.values()].filter((g) => g.length > 1).map((g) => g.map((a) => a.id)),
    sameNameDifferentIdentity,
    mergedAutomatically: false,
  };
}

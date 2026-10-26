/** 训练域特征拟合与矩阵生成；fits feature transforms using training members only. */
import {
  type Data,
  cancelled,
  digest,
  graph,
  integer,
  list,
  mean,
  number,
  object,
  reject,
  rows,
  strings,
  text,
  unique,
} from './seventh-creation-common.ts';

function partitions(input: Data) {
  const data = rows(input.rows);
  const idKey = input.idKey ? text(input.idKey) : 'id';
  const ids = data.map((r) => text(r[idKey]));
  unique(ids);
  const known = new Set(ids);
  const parts = object(input.partitions);
  const seen = new Map<string, string>();
  const problems: Data[] = [];
  for (const [name, raw] of Object.entries(parts))
    for (const id of strings(raw)) {
      if (!known.has(id)) reject('FEATURE_PARTITION_MISSING_ROW');
      if (seen.has(id)) problems.push({ code: 'ROW_OVERLAP', id, partitions: [seen.get(id), name] });
      else seen.set(id, name);
    }
  if (input.entityKey) {
    const key = text(input.entityKey);
    const groups = new Map<string, Set<string>>();
    for (const row of data) {
      const p = seen.get(text(row[idKey]));
      if (p) {
        const g = String(row[key]);
        const set = groups.get(g) ?? new Set();
        set.add(p);
        groups.set(g, set);
      }
    }
    for (const [entity, set] of groups)
      if (set.size > 1) problems.push({ code: 'ENTITY_OVERLAP', entity, partitions: [...set] });
  }
  return { data, idKey, parts, seen, problems };
}
function fit(input: Data) {
  const p = partitions(input);
  if (p.problems.length) reject('FEATURE_PARTITION_LEAKAGE');
  const training = new Set(strings(p.parts.train));
  if (!training.size) reject('FEATURE_EMPTY_TRAINING');
  const train = p.data.filter((r) => training.has(text(r[p.idKey])));
  const columns = rows(input.columns, 500);
  unique(columns.map((c) => text(c.name)));
  const parameters = columns.map((column) => {
    const name = text(column.name);
    const kind = text(column.kind);
    const values = train.map((r) => r[name]).filter((v) => v !== null && v !== undefined && v !== '');
    if (kind === 'numeric') {
      const ns = values.map((v) => number(v));
      if (!ns.length && column.fill === undefined) reject('FEATURE_ALL_EMPTY_COLUMN');
      const sorted = [...ns].sort((a, b) => a - b);
      const avg = ns.length ? mean(ns) : number(column.fill);
      const fill =
        column.fill === 'median'
          ? sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : column.fill === 'mean' || column.fill === undefined
            ? avg
            : number(column.fill);
      const clip = column.clip ? list(column.clip, 2).map((v) => number(v)) : null;
      if (clip && (clip.length !== 2 || clip[0] > clip[1])) reject('FEATURE_CLIP');
      const filled = train
        .map((r) => (r[name] === null || r[name] === undefined || r[name] === '' ? fill : number(r[name])))
        .map((v) => (clip ? Math.min(clip[1], Math.max(clip[0], v)) : v));
      const center = mean(filled);
      const variance = mean(filled.map((x) => (x - center) ** 2));
      return {
        name,
        kind,
        fill,
        mean: center,
        scale: column.standardize === true ? Math.sqrt(variance) || 1 : 1,
        standardize: column.standardize === true,
        clip,
      };
    }
    if (kind === 'category') {
      const counts = new Map<string, number>();
      for (const v of values) {
        const s = text(v, 4096);
        counts.set(s, (counts.get(s) ?? 0) + 1);
      }
      if (counts.size > 2000) reject('FEATURE_CATEGORY_LIMIT');
      return {
        name,
        kind,
        encoding: column.encoding === 'frequency' ? 'frequency' : 'onehot',
        unknown: column.unknown === 'error' ? 'error' : 'zero',
        vocabulary: [...counts.keys()].sort(),
        frequencies: Object.fromEntries([...counts].map(([k, n]) => [k, n / train.length])),
      };
    }
    reject('FEATURE_OPERATOR_UNSUPPORTED');
  });
  return {
    schemaVersion: 1,
    trainingIds: [...training].sort(),
    trainingDigest: digest(train),
    parameters,
    digest: digest(parameters),
  };
}
function generate(input: Data) {
  const fitted = input.fit ? object(input.fit) : fit(input);
  const parameters = rows(fitted.parameters, 500);
  const data = rows(input.rows);
  let outputColumns: string[] = [];
  for (const p of parameters) {
    if (p.kind === 'numeric' || p.encoding === 'frequency') outputColumns.push(text(p.name));
    else outputColumns.push(...strings(p.vocabulary, 2000).map((v) => `${text(p.name)}=${v}`));
  }
  if (outputColumns.length > 2000 || data.length * outputColumns.length > 2_000_000)
    reject('FEATURE_MATRIX_LIMIT');
  const unknowns: Data[] = [];
  const matrix = data.map((row, index) => {
    const result: Data = { id: row[input.idKey ? text(input.idKey) : 'id'] ?? String(index) };
    for (const p of parameters) {
      const name = text(p.name);
      const raw = row[name];
      if (p.kind === 'numeric') {
        let value = raw === null || raw === undefined || raw === '' ? number(p.fill) : number(raw);
        if (p.clip) {
          const clip = list(p.clip, 2);
          if (clip.length !== 2) reject('FEATURE_CLIP');
          value = Math.min(number(clip[1]), Math.max(number(clip[0]), value));
        }
        result[name] = p.standardize ? (value - number(p.mean)) / number(p.scale, Number.MIN_VALUE) : value;
      } else {
        const value = raw == null ? '' : String(raw);
        const vocab = strings(p.vocabulary, 2000);
        if (!vocab.includes(value)) {
          unknowns.push({ rowId: result.id, column: name, value });
          if (p.unknown === 'error') reject('FEATURE_UNKNOWN_CATEGORY');
        }
        if (p.encoding === 'frequency') result[name] = object(p.frequencies)[value] ?? 0;
        else for (const category of vocab) result[`${name}=${category}`] = value === category ? 1 : 0;
      }
    }
    return result;
  });
  return {
    fit: fitted,
    columns: outputColumns,
    rows: matrix,
    unknowns,
    outputDigest: digest(matrix),
    coverage: { rows: matrix.length, complete: true },
  };
}
export function computeFeatures(action: string, input: Data, signal?: AbortSignal): unknown {
  cancelled(signal);
  if (action === 'schemas.validate') {
    const columns = rows(input.columns, 500);
    if (!columns.length) reject('FEATURE_COLUMNS_REQUIRED');
    unique(columns.map((c) => text(c.name)));
    for (const column of columns) {
      if (!['numeric', 'category'].includes(text(column.kind))) reject('FEATURE_COLUMN_TYPE');
      if (column.role === 'label' && column.feature !== false) reject('FEATURE_LABEL_SELECTED');
    }
    return { passed: true, columns: columns.length, digest: digest(columns) };
  }
  if (action === 'partitions.checkOverlap') {
    const p = partitions(input);
    return { passed: !p.problems.length, problems: p.problems, assigned: p.seen.size, total: p.data.length };
  }
  if (action === 'transforms.checkGraph') {
    const nodes = rows(input.nodes, 64).map((n) => ({ id: text(n.id), deps: strings(n.deps ?? [], 64) }));
    return { order: graph(nodes), passed: true };
  }
  if (action === 'fits.fit') return fit(input);
  if (action === 'fits.inspect') {
    const fitted = object(input.fit);
    const parameters = rows(fitted.parameters, 500);
    if (fitted.digest !== digest(parameters)) reject('FEATURE_FIT_DIGEST');
    return {
      trainingIds: strings(fitted.trainingIds),
      trainingDigest: text(fitted.trainingDigest),
      parameters,
      digest: fitted.digest,
    };
  }
  if (action === 'runs.start' || action === 'runs.run') return generate(input);
  if (action === 'joins.checkCardinality') {
    const left = rows(input.left),
      right = rows(input.right);
    const key = text(input.key);
    const counts = new Map<string, number>();
    for (const r of right) {
      const k = JSON.stringify(r[key]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const duplicateKeys = [...counts]
      .filter(([, n]) => n > 1)
      .map(([key, count]) => ({ key: JSON.parse(key), count }));
    if (input.cardinality === 'one-to-one') {
      const keys = left.map((r) => JSON.stringify(r[key]));
      if (new Set(keys).size !== keys.length || duplicateKeys.length) reject('FEATURE_JOIN_DUPLICATE_KEY');
    }
    const outputRows = left.reduce(
      (n, r) => n + Math.max(counts.get(JSON.stringify(r[key])) ?? 0, input.join === 'inner' ? 0 : 1),
      0,
    );
    if (outputRows > 100000) reject('FEATURE_JOIN_OUTPUT_LIMIT');
    const lookup = new Map<string, Data[]>();
    for (const r of right) {
      const k = JSON.stringify(r[key]);
      lookup.set(k, [...(lookup.get(k) ?? []), r]);
    }
    const joined = left.flatMap<Data>((r) => {
      const matches = lookup.get(JSON.stringify(r[key])) ?? [];
      return matches.length
        ? matches.map((m) => ({ ...r, right: m }))
        : input.join === 'inner'
          ? []
          : [{ ...r, right: null }];
    });
    return {
      duplicateKeys,
      unmatched: left.filter((r) => !counts.has(JSON.stringify(r[key]))).length,
      inputRows: left.length,
      outputRows,
      rows: joined,
      passed: !duplicateKeys.length || input.cardinality !== 'one-to-one',
    };
  }
  if (action === 'windows.checkAvailability') {
    const events = rows(input.events),
      observations = rows(input.observations);
    const key = input.key ? text(input.key) : 'entity';
    const lookback = number(input.lookbackMs, 0);
    return {
      rows: observations.map((o) => {
        const at = Date.parse(text(o.at));
        if (!Number.isFinite(at)) reject('FEATURE_TIME');
        let excluded = 0;
        const available = events.filter((e) => {
          if (e[key] !== o[key]) return false;
          const eventAt = Date.parse(text(e.at)),
            knownAt = Date.parse(text(e.availableAt));
          if (!Number.isFinite(eventAt) || !Number.isFinite(knownAt)) reject('FEATURE_TIME');
          if (eventAt > at || knownAt > at) {
            excluded++;
            return false;
          }
          return eventAt >= at - lookback;
        });
        return {
          id: text(o.id),
          count: available.length,
          sum: available.reduce((n, e) => n + number(e.value), 0),
          excludedFuture: excluded,
        };
      }),
      coverage: 'declared-event-and-availability-times',
    };
  }
  if (action === 'selections.rank') {
    const data = rows(input.rows);
    const names = strings(input.columns, 500);
    const train = new Set(strings(input.trainingIds));
    const samples = data.filter((r) => train.has(text(r.id)));
    if (!samples.length) reject('FEATURE_EMPTY_TRAINING');
    return {
      ranking: names
        .map((name) => {
          const values = samples.map((r) => number(r[name]));
          const avg = mean(values);
          return { name, variance: mean(values.map((v) => (v - avg) ** 2)) };
        })
        .sort((a, b) => b.variance - a.variance || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
      trainingIds: [...train].sort(),
    };
  }
  if (action === 'checks.evaluate') {
    const p = partitions(input);
    return {
      passed: p.problems.length === 0 && input.upstreamEvidence === true,
      problems: p.problems,
      upstream: input.upstreamEvidence === true ? 'verified' : 'inconclusive',
      scope: 'declared partitions and provenance only',
    };
  }
  reject('CREATION_ACTION_UNSUPPORTED');
}

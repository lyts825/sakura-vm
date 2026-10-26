/** 七个数据包的声明动作与起步材料；未知动作拒绝，计算只使用固定 DTO。 */
import { z } from 'zod';
import {
  dataError,
  inspectDataTable,
  checkDataSignal,
  type SeventhDataTemplate,
} from '../shared/seventh-data-contracts.ts';
import {
  qualityProfile,
  qualityReconcile,
  qualityCheck,
  validateQualityRules,
  calculateQualityBaseline,
} from './seventh-data-quality.ts';
import {
  validateLineage,
  traceLineage,
  compareLineage,
  matchLineageIdentity,
} from './seventh-data-lineage.ts';
import {
  normalizeEntities,
  computeEntityCandidates,
  clusterEntities,
  evaluateEntities,
  resolveEntitySurvivors,
  validateEntityComparators, explainEntityClusters, splitEntityClusters, compareEntityEvaluations,
} from './seventh-data-entity.ts';
import {
  alignTemporal,
  validateTemporalIntervals,
  runTemporalWindows,
  queryBitemporal,
  compareTemporal,
  inspectTemporalCalendar, validateTemporalLatePolicy, explainTemporalComparison,
} from './seventh-data-temporal.ts';
import {
  validateGeospatial,
  transformGeospatial,
  operateGeospatial,
  bufferGeospatial,
  joinGeospatial,
  measureGeospatial,
  indexGeospatial,
} from './seventh-data-geospatial.ts';
import { validateGraph, runGraph, compareGraphs, layoutGraph } from './seventh-data-graph.ts';
import {
  assignExperiment,
  analyzeExperiment,
  validateExperimentObservations,
  simulateExperiment,
  validateExperimentQuestion, validateExperimentOutcomes, validateExperimentAllocation,
} from './seventh-data-experiment.ts';

export const SEVENTH_DATA_ACTIONS: Record<string, string[]> = {
  'data-quality-studio': [
    'sources.inspect',
    'profiles.compute',
    'rules.validate',
    'baselines.calculate',
    'runs.run',
    'reconciliation.compare',
  ],
  'lineage-atlas': [
    'assets.matchIdentity',
    'mappings.validate',
    'assertions.compare',
    'graphs.validate',
    'impacts.trace',
    'reports.compare',
  ],
  'entity-resolution-studio': [
    'sources.inspect',
    'normalization.preview',
    'comparators.validate',
    'blocks.estimate',
    'candidates.compute',
    'constraints.check',
    'clusters.propose',
    'clusters.explain',
    'clusters.split',
    'evaluations.evaluate',
    'evaluations.compare',
    'survivors.preview',
    'survivors.resolve',
    'versions.compose',
    'versions.validate',
  ],
  'temporal-data-studio': [
    'sources.inspect',
    'semantics.validate',
    'calendars.inspect',
    'latepolicy.validate',
    'alignment.preview',
    'intervals.validate',
    'windows.validate',
    'runs.run',
    'comparisons.compare',
    'comparisons.explain',
  ],
  'geospatial-studio': [
    'crs.validate',
    'validation.check',
    'layers.validate',
    'indexes.build',
    'operations.preview',
    'joins.validate',
    'runs.run',
    'measures.calculate',
  ],
  'graph-insight-studio': [
    'sources.inspect',
    'entities.validate',
    'edges.validate',
    'projections.compose',
    'projections.validate',
    'queries.preview',
    'algorithms.validate',
    'runs.run',
    'comparisons.compare',
    'views.layout',
  ],
  'experiment-planner': [
    'questions.validate',
    'outcomes.validate',
    'allocations.validate',
    'assignments.generate',
    'observations.validate',
    'analyses.run',
    'sensitivity.run',
    'powerplans.simulate',
  ],
};

function temporalRun(raw: Record<string, unknown>, signal?: AbortSignal) {
  const { kind, payload } = z
    .object({
      kind: z.enum(['align', 'windows', 'intervals', 'bitemporal']),
      payload: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(raw);
  return kind === 'align'
    ? alignTemporal(payload, signal)
    : kind === 'windows'
      ? runTemporalWindows(payload, signal)
      : kind === 'intervals'
        ? validateTemporalIntervals(payload, signal)
        : queryBitemporal(payload);
}
function geoRun(raw: Record<string, unknown>, signal?: AbortSignal) {
  const { kind, payload } = z
    .object({
      kind: z.enum(['transform', 'operate', 'buffer', 'join', 'measure']),
      payload: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(raw);
  return kind === 'transform'
    ? transformGeospatial(payload, signal)
    : kind === 'operate'
      ? operateGeospatial(payload, signal)
      : kind === 'buffer'
        ? bufferGeospatial(payload, signal)
        : kind === 'join'
          ? joinGeospatial(payload, signal)
          : measureGeospatial(payload, signal);
}
export async function computeSeventhData(
  packId: string,
  action: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  checkDataSignal(signal);
  if (!Object.hasOwn(SEVENTH_DATA_ACTIONS, packId) || !SEVENTH_DATA_ACTIONS[packId].includes(action))
    dataError('SEVENTH_DATA_UNSUPPORTED_ACTION', '数据包没有实现此计算动作：' + packId + '/' + action);
  if (action === 'sources.inspect') return inspectDataTable(input);
  if (packId === 'data-quality-studio') {
    if (action === 'profiles.compute') return qualityProfile(input, signal);
    if (action === 'rules.validate') return validateQualityRules(input);
    if (action === 'baselines.calculate') return calculateQualityBaseline(input, signal);
    if (action === 'reconciliation.compare') return qualityReconcile(input, signal);
    return qualityCheck(input, signal);
  }
  if (packId === 'lineage-atlas') {
    if (action === 'assets.matchIdentity') return matchLineageIdentity(input);
    if (action === 'impacts.trace') return traceLineage(input, signal);
    if (action === 'reports.compare') return compareLineage(input);
    return validateLineage(input, signal);
  }
  if (packId === 'entity-resolution-studio') {
    if (action === 'comparators.validate') return validateEntityComparators(input);
    if (action === 'clusters.explain') return explainEntityClusters(input, signal);
    if (action === 'clusters.split') return splitEntityClusters(input, signal);
    if (action === 'evaluations.compare') return compareEntityEvaluations(input);
    if (action === 'normalization.preview') return normalizeEntities(input);
    if (action === 'blocks.estimate' || action === 'candidates.compute')
      return computeEntityCandidates(input, signal, action === 'blocks.estimate');
    if (action === 'constraints.check' || action === 'clusters.propose')
      return clusterEntities(input, signal);
    if (action === 'evaluations.evaluate') return evaluateEntities(input);
    return resolveEntitySurvivors(input);
  }
  if (packId === 'temporal-data-studio') {
    if (action === 'calendars.inspect') return inspectTemporalCalendar(input);
    if (action === 'latepolicy.validate') return validateTemporalLatePolicy(input, signal);
    if (action === 'comparisons.explain') return explainTemporalComparison(input, signal);
    if (action === 'semantics.validate' || action === 'alignment.preview')
      return alignTemporal(input, signal);
    if (action === 'intervals.validate') return validateTemporalIntervals(input, signal);
    if (action === 'windows.validate') return runTemporalWindows(input, signal);
    if (action === 'comparisons.compare') return compareTemporal(input);
    return temporalRun(input, signal);
  }
  if (packId === 'geospatial-studio') {
    if (action === 'indexes.build') return indexGeospatial(input);
    if (action === 'measures.calculate') return measureGeospatial(input, signal);
    if (action === 'operations.preview' || action === 'runs.run') return geoRun(input, signal);
    if (action === 'joins.validate') return joinGeospatial(input, signal);
    return validateGeospatial(input, signal);
  }
  if (packId === 'graph-insight-studio') {
    if (action === 'runs.run' || action === 'queries.preview' || action === 'algorithms.validate')
      return runGraph(input, signal);
    if (action === 'comparisons.compare') return compareGraphs(input);
    if (action === 'views.layout') return layoutGraph(input);
    return validateGraph(input);
  }
  if (action === 'questions.validate') return validateExperimentQuestion(input);
  if (action === 'outcomes.validate') return validateExperimentOutcomes(input);
  if (action === 'allocations.validate') return validateExperimentAllocation(input, signal);
  if (action === 'assignments.generate') return assignExperiment(input, signal);
  if (action === 'observations.validate') return validateExperimentObservations(input);
  if (action === 'powerplans.simulate') return simulateExperiment(input, signal);
  return analyzeExperiment(input, signal);
}

const epoch = (value: string, unit: 'second' | 'millisecond' | 'microsecond' | 'nanosecond' = 'second') => ({
  kind: 'epoch',
  value,
  unit,
});
const iso = (value: string) => ({ kind: 'iso', value });
const crs = { code: 'LOCAL', axis: 'xy', unit: 'meter' };
const pointFeature = (id: string, x: number, y: number) => ({
  type: 'Feature',
  id,
  properties: {},
  geometry: { type: 'Point', coordinates: [x, y] },
});
const region = {
  crs,
  features: [
    {
      type: 'Feature',
      id: 'region',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0],
          ],
        ],
      },
    },
  ],
};
const graph = {
  nodes: [{ id: 'part-a' }, { id: 'part-b' }, { id: 'part-c' }],
  edges: [
    { id: 'e1', source: 'part-a', target: 'part-b', weight: 1 },
    { id: 'e2', source: 'part-b', target: 'part-c', weight: 2 },
  ],
  directed: true,
};
const lineage = {
  assets: [
    { id: 'raw', namespace: 'source', externalId: 'orders', version: '1', name: '订单' },
    { id: 'total', namespace: 'analytics', externalId: 'totals', version: '1', name: '汇总' },
    { id: 'report', namespace: 'reports', externalId: 'daily', version: '1', name: '日报' },
  ],
  assertions: [
    {
      id: 'raw-total',
      source: 'raw',
      target: 'total',
      relation: 'aggregate',
      evidence: 'external',
      decision: 'accepted',
    },
    {
      id: 'total-report',
      source: 'total',
      target: 'report',
      relation: 'copy',
      evidence: 'manual',
      decision: 'accepted',
    },
  ],
};
const entityRecords = [
  { id: 'a1', source: 'catalog-a', values: { name: ' Widget  A ', serial: 'A-1' } },
  { id: 'b1', source: 'catalog-b', values: { name: 'widget a', serial: 'A-1' } },
  { id: 'b2', source: 'catalog-b', values: { name: 'widget b', serial: 'B-2' } },
];
export const SEVENTH_DATA_TEMPLATES: Record<string, SeventhDataTemplate[]> = {
  'data-quality-studio': [
    {
      id: 'daily-batches',
      name: '每日订单批次',
      description: '固定预期分区，缺失分区独立于行数显示。',
      domain: 'profiles',
      method: 'compute',
      input: {
        rows: [
          { day: '2026-10-24', amount: 3 },
          { day: '2026-10-26', amount: null },
        ],
        columns: ['amount'],
        partitionColumn: 'day',
        expectedPartitions: ['2026-10-24', '2026-10-25', '2026-10-26'],
      },
    },
    {
      id: 'migration-reconciliation',
      name: '迁移前后对账',
      description: '大整数及十进制差额不经过浮点转换。',
      domain: 'reconciliation',
      method: 'compare',
      input: {
        left: [{ key: 'a', amount: '9007199254740993.10' }],
        right: [
          { key: 'a', amount: '9007199254740993.11' },
          { key: 'b', amount: '2.00' },
        ],
        keys: ['key'],
        decimalColumns: ['amount'],
      },
    },
    {
      id: 'supplier-acceptance',
      name: '供应数据接收',
      description: '固定历史窗口与缺失率变化门槛。',
      domain: 'runs',
      method: 'run',
      input: {
        currentId: 'today',
        current: { rows: [{ value: 1 }, { value: null }], columns: ['value'] },
        baseline: [{ id: 'yesterday', profile: { rows: [{ value: 1 }, { value: 2 }], columns: ['value'] } }],
        rules: [{ kind: 'missing-rate-change', column: 'value', maximum: 0.1 }],
      },
    },
  ],
  'lineage-atlas': [
    {
      id: 'report-impact',
      name: '分析报表影响',
      description: '查看声明关系的下游路径与证据类别。',
      domain: 'impacts',
      method: 'trace',
      input: { graph: lineage, changes: ['raw'] },
    },
    {
      id: 'namespace-migration',
      name: '数据迁移对照',
      description: '新旧身份和声明变化按固定图比较。',
      domain: 'reports',
      method: 'compare',
      input: {
        left: lineage,
        right: {
          ...lineage,
          assets: lineage.assets.map((a) => (a.id === 'report' ? { ...a, name: '新日报' } : a)),
        },
      },
    },
    {
      id: 'result-provenance',
      name: '计算结果追溯',
      description: '从结果向上游查找已声明的来源。',
      domain: 'impacts',
      method: 'trace',
      input: { graph: lineage, changes: ['report'], direction: 'upstream' },
    },
  ],
  'entity-resolution-studio': [
    {
      id: 'product-catalog',
      name: '商品目录合并',
      description: '保留原值，按固定规则形成标准化副本。',
      domain: 'normalization',
      method: 'preview',
      input: {
        records: entityRecords,
        rules: [{ field: 'name', operations: ['trim', 'collapse-whitespace', 'lowercase'] }],
      },
    },
    {
      id: 'organization-matching',
      name: '机构名录整理',
      description: '只在已声明分组中生成候选，评分不是概率。',
      domain: 'candidates',
      method: 'compute',
      input: {
        records: entityRecords,
        blockFields: [],
        comparators: [
          { field: 'serial', kind: 'exact', weight: 2 },
          { field: 'name', kind: 'edit-distance', weight: 1 },
        ],
        threshold: 0.7,
      },
    },
    {
      id: 'asset-deduplication',
      name: '设备台账去重',
      description: '展示传递匹配与禁止同组合并的冲突。',
      domain: 'clusters',
      method: 'propose',
      input: {
        recordIds: ['a1', 'b1', 'b2'],
        acceptedPairs: [
          ['a1', 'b1'],
          ['b1', 'b2'],
        ],
        cannotLink: [['a1', 'b2']],
      },
    },
  ],
  'temporal-data-studio': [
    {
      id: 'multi-zone-records',
      name: '多时区业务记录',
      description: '两个明确偏移映射到同一绝对时刻。',
      domain: 'alignment',
      method: 'preview',
      input: {
        records: [
          { id: 'shanghai', time: iso('2026-10-26T08:00:00+08:00') },
          { id: 'utc', time: iso('2026-10-26T00:00:00Z') },
        ],
        outputUnit: 'nanosecond',
      },
    },
    {
      id: 'device-alignment',
      name: '设备观测对齐',
      description: '保留纳秒差异、缺测与迟到更正版。',
      domain: 'runs',
      method: 'run',
      input: {
        kind: 'windows',
        payload: {
          records: [
            { id: 'one', time: epoch('2'), value: 2 },
            { id: 'two', time: epoch('3'), value: 3 },
          ],
          window: { kind: 'tumbling', sizeNanos: '10000000000' },
          watermarks: [{ afterRecords: 1, time: epoch('20') }],
          latePolicy: 'correct',
          aggregate: 'sum',
        },
      },
    },
    {
      id: 'effective-periods',
      name: '有效期台账',
      description: '明确相邻开闭端点，发现重叠与间隙。',
      domain: 'intervals',
      method: 'validate',
      input: {
        intervals: [
          { id: 'old', start: epoch('0'), end: epoch('10'), startClosed: true, endClosed: true },
          { id: 'new', start: epoch('10'), end: epoch('20'), startClosed: true, endClosed: false },
        ],
      },
    },
  ],
  'geospatial-studio': [
    {
      id: 'facilities-by-region',
      name: '区域设施汇总',
      description: '保留区域边界点、未匹配点和多匹配策略。',
      domain: 'runs',
      method: 'run',
      input: {
        kind: 'join',
        payload: {
          left: {
            crs,
            features: [
              pointFeature('inside', 5, 5),
              pointFeature('edge', 0, 5),
              pointFeature('outside', 20, 5),
            ],
          },
          right: region,
          mode: 'point-in-polygon',
          boundary: 'include',
        },
      },
    },
    {
      id: 'road-clipping',
      name: '路网裁剪',
      description: '真实线段与区域边界相交后形成新线图层。',
      domain: 'runs',
      method: 'run',
      input: {
        kind: 'operate',
        payload: {
          layer: {
            crs,
            features: [
              {
                type: 'Feature',
                id: 'road',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [-5, 5],
                    [15, 5],
                  ],
                },
              },
            ],
          },
          mask: region,
          operation: 'clip',
        },
      },
    },
    {
      id: 'coordinate-unification',
      name: '多源图层整理',
      description: '轴顺序与单位明确后执行固定坐标变换。',
      domain: 'runs',
      method: 'run',
      input: {
        kind: 'transform',
        payload: {
          layer: {
            crs: { code: 'EPSG:4326', axis: 'xy', unit: 'degree' },
            features: [pointFeature('origin', 0, 0), pointFeature('sample', 120, 30)],
          },
          target: 'EPSG:3857',
        },
      },
    },
  ],
  'graph-insight-studio': [
    {
      id: 'parts-dependency',
      name: '零件依赖分析',
      description: '强连通分量与反馈环保留明确结构。',
      domain: 'runs',
      method: 'run',
      input: {
        graph: {
          ...graph,
          edges: [...graph.edges, { id: 'e3', source: 'part-c', target: 'part-a', weight: 1 }],
        },
        algorithm: 'components',
      },
    },
    {
      id: 'document-links',
      name: '文档关联整理',
      description: '有限迭代与悬空质量分别显示。',
      domain: 'runs',
      method: 'run',
      input: { graph, algorithm: 'pagerank', iterations: 100, tolerance: 0.00000001 },
    },
    {
      id: 'task-paths',
      name: '任务协作关系',
      description: '非负权最短路径保留逐边来源。',
      domain: 'runs',
      method: 'run',
      input: { graph, algorithm: 'shortest-path', source: 'part-a', target: 'part-c' },
    },
  ],
  'experiment-planner': [
    {
      id: 'process-assignment',
      name: '两种处理流程',
      description: '固定单位、种子与分层后的可复查分配。',
      domain: 'assignments',
      method: 'generate',
      input: {
        units: Array.from({ length: 12 }, (_, i) => ({
          id: 'unit-' + (i + 1),
          stratum: i < 6 ? 'small' : 'large',
        })),
        seed: 42,
        proportionB: 0.5,
      },
    },
    {
      id: 'software-comparison',
      name: '软件方案对照',
      description: '固定比例差、缺失分母和百分位重采样。',
      domain: 'analyses',
      method: 'run',
      input: {
        observations: [
          { id: 'a1', group: 'A', value: 0 },
          { id: 'a2', group: 'A', value: 1 },
          { id: 'a3', group: 'A', value: 0 },
          { id: 'b1', group: 'B', value: 1 },
          { id: 'b2', group: 'B', value: 1 },
          { id: 'b3', group: 'B', value: 0 },
        ],
        outcome: 'binary',
        seed: 12,
        repetitions: 200,
      },
    },
    {
      id: 'stratified-device-planning',
      name: '分层设备配置',
      description: '假设下的有限规模模拟不作为真实实验保证。',
      domain: 'powerplans',
      method: 'simulate',
      input: {
        scenarios: [
          {
            id: 'device-difference',
            distribution: 'normal',
            nA: 20,
            nB: 20,
            meanA: 0,
            meanB: 0.5,
            sdA: 1,
            sdB: 1,
          },
        ],
        seed: 92,
        simulations: 10,
        bootstrapRepetitions: 100,
      },
    },
  ],
};

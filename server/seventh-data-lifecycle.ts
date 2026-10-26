/** 数据包生命周期只处理已由原服务读取的固定记录；人工意见与机器结论分开保存。 */
import { z } from 'zod';
import {
  suiteJson,
  suiteRecord,
  suiteRef,
  type SuiteJson,
  type SuiteRecord,
  type SuiteRef,
} from '../shared/contracts/suite-common.ts';
import { dataCompare, dataError, stableData } from '../shared/seventh-data-contracts.ts';

export type SeventhDataLifecycleResult = {
  kind: 'definition' | 'review' | 'result';
  content: SuiteJson;
  references: SuiteRef[];
  seal: boolean;
};
const prefixes: Record<string, string> = {
  'data-quality-studio': 'qualitydesk',
  'lineage-atlas': 'lineageatlas',
  'entity-resolution-studio': 'entitydesk',
  'temporal-data-studio': 'temporaldesk',
  'geospatial-studio': 'geodesk',
  'graph-insight-studio': 'graphdesk',
  'experiment-planner': 'trialplan',
};
export const SEVENTH_DATA_LIFECYCLE_ACTIONS: Record<string, string[]> = {
  'data-quality-studio': [
    'findings.collect',
    'exceptions.prepare',
    'exceptions.decide',
    'exceptions.expire',
    'releases.preview',
    'releases.decide',
    'reports.assemble',
    'reports.compare',
    'checklists.prepare',
    'checklists.check',
  ],
  'lineage-atlas': ['reports.assemble', 'reviews.prepare', 'reviews.decide'],
  'entity-resolution-studio': [
    'reports.assemble',
    'reports.compare',
    'decisions.prepare',
    'decisions.decide',
  ],
  'temporal-data-studio': ['reports.assemble', 'reviews.prepare', 'reviews.decide'],
  'geospatial-studio': ['reports.assemble', 'reviews.prepare', 'reviews.decide', 'measures.compare'],
  'graph-insight-studio': ['reports.assemble', 'annotations.review', 'comparisons.explain'],
  'experiment-planner': [
    'analyses.sealPlan',
    'reports.assemble',
    'reports.compare',
    'reviews.prepare',
    'reviews.decide',
    'sensitivity.compare',
  ],
};
const refKey = (ref: SuiteRef) => ref.domain + '/' + ref.id + '/' + ref.revision;
const pin = (record: SuiteRecord): SuiteRef => ({
  domain: record.domain,
  id: record.id,
  revision: record.revision,
});
const object = (value: SuiteJson): Record<string, SuiteJson> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
const shortText = z.string().min(1).max(4000);
function boundLifecycleRecords(records: readonly SuiteRecord[]) {
  if (!Array.isArray(records) || records.length > 1000)
    dataError('DATA_LIFECYCLE_LIMIT', '生命周期记录超过 1000');
  const stack: { value: unknown; depth: number }[] = [{ value: records, depth: 0 }];
  let nodes = 0,
    bytesUpperBound = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 250000 || depth > 28 || bytesUpperBound > 32 * 1024 ** 2)
      dataError('DATA_LIFECYCLE_LIMIT', '生命周期材料超出结构或编码预算，请缩小固定引用集合');
    if (typeof value === 'string') bytesUpperBound += value.length * 3 + 2;
    else if (Array.isArray(value)) {
      if (value.length > 100000) dataError('DATA_LIFECYCLE_LIMIT', '生命周期数组超限');
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
    } else if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value)) {
        bytesUpperBound += key.length * 3 + 3;
        stack.push({ value: item, depth: depth + 1 });
      }
    else bytesUpperBound += 24;
  }
  if (bytesUpperBound > 32 * 1024 ** 2) dataError('DATA_LIFECYCLE_LIMIT', '生命周期材料超出编码预算');
}
type Verdict = 'passed' | 'failed' | 'inconclusive' | 'not-assessed';
function verdict(output: Record<string, SuiteJson> | null): Verdict {
  if (!output) return 'not-assessed';
  if (output.verdict === 'passed' || output.verdict === 'failed' || output.verdict === 'inconclusive')
    return output.verdict;
  if (output.coverage === 'partial' || output.converged === false || output.sealable === false)
    return 'inconclusive';
  if (Array.isArray(output.issues) && output.issues.length) return 'failed';
  if (Array.isArray(output.conflicts) && output.conflicts.length) return 'inconclusive';
  return 'not-assessed';
}
function evidence(record: SuiteRecord, packId: string) {
  const content = object(record.content);
  if (record.kind !== 'result' || !content || content.format !== 'sakura-seventh-result/1')
    return {
      reference: pin(record),
      name: record.name,
      kind: record.kind,
      origin: record.origin,
      recordState: record.state,
      execution: 'not-an-execution-result',
      verdict: 'not-assessed' as Verdict,
      action: null,
      localExecution: false,
    };
  if (
    content.packId !== packId ||
    typeof content.action !== 'string' ||
    typeof content.inputDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(content.inputDigest)
  )
    dataError('DATA_RESULT_ENVELOPE', '原运行结果的包、动作或输入摘要无效');
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(String(content.state)))
    dataError('DATA_RESULT_ENVELOPE', '原运行结果状态无效');
  const conclusion = content.state === 'completed' ? verdict(object(content.output ?? null)) : 'inconclusive';
  return {
    reference: pin(record),
    name: record.name,
    kind: record.kind,
    origin: record.origin,
    recordState: record.state,
    execution: content.state,
    verdict: conclusion,
    action: content.action,
    localExecution: record.origin === 'local' && content.state === 'completed',
  };
}
function combine(evidences: ReturnType<typeof evidence>[]) {
  const results = evidences.filter((e) => e.kind === 'result');
  if (results.some((e) => e.verdict === 'failed')) return 'failed';
  if (!results.length || results.some((e) => !e.localExecution || e.verdict !== 'passed'))
    return 'inconclusive';
  return 'passed';
}
function fixedRecord(records: SuiteRecord[], ref: SuiteRef) {
  return (
    records.find((r) => refKey(pin(r)) === refKey(ref)) ??
    dataError('DATA_FIXED_REFERENCE_MISSING', '缺少原服务读取的固定记录：' + refKey(ref))
  );
}
function requireClock(context?: { at: string }) {
  if (!context) dataError('DATA_SERVER_CLOCK_REQUIRED', '到期与放行检查需要服务端固定比较时点');
  return z.string().datetime().parse(context.at);
}
function assembleReport(
  packId: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z
    .object({
      title: z.string().min(1).max(160).default('固定数据档案'),
      required: z.array(suiteRef).max(1000).default([]),
      notes: z.string().max(10000).default(''),
    })
    .strict()
    .parse(input);
  if (!records.length) dataError('DATA_REPORT_EMPTY', '报告须引用实际定义或结果记录');
  for (const expected of p.required) fixedRecord(records, expected);
  const sources = records.map((r) => evidence(r, packId));
  const protectedAncestors = [
    ...new Map(records.flatMap((r) => r.references).map((ref) => [refKey(ref), ref])).values(),
  ];
  return {
    kind: 'result',
    seal: true,
    references: records.map(pin),
    content: suiteJson.parse({
      format: 'sakura-seventh-data-report/1',
      packId,
      title: p.title,
      notes: p.notes,
      sources,
      protectedAncestors,
      sourceCoverage: 'fixed-records-supplied-by-original-services',
      ancestorVerification: 'original-record-protection;not-re-read-by-report',
      verdict: combine(sources),
      importedSourceCount: sources.filter((s) => s.origin === 'imported').length,
      originalFailures: sources.filter((s) => s.verdict === 'failed').map((s) => s.reference),
      humanOpinionChangesMachineVerdict: false,
    }),
  };
}
function compareReports(
  packId: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z.object({ left: suiteRef, right: suiteRef }).strict().parse(input),
    leftRecord = fixedRecord(records, p.left),
    rightRecord = fixedRecord(records, p.right),
    left = object(leftRecord.content),
    right = object(rightRecord.content);
  if (
    left?.format !== 'sakura-seventh-data-report/1' ||
    right?.format !== 'sakura-seventh-data-report/1' ||
    left.packId !== packId ||
    right.packId !== packId
  )
    dataError('DATA_REPORT_FORMAT', '只能比较同一包的固定数据档案');
  const keys = (row: SuiteRecord) => new Map(row.references.map((ref) => [ref.domain + '/' + ref.id, ref]));
  const a = keys(leftRecord),
    b = keys(rightRecord);
  return {
    kind: 'result',
    seal: true,
    references: [pin(leftRecord), pin(rightRecord)],
    content: suiteJson.parse({
      format: 'sakura-seventh-data-report-comparison/1',
      packId,
      left: p.left,
      right: p.right,
      added: [...b].filter(([key]) => !a.has(key)).map(([, ref]) => ref),
      removed: [...a].filter(([key]) => !b.has(key)).map(([, ref]) => ref),
      changed: [...b]
        .filter(([key, ref]) => a.has(key) && a.get(key)!.revision !== ref.revision)
        .map(([key, ref]) => ({ before: a.get(key)!, after: ref })),
      leftVerdict: left.verdict ?? 'inconclusive',
      rightVerdict: right.verdict ?? 'inconclusive',
      verdict:
        left.verdict === 'failed' || right.verdict === 'failed'
          ? 'failed'
          : left.verdict === 'passed' &&
              right.verdict === 'passed' &&
              leftRecord.origin === 'local' &&
              rightRecord.origin === 'local'
            ? 'passed'
            : 'inconclusive',
      sameResultBytes: stableData(leftRecord.content) === stableData(rightRecord.content),
    }),
  };
}
function collectQualityFindings(
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  z.object({}).strict().parse(input);
  const runs = records.filter((r) =>
    ['qualitydesk-runs', 'qualitydesk-profiles', 'qualitydesk-reconciliation'].includes(r.domain),
  );
  if (!runs.length) dataError('QUALITY_FINDINGS_SOURCE', '异常汇集须引用实际质量或对账运行结果');
  const findings: {
    id: string;
    source: SuiteRef;
    path: string;
    kind: string;
    originalVerdict: string;
    detail: SuiteJson;
    status: string;
  }[] = [];
  for (const record of runs) {
    const e = evidence(record, 'data-quality-studio'),
      content = object(record.content);
    if (record.kind !== 'result' || content?.format !== 'sakura-seventh-result/1')
      dataError('QUALITY_FINDINGS_SOURCE', '异常汇集不接受自由成功标志或定义代替结果');
    const add = (path: string, kind: string, conclusion: string, detail: SuiteJson) => {
      if (findings.length >= 10000) dataError('QUALITY_FINDINGS_LIMIT', '异常汇集超过 10000 项');
      findings.push({
        id: refKey(pin(record)) + '#' + path,
        source: pin(record),
        path,
        kind,
        originalVerdict: conclusion,
        detail,
        status: 'open',
      });
    };
    if (e.execution !== 'completed') {
      add('execution', 'execution-not-completed', e.verdict, content.error ?? null);
      continue;
    }
    const output = object(content.output ?? null);
    if (!output) dataError('QUALITY_FINDINGS_SOURCE', '实际运行结果没有结构化输出');
    const current = object(output.current ?? null);
    const partitions = Array.isArray(output.missingPartitions)
      ? output.missingPartitions
      : Array.isArray(current?.missingPartitions)
        ? current.missingPartitions
        : [];
    partitions.forEach((value, index) =>
      add('missingPartitions[' + index + ']', 'missing-partition', 'failed', value),
    );
    if (Array.isArray(output.results))
      output.results.forEach((value, index) => {
        const row = object(value);
        if (row?.verdict === 'failed' || row?.verdict === 'inconclusive')
          add('results[' + index + ']', 'quality-rule', row.verdict, value);
      });
    if (Array.isArray(output.details))
      output.details.forEach((value, index) =>
        add('details[' + index + ']', 'reconciliation-difference', 'failed', value),
      );
    if (output.detailsTruncated === true)
      add('detailsTruncated', 'difference-details-truncated', 'inconclusive', {
        observedDifferenceCount: output.differenceCount ?? null,
      });
    if (record.origin === 'imported')
      add('origin', 'external-result-not-local-execution', 'inconclusive', '原结果只保留来源声明');
  }
  return {
    kind: 'definition',
    seal: false,
    references: runs.map(pin),
    content: suiteJson.parse({
      format: 'sakura-quality-findings/1',
      findings,
      count: findings.length,
      originalConclusionsRetained: true,
    }),
  };
}
function checkQualityChecklist(
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z
    .object({ expected: z.array(suiteRef).max(1000).default([]), notes: z.string().max(10000).default('') })
    .strict()
    .parse(input);
  const reports = records.filter(
    (r) => r.domain === 'qualitydesk-reports' && object(r.content)?.format === 'sakura-seventh-data-report/1',
  );
  if (!reports.length) dataError('QUALITY_CHECKLIST_REPORT', '接收核对须引用实际质量档案');
  const available = new Set(records.map((r) => refKey(pin(r)))),
    missing = p.expected.filter((ref) => !available.has(refKey(ref)));
  return {
    kind: 'review',
    seal: true,
    references: records.map(pin),
    content: suiteJson.parse({
      format: 'sakura-quality-receiving-checklist/1',
      expected: p.expected,
      actual: records.map(pin),
      missing,
      unsealedReports: reports.filter((r) => r.state !== 'sealed').map(pin),
      importedReports: reports.filter((r) => r.origin === 'imported').map(pin),
      notes: p.notes,
      verdict:
        missing.length || reports.some((r) => r.state !== 'sealed')
          ? 'failed'
          : reports.some((r) => r.origin === 'imported')
            ? 'inconclusive'
            : 'passed',
      qualityConclusions: reports.map((r) => ({
        reference: pin(r),
        verdict: object(r.content)!.verdict ?? 'inconclusive',
      })),
      receivingCheckDoesNotApproveQuality: true,
    }),
  };
}
const analysisPlan = z
  .object({
    format: z.literal('sakura-controlled-experiment-plan/1'),
    primaryOutcome: shortText,
    outcome: z.enum(['continuous', 'binary']),
    unitModel: z.literal('independent'),
    grouping: z.enum(['assigned', 'received']).default('assigned'),
    missingPolicy: z.literal('exclude-and-report'),
    weights: z.record(z.string().min(1).max(256), z.number().min(0).max(1)),
    seed: z.number().int().min(0).max(4294967295),
    repetitions: z.number().int().min(100).max(10000).default(2000),
    level: z.number().gt(0).lt(1).default(0.95),
    cutoff: z.string().datetime(),
    population: suiteRef,
    allocation: suiteRef,
    outcomeDefinition: suiteRef,
  })
  .strict();
function sealAnalysisPlan(
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z.object({ definition: suiteRef }).strict().parse(input),
    record = fixedRecord(records, p.definition);
  if (record.domain !== 'trialplan-analyses' || record.kind !== 'definition' || record.origin !== 'local')
    dataError('EXPERIMENT_PLAN_DEFINITION', '分析预设须来自本地 analyses 定义记录');
  const plan = analysisPlan.parse(record.content);
  if (
    !Object.keys(plan.weights).length ||
    Object.keys(plan.weights).length > 100 ||
    Math.abs(Object.values(plan.weights).reduce((sum, v) => sum + v, 0) - 1) > 1e-12
  )
    dataError('EXPERIMENT_WEIGHTS', '分析计划的固定层权重须和为 1');
  const required = [plan.population, plan.allocation, plan.outcomeDefinition],
    domains = ['trialplan-populations', 'trialplan-allocations', 'trialplan-outcomes'];
  for (let i = 0; i < required.length; i++) {
    if (required[i].domain !== domains[i])
      dataError('EXPERIMENT_PLAN_REFERENCE_DOMAIN', '分析计划的来源领域不匹配');
    fixedRecord(records, required[i]);
    if (!record.references.some((ref) => refKey(ref) === refKey(required[i])))
      dataError('EXPERIMENT_PLAN_UNPROTECTED_REFERENCE', '分析定义未保护所用的固定来源');
  }
  const observed = records.filter((r) => r.domain === 'trialplan-observations');
  return {
    kind: 'definition',
    seal: true,
    references: [pin(record), ...required],
    content: suiteJson.parse({
      ...plan,
      sourceDefinition: pin(record),
      localDefinitionCreatedAt: record.createdAt,
      knownObservationRecords: observed.map(pin),
      postHocWithinSuppliedRecords:
        observed.some((r) => Date.parse(r.createdAt) <= Date.parse(record.createdAt)) ||
        Date.parse(plan.cutoff) <= Date.parse(record.createdAt),
      preregistrationScope: 'local-record-order-only',
      externalRandomizationVerified: false,
      externalDataGenerationOrderVerified: false,
    }),
  };
}
const exceptionContent = z
  .object({
    format: z.literal('sakura-quality-exception/1'),
    findingIds: z.array(z.string().min(1).max(512)).min(1).max(10000),
    reason: shortText,
    expiresAt: z.string().datetime(),
    comparisonAt: z.string().datetime(),
    opinion: z.enum(['proposed', 'accept', 'reject']),
    sources: z.array(suiteRef).min(1).max(1000),
    expired: z.boolean().optional(),
    sourceException: suiteRef.optional(),
    originalMachineFailuresRetained: z.boolean().optional(),
  })
  .strict();
function qualityException(
  action: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
  context?: { at: string },
): SeventhDataLifecycleResult {
  const at = requireClock(context);
  if (action === 'exceptions.prepare') {
    const p = z
      .object({
        findingIds: z.array(z.string().min(1).max(512)).min(1).max(10000),
        reason: shortText,
        expiresAt: z.string().datetime(),
      })
      .strict()
      .parse(input);
    if (Date.parse(p.expiresAt) <= Date.parse(at))
      dataError('QUALITY_EXCEPTION_EXPIRED', '例外到期时点须晚于当前服务端时点');
    const findings = records.filter(
      (r) => r.domain === 'qualitydesk-findings' && object(r.content)?.format === 'sakura-quality-findings/1',
    );
    const ids = new Set(
      findings.flatMap((r) => {
        const value = object(r.content)!.findings;
        return Array.isArray(value)
          ? value.map((f) => object(f)?.id).filter((id): id is string => typeof id === 'string')
          : [];
      }),
    );
    if (!findings.length || p.findingIds.some((id) => !ids.has(id)))
      dataError('QUALITY_EXCEPTION_FINDING', '例外须准确绑定实际异常及修订');
    return {
      kind: 'definition',
      seal: false,
      references: findings.map(pin),
      content: suiteJson.parse(
        exceptionContent.parse({
          format: 'sakura-quality-exception/1',
          ...p,
          comparisonAt: at,
          opinion: 'proposed',
          sources: findings.map(pin),
        }),
      ),
    };
  }
  const p = z
      .object({ exception: suiteRef, opinion: z.enum(['accept', 'reject']).optional() })
      .strict()
      .parse(input),
    record = fixedRecord(records, p.exception),
    previous = exceptionContent.parse(record.content);
  if (record.domain !== 'qualitydesk-exceptions') dataError('QUALITY_EXCEPTION_DOMAIN', '例外来源领域不匹配');
  for (const source of previous.sources) {
    fixedRecord(records, source);
    if (!record.references.some((ref) => refKey(ref) === refKey(source)))
      dataError('QUALITY_EXCEPTION_UNPROTECTED_REFERENCE', '例外没有保护其声明的原异常');
  }
  const expired = Date.parse(previous.expiresAt) <= Date.parse(at);
  if (action === 'exceptions.decide' && (!p.opinion || (p.opinion === 'accept' && expired)))
    dataError('QUALITY_EXCEPTION_EXPIRED', '例外已过期或缺少明确意见');
  return {
    kind: 'review',
    seal: true,
    references: [pin(record), ...previous.sources],
    content: suiteJson.parse({
      ...previous,
      comparisonAt: at,
      opinion: action === 'exceptions.decide' ? p.opinion : previous.opinion,
      expired,
      sourceException: pin(record),
      originalMachineFailuresRetained: true,
    }),
  };
}
function qualityRelease(
  action: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
  context?: { at: string },
): SeventhDataLifecycleResult {
  const p = z
      .object({
        opinion: z.enum(['accept', 'reject', 'defer']).default('defer'),
        reason: z.string().max(4000).default(''),
      })
      .strict()
      .parse(input),
    at = requireClock(context);
  const findingRecords = records.filter(
    (r) => r.domain === 'qualitydesk-findings' && object(r.content)?.format === 'sakura-quality-findings/1',
  );
  const suppliedFindings = findingRecords.flatMap((r) => {
    const rows = object(r.content)!.findings;
    return Array.isArray(rows)
      ? rows.map(object).filter((row): row is Record<string, SuiteJson> => row !== null)
      : [];
  });
  const exceptions = records
    .filter((r) => r.domain === 'qualitydesk-exceptions' && r.kind === 'review' && r.state === 'sealed')
    .map((r) => ({ record: r, value: exceptionContent.safeParse(r.content) }))
    .filter(
      (v) =>
        v.value.success &&
        v.value.data.opinion === 'accept' &&
        Date.parse(v.value.data.expiresAt) > Date.parse(at) &&
        v.record.origin === 'local' &&
        v.value.data.sources.every((source) =>
          findingRecords.some((record) => refKey(pin(record)) === refKey(source)),
        ),
    );
  const actualRuns = records.filter((r) =>
    ['qualitydesk-runs', 'qualitydesk-reconciliation'].includes(r.domain),
  );
  if (!actualRuns.length) dataError('QUALITY_RELEASE_EVIDENCE', '放行预览须引用实际检查或对账结果');
  const recomputed = object(collectQualityFindings({}, actualRuns).content)!;
  const findings = (recomputed.findings as SuiteJson[])
    .map(object)
    .filter((row): row is Record<string, SuiteJson> => row !== null);
  for (const finding of findings) {
    if (
      !suppliedFindings.some(
        (row) => row.id === finding.id && stableData(row.source) === stableData(finding.source),
      )
    )
      dataError('QUALITY_RELEASE_FINDINGS', '异常清单没有覆盖所选运行的实际问题');
  }
  const covered = new Set(exceptions.flatMap((v) => (v.value.success ? v.value.data.findingIds : []))),
    unresolved = findings.filter((f) => typeof f.id === 'string' && !covered.has(f.id));
  const sources = actualRuns.map((r) => evidence(r, 'data-quality-studio')),
    hasUnknown = sources.some(
      (s) => !s.localExecution || s.verdict === 'inconclusive' || s.verdict === 'not-assessed',
    );
  if (sources.some((s) => s.verdict === 'failed') && (!findingRecords.length || !findings.length))
    dataError('QUALITY_RELEASE_FINDINGS', '失败检查须先汇集准确异常，不可跳过问题清单');
  const ready = !hasUnknown && !unresolved.length;
  if (action === 'releases.decide' && p.opinion === 'accept' && !ready)
    dataError('QUALITY_RELEASE_BLOCKED', '仍有未知执行或未被有效限定例外覆盖的异常');
  return {
    kind: action === 'releases.decide' ? 'review' : 'definition',
    seal: action === 'releases.decide',
    references: records.map(pin),
    content: suiteJson.parse({
      format: 'sakura-quality-release/1',
      comparisonAt: at,
      ready,
      unresolvedFindingIds: unresolved.map((f) => f.id),
      applicableExceptions: exceptions.map((e) => pin(e.record)),
      sources,
      originalMachineVerdict: combine(sources),
      humanOpinion: p.opinion,
      reason: p.reason,
      businessDecision: action === 'releases.decide' ? p.opinion : 'preview-only',
      machineFailuresOverwritten: false,
    }),
  };
}
function reviewRecords(
  packId: string,
  action: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z
    .object({ opinion: z.enum(['accept', 'reject', 'defer']).default('defer'), reason: shortText })
    .strict()
    .parse(input);
  if (!records.length) dataError('DATA_REVIEW_EMPTY', '人工复核须绑定实际固定记录');
  const sources = records.map((r) => evidence(r, packId));
  const constraintBlocked =
    packId === 'entity-resolution-studio' &&
    records.some((r) => object(object(r.content)?.output ?? null)?.sealable === false);
  if (action === 'decisions.decide' && p.opinion === 'accept' && constraintBlocked)
    dataError('ENTITY_DECISION_CONSTRAINT', '禁止同组约束未解除，不能接受整个簇');
  return {
    kind: 'review',
    seal: !action.endsWith('.prepare'),
    references: records.map(pin),
    content: suiteJson.parse({
      format: 'sakura-seventh-data-review/1',
      packId,
      action,
      humanOpinion: p.opinion,
      reason: p.reason,
      sources,
      originalMachineVerdict: combine(sources),
      distinctReviewerCountClaimed: false,
      machineFailuresOverwritten: false,
    }),
  };
}
function compareResultRecords(
  packId: string,
  action: string,
  input: Record<string, unknown>,
  records: SuiteRecord[],
): SeventhDataLifecycleResult {
  const p = z.object({ left: suiteRef, right: suiteRef }).strict().parse(input),
    left = fixedRecord(records, p.left),
    right = fixedRecord(records, p.right),
    a = evidence(left, packId),
    b = evidence(right, packId),
    leftContent = object(left.content),
    rightContent = object(right.content);
  if (a.execution !== 'completed' || b.execution !== 'completed')
    dataError('DATA_COMPARISON_INCOMPLETE', '比较须使用两个已完成的固定运行记录');
  const sameInput = leftContent?.inputDigest === rightContent?.inputDigest;
  return {
    kind: 'result',
    seal: true,
    references: [pin(left), pin(right)],
    content: suiteJson.parse({
      format: 'sakura-seventh-data-result-comparison/1',
      packId,
      action,
      left: a,
      right: b,
      sameInputDigest: sameInput,
      outputEqual: stableData(leftContent?.output) === stableData(rightContent?.output),
      comparisonScope: 'fixed-results-with-original-conditions',
      conditions: sameInput ? [] : ['input-digest-changed'],
      verdict:
        a.verdict === 'failed' || b.verdict === 'failed'
          ? 'failed'
          : a.localExecution && b.localExecution && a.verdict === 'passed' && b.verdict === 'passed'
            ? 'passed'
            : 'inconclusive',
    }),
  };
}

export function computeSeventhDataLifecycle(
  packId: string,
  action: string,
  input: Record<string, unknown>,
  sourceRecords: readonly SuiteRecord[],
  context?: { at: string },
): SeventhDataLifecycleResult {
  if (
    !Object.hasOwn(SEVENTH_DATA_LIFECYCLE_ACTIONS, packId) ||
    !SEVENTH_DATA_LIFECYCLE_ACTIONS[packId].includes(action)
  )
    dataError('SEVENTH_DATA_LIFECYCLE_UNSUPPORTED', '未声明的数据生命周期动作');
  boundLifecycleRecords(sourceRecords);
  const records = z.array(suiteRecord).max(1000).parse(sourceRecords),
    workspaces = new Set(records.map((r) => r.workspaceId)),
    seen = new Set<string>();
  if (workspaces.size > 1) dataError('DATA_LIFECYCLE_WORKSPACE', '生命周期输入包含不同工作空间');
  for (const record of records) {
    if (!record.domain.startsWith(prefixes[packId] + '-'))
      dataError('DATA_LIFECYCLE_DOMAIN', '生命周期输入包含另一包的记录');
    const key = refKey(pin(record));
    if (seen.has(key)) dataError('DATA_LIFECYCLE_DUPLICATE', '固定记录重复');
    seen.add(key);
    if (record.state === 'archived') dataError('DATA_LIFECYCLE_ARCHIVED', '归档来源不能用于新的封存或决定');
  }
  records.sort((a, b) => dataCompare(refKey(pin(a)), refKey(pin(b))));
  if (action === 'reports.assemble') return assembleReport(packId, input, records);
  if (action === 'reports.compare') return compareReports(packId, input, records);
  if (action === 'findings.collect') return collectQualityFindings(input, records);
  if (action === 'checklists.prepare' || action === 'checklists.check')
    return checkQualityChecklist(input, records);
  if (action.startsWith('exceptions.')) return qualityException(action, input, records, context);
  if (action.startsWith('releases.')) return qualityRelease(action, input, records, context);
  if (action === 'analyses.sealPlan') return sealAnalysisPlan(input, records);
  if (['measures.compare', 'comparisons.explain', 'sensitivity.compare'].includes(action))
    return compareResultRecords(packId, action, input, records);
  return reviewRecords(packId, action, input, records);
}

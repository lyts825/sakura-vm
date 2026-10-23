/** 将原始报告与确切运行、候选绑定，保存每次结果而非覆盖失败。 Bind raw reports to exact runs and candidates. */
import { assertDeliveryCandidate } from './delivery-candidate.ts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import {
  deliveryReportFormatSchema,
  type DeliveryScope,
  type DeliveryCandidate,
  type DeliveryReportFormat,
} from '../shared/contracts/delivery-common.ts';
import { deliveryEvidenceSchema, type DeliveryEvidence } from '../shared/contracts/delivery-quality.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DeliveryRunnersV1 } from './service-contracts/delivery-execution.ts';
import type { PluginMetadata } from './plugin-metadata.ts';
import { DeliveryQualityStore, qualityHash, sameScope } from './delivery-quality-store.ts';
import { readDeliveryFile } from './delivery-quality-io.ts';
import { parseDeliveryReport } from './delivery-report-parsers.ts';
const stateSchema = z
  .object({ schemaVersion: z.literal(1), evidence: z.array(deliveryEvidenceSchema).max(10000) })
  .strict();
export class DeliveryReports {
  private store: DeliveryQualityStore<{
    schemaVersion: 1;
    evidence: DeliveryEvidence[];
  }>;
  /** 绑定制品、运行和受管 metadata/authorize；不在构造时采集报告。 Bind artifacts, runs and managed metadata/authorization without ingesting reports. */
  constructor(
    private artifacts: DeliveryArtifactsV1,
    private runners: DeliveryRunnersV1,
    metadata: PluginMetadata,
    authorize: (scope: DeliveryScope) => void | Promise<void>,
  ) {
    this.store = new DeliveryQualityStore(
      metadata,
      () => ({ schemaVersion: 1, evidence: [] }),
      authorize,
      (value) => stateSchema.parse(value),
    );
  }
  /** 返回 scope 的报告历史副本，不改变证据。 Return the report history for scope without changing evidence. */
  async view(scope: DeliveryScope) {
    return (await this.store.read(scope)).evidence;
  }
  /** 在 scope 中查找 id，返回报告或抛出未找到错误。 Return report id within scope, or throw when absent. */
  async get(scope: DeliveryScope, id: string) {
    const found = (await this.view(scope)).find((e) => e.id === id);
    if (!found) throw new AppError('验证报告不存在', 404);
    return found;
  }
  /**
   * 核对 input 的候选、运行及原始文件，返回并追加报告证据，同时保留原制品引用。
   * Verify input candidate, run and raw file; append and return evidence while retaining its artifact.
   * 设计 / Design：先确认运行身份与原始摘要，再解析并保存；未知执行状态不能由报告自称成功覆盖。
   * Confirm run identity and raw digest before parsing and persistence; self-reported success cannot replace unknown execution state.
   */
  async ingest(
    scope: DeliveryScope,
    input: {
      candidate: DeliveryCandidate;
      runId: string;
      manifestId: string;
      path: string;
      format: DeliveryReportFormat;
    },
  ) {
    const candidate = assertDeliveryCandidate(scope, input.candidate);
    deliveryReportFormatSchema.parse(input.format);
    if (!sameScope(scope, candidate.scope)) throw new AppError('候选范围不匹配', 403);
    const run = await this.runners.get(scope, input.runId);
    if (
      (candidate.runId !== run.id && run.candidateDigest !== candidate.digest) ||
      run.inputDigest !== candidate.inputDigest ||
      !run.reportManifestIds.includes(input.manifestId)
    )
      throw new AppError('报告不属于此候选运行', 409);
    const manifest = await this.artifacts.get(scope, input.manifestId),
      file = manifest.files.find((f) => f.path === input.path);
    if (!file) throw new AppError('报告文件不存在', 404);
    const parsed =
      file.bytes > 2 * 1024 * 1024
        ? {
            status: 'truncated' as const,
            tests: 0,
            failures: 0,
            skipped: 0,
            coverage: null,
            diagnostics: [],
            benchmark: null,
            detail: '报告超过 2 MiB 上限',
          }
        : parseDeliveryReport(
            input.format,
            await readDeliveryFile(this.artifacts, scope, file, 2 * 1024 * 1024),
          );
    if (run.result === 'cancelled') parsed.status = 'cancelled';
    else if (run.state !== 'finished' || run.cleanup !== 'verified' || run.result === 'interrupted')
      parsed.status = 'unknown';
    else if (run.exitCode !== 0 && parsed.status === 'passed') {
      parsed.status = 'failed';
      parsed.detail = '报告通过，但执行退出码不为零';
    }
    const raw = {
      id: randomUUID(),
      scope,
      candidateDigest: candidate.digest,
      runId: run.id,
      manifestId: manifest.id,
      path: file.path,
      rawDigest: file.sha256,
      format: input.format,
      parserVersion: 1 as const,
      external: false,
      ...parsed,
      createdAt: new Date().toISOString(),
    };
    const evidence = deliveryEvidenceSchema.parse({ ...raw, digest: '0'.repeat(64) }),
      { digest: _digest, ...canonical } = evidence;
    evidence.digest = qualityHash(canonical);
    await this.artifacts.retain(scope, manifest.id, 'evidence:' + evidence.id);
    return this.store.mutate(scope, (state) => {
      if (state.schemaVersion !== 1) throw new AppError('报告索引版本不支持', 409);
      state.evidence = z.array(deliveryEvidenceSchema).max(9999).parse(state.evidence);
      state.evidence.push(evidence);
      return evidence;
    });
  }
  /** 比较 scope 中两个完整基准报告的中位数；环境或输入不一致时返回不可比较，不写状态。 Compare complete benchmark medians in scope; return non-comparable for mismatched inputs/environments without writing. */
  async compare(scope: DeliveryScope, leftId: string, rightId: string) {
    const [left, right] = await Promise.all([this.get(scope, leftId), this.get(scope, rightId)]);
    const a = left.benchmark,
      b = right.benchmark;
    if (
      !a ||
      !b ||
      a.tool !== b.tool ||
      a.environment !== b.environment ||
      a.inputClass !== b.inputClass ||
      left.status !== 'passed' ||
      right.status !== 'passed'
    )
      return {
        comparable: false,
        reason: '仅同工具、输入类别、执行环境的完整通过样本可比较',
        changePercent: null,
      };
    const [leftRun, rightRun] = await Promise.all([
      this.runners.get(scope, left.runId),
      this.runners.get(scope, right.runId),
    ]);
    if (
      leftRun.inputDigest !== rightRun.inputDigest ||
      !leftRun.environmentVerified ||
      !rightRun.environmentVerified ||
      qualityHash(leftRun.cells.map((c) => c.environment)) !==
        qualityHash(rightRun.cells.map((c) => c.environment))
    )
      return {
        comparable: false,
        reason: '实际输入或受管执行环境不同，报告自报环境不足以比较',
        changePercent: null,
      };
    /** 返回 values 副本的中位数，不重排原样本。 Return the median of a copy without reordering source samples. */
    const median = (values: number[]) => {
      const sorted = [...values].sort((x, y) => x - y),
        middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    };
    const before = median(a.samplesMs),
      after = median(b.samplesMs);
    return {
      comparable: before > 0,
      reason: before ? '按样本中位数比较' : '基线为零，不能计算比例',
      changePercent: before ? ((after - before) / before) * 100 : null,
    };
  }
}

/** 不可变版本血缘与条件明确的结果比较。 */
import type {
  DataLineageV1,
  DataDatasetsV1,
  DataTransformsV1,
  DataQualityV1,
  DataNotebooksV1,
  DataRuntimeV1,
} from './service-contracts/data-lab.ts';
import type { DataScope, DataComparison } from '../shared/contracts/data-common.ts';
import { dataViewSchema, type DataAction, type DataResult } from '../shared/contracts/data-services.ts';
import { dataHash, type DataAuthorize } from './data-store.ts';
import { AppError } from '../shared/errors.ts';
export class DataLineage implements DataLineageV1 {
  constructor(
    private datasets: DataDatasetsV1,
    private transforms: DataTransformsV1,
    private quality: DataQualityV1,
    private notebooks: DataNotebooksV1,
    private runtime: DataRuntimeV1,
    private authorize: DataAuthorize,
  ) {}
  async view(scope: DataScope) {
    const views = await Promise.all([
      this.datasets.view(scope),
      this.transforms.view(scope),
      this.quality.view(scope),
      this.notebooks.view(scope),
    ]);
    return dataViewSchema.parse({
      datasets: views[0].datasets,
      evidence: views.slice(1).flatMap((v) => v.evidence),
    });
  }
  async act(scope: DataScope, input: DataAction): Promise<DataResult> {
    await this.authorize(scope);
    const view = await this.view(scope);
    if (input.action === 'graph') {
      const known = new Set(view.datasets.map((d) => d.digest));
      return {
        graph: {
          datasets: view.datasets,
          evidence: view.evidence,
          missing: [...new Set(view.datasets.flatMap((d) => d.parents).filter((d) => !known.has(d)))],
        },
      };
    }
    if (input.action === 'compare') {
      const left = view.evidence.find((v) => v.id === input.leftId),
        right = view.evidence.find((v) => v.id === input.rightId);
      if (!left || !right) throw new AppError('比较记录不存在', 404);
      const a = await this.runtime.get(scope, left.runId),
        b = await this.runtime.get(scope, right.runId);
      const differences: string[] = [];
      let status: DataComparison['status'] = 'comparable';
      if (left.kind !== right.kind) {
        status = 'incomparable';
        differences.push('计算种类不同');
      }
      if (
        a.state !== 'succeeded' ||
        b.state !== 'succeeded' ||
        a.cleanup !== 'confirmed' ||
        b.cleanup !== 'confirmed'
      ) {
        status = 'incomparable';
        differences.push('存在未成功或未核销的运行');
      }
      if (dataHash(left.inputDigests) !== dataHash(right.inputDigests))
        differences.push('输入版本或顺序不同');
      if (left.definitionDigest !== right.definitionDigest) differences.push('代码、规则或参数不同');
      if (a.task.environment.digest !== b.task.environment.digest) differences.push('环境镜像不同');
      if (dataHash(a.output?.environment) !== dataHash(b.output?.environment))
        differences.push('执行环境报告不同');
      if (a.task.sample || b.task.sample) differences.push('存在抽样质量检查，不能用于证明全量质量');
      if (dataHash(a.output?.table?.schema) !== dataHash(b.output?.table?.schema))
        differences.push('输出 schema 不同，未进行逐行配对');
      if (status === 'comparable' && differences.length) status = 'conditional';
      const am = a.output?.metrics ?? {},
        bm = b.output?.metrics ?? {};
      const metrics = [...new Set([...Object.keys(am), ...Object.keys(bm)])]
        .sort()
        .map((name) => ({
          name,
          left: am[name] ?? null,
          right: bm[name] ?? null,
          difference:
            am[name] !== undefined && bm[name] !== undefined
              ? Number.isFinite(bm[name] - am[name])
                ? bm[name] - am[name]
                : null
              : null,
        }));
      if (!metrics.length) differences.push('无同名数值指标；只比较执行定义及数据结构，不推断统计显著性');
      return { comparison: { status, differences, leftId: left.id, rightId: right.id, metrics } };
    }
    throw new AppError('血缘不支持该动作', 400);
  }
}

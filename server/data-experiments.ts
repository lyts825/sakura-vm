/** 有界参数矩阵；每次尝试保留独立执行回执。 */
import { randomUUID } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DataExperimentsV1, DataTransformsV1, DataNotebooksV1 } from './service-contracts/data-lab.ts';
import {
  dataExperimentSchema,
  dataViewSchema,
  type DataExperiment,
  type DataAction,
  type DataResult,
} from '../shared/contracts/data-services.ts';
import type { DataScope } from '../shared/contracts/data-common.ts';
import { DataStore, dataHash, sameDataScope, type DataAuthorize } from './data-store.ts';
import { AppError } from '../shared/errors.ts';
export class DataExperiments implements DataExperimentsV1 {
  private records: DataStore<DataExperiment>;
  private active = new Map<string, AbortController>();
  private closed = false;
  private pending = new Set<Promise<void>>();
  constructor(
    metadata: PluginMetadata,
    private transforms: DataTransformsV1,
    private notebooks: DataNotebooksV1,
    private authorize: DataAuthorize,
  ) {
    this.records = new DataStore(metadata, dataExperimentSchema, authorize);
  }
  async init() {
    for (const row of await this.records.all())
      if (row.state === 'running')
        await this.set(row, { state: 'interrupted', error: '服务重启；已完成项保留，余项可重新执行' });
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({ experiments: await this.records.list(scope) });
  }
  private async definition(scope: DataScope, kind: 'sql' | 'notebook', id: string) {
    const view = await (kind === 'sql' ? this.transforms : this.notebooks).view(scope);
    const row = (kind === 'sql' ? view.queries : view.notebooks).find((r) => r.id === id);
    if (!row) throw new AppError('实验定义不存在', 404);
    return dataHash(row);
  }
  private async set(row: DataExperiment, patch: Partial<DataExperiment>) {
    return (await this.records.change(
      row.scope,
      (rows) => {
        const current = rows.find((v) => v.id === row.id && sameDataScope(v.scope, row.scope))!;
        Object.assign(current, patch);
        return current;
      },
      true,
    )) as DataExperiment;
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    if (this.closed) throw new AppError('实验服务已关闭', 503);
    if (input.action === 'plan-experiment') {
      const definitionDigest = await this.definition(scope, input.kind, input.definitionId);
      let combinations: Record<string, string | number | boolean | null>[] = [{}];
      for (const [key, values] of Object.entries(input.parameters)) {
        if (combinations.length * values.length > 32) throw new AppError('参数组合不能超过 32 项', 413);
        combinations = combinations.flatMap((row) => values.map((value) => ({ ...row, [key]: value })));
      }
      const experiment = await this.records.put(scope, {
        id: randomUUID(),
        scope,
        name: input.name,
        kind: input.kind,
        definitionId: input.definitionId,
        definitionDigest,
        combinations,
        evidenceIds: [],
        state: 'planned',
        createdAt: new Date().toISOString(),
      });
      return { experiment };
    }
    if (input.action === 'run-experiment') {
      let row = await this.records.get(scope, input.id);
      if (this.active.has(row.id) || row.state === 'finished')
        throw new AppError('实验正在运行或已完成，请创建新实验', 409);
      if ((await this.definition(scope, row.kind, row.definitionId)) !== row.definitionDigest)
        throw new AppError('实验定义修订已变化，请重新计划', 409, 'DATA_EXPERIMENT_STALE');
      if (row.environment && dataHash(row.environment) !== dataHash(input.environment))
        throw new AppError('继续实验必须使用首次运行的固定环境和预算', 409, 'DATA_EXPERIMENT_ENVIRONMENT');
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      this.pending.add(done);
      const abort = new AbortController();
      this.active.set(row.id, abort);
      const activeSignal = AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]);
      try {
        row = await this.set(row, { state: 'running', environment: input.environment, error: undefined });
        for (let i = row.evidenceIds.length; i < row.combinations.length; i++) {
          activeSignal.throwIfAborted();
          await this.authorize(scope);
          if ((await this.definition(scope, row.kind, row.definitionId)) !== row.definitionDigest)
            throw new AppError('实验过程中定义发生变化', 409);
          const result = await (row.kind === 'sql' ? this.transforms : this.notebooks).act(
            scope,
            row.kind === 'sql'
              ? {
                  action: 'run-query',
                  id: row.definitionId,
                  environment: input.environment,
                  parameters: row.combinations[i],
                  confirmed: true,
                }
              : {
                  action: 'execute-notebook',
                  id: row.definitionId,
                  environment: input.environment,
                  parameters: row.combinations[i],
                  allowRaw: input.allowRaw,
                  confirmed: true,
                },
            activeSignal,
          );
          if (!result.evidence) throw new AppError('实验执行缺少可核验回执', 409);
          row = await this.set(row, { evidenceIds: [...row.evidenceIds, result.evidence.id] });
        }
        return { experiment: await this.set(row, { state: 'finished' }) };
      } catch (error) {
        row = await this.set(row, {
          state: activeSignal.aborted ? 'cancelled' : row.evidenceIds.length ? 'partial' : 'failed',
          error: error instanceof Error ? error.message.slice(0, 2048) : '实验失败',
        });
        return { experiment: row, message: '实验未全部完成；成功项已保留，重新执行只处理剩余项' };
      } finally {
        this.active.delete(row.id);
        finish();
        this.pending.delete(done);
      }
    }
    if (input.action === 'cancel-experiment') {
      const row = await this.records.get(scope, input.id);
      this.active.get(row.id)?.abort();
      return { experiment: row, message: '已请求取消；状态在运行资源核销后更新' };
    }
    throw new AppError('参数实验不支持该动作', 400);
  }
  async close() {
    this.closed = true;
    for (const abort of this.active.values()) abort.abort();
    await Promise.allSettled([...this.pending]);
    await this.records.close();
  }
}

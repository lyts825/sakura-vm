/** 数据版本封存和脱敏派生。 Seal typed dataset versions and redacted derivatives. */
import { randomUUID } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DataDatasetsV1, DataRuntimeV1, DataSourcesV1 } from './service-contracts/data-lab.ts';
import {
  dataDatasetSchema,
  dataTaskSchema,
  type DataDataset,
  type DataScope,
  type DataTask,
} from '../shared/contracts/data-common.ts';
import { dataViewSchema, type DataAction, type DataResult } from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, type DataAuthorize } from './data-store.ts';
import { AppError } from '../shared/errors.ts';
export async function dataInput(
  artifacts: DeliveryArtifactsV1,
  scope: DataScope,
  dataset: DataDataset,
): Promise<DataTask['inputs'][number]> {
  const manifest = await artifacts.get(scope, dataset.manifestId);
  if (manifest.digest !== dataset.manifestDigest) throw new AppError('数据清单摘要发生变化', 409);
  return { manifest, files: dataset.files, format: dataset.format, parse: dataset.parse };
}
export function datasetDigest(row: Omit<DataDataset, 'digest'> | DataDataset) {
  return dataHash({
    manifestDigest: row.manifestDigest,
    format: row.format,
    files: row.files,
    schema: row.schema,
    parse: row.parse,
    rows: row.rows,
    bytes: row.bytes,
    parents: row.parents,
    definitionDigest: row.definitionDigest,
    sensitivity: row.sensitivity,
  });
}
export class DataDatasets implements DataDatasetsV1 {
  private records: DataStore<DataDataset>;
  constructor(
    meta: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    private runtime: DataRuntimeV1,
    private sources: DataSourcesV1,
    private authorize: DataAuthorize,
  ) {
    this.records = new DataStore(meta, dataDatasetSchema, authorize);
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({ datasets: await this.records.list(scope) });
  }
  async get(scope: DataScope, id: string) {
    return this.records.get(scope, id);
  }
  async publish(
    scope: DataScope,
    input: { name: string; runId: string; parents: string[]; sensitivity: 'raw' | 'redacted' },
  ) {
    const run = await this.runtime.get(scope, input.runId);
    if (
      run.state !== 'succeeded' ||
      run.cleanup !== 'confirmed' ||
      !run.manifestId ||
      !run.output?.table ||
      run.output.truncated
    )
      throw new AppError('运行未提供完整表格结果', 409);
    const manifest = await this.artifacts.get(scope, run.manifestId),
      table = run.output.table;
    const base = {
      id: randomUUID(),
      scope,
      name: input.name,
      manifestId: manifest.id,
      manifestDigest: manifest.digest,
      format: table.format,
      files: table.files,
      schema: table.schema,
      parse: { delimiter: ',', header: true, nullValue: '__SAKURA_NULL_4c5fa8__', schema: table.schema },
      rows: table.rows,
      bytes: table.bytes,
      parents: input.parents,
      definitionDigest: run.definitionDigest,
      sensitivity: input.sensitivity,
      archived: false,
      createdAt: new Date().toISOString(),
    };
    const record = dataDatasetSchema.parse({ ...base, digest: datasetDigest(base) });
    await this.artifacts.retain(scope, manifest.id, 'data:dataset:' + record.id);
    return this.records.put(scope, record);
  }
  async accept(scope: DataScope, raw: DataDataset) {
    return (await this.acceptMany(scope, [raw]))[0];
  }
  async acceptMany(scope: DataScope, raw: DataDataset[]) {
    if (!raw.length || raw.length > 128) throw new AppError('接收版本数量无效', 400);
    const rows = raw.map((row) => dataDatasetSchema.parse(row));
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new AppError('接收身份重复', 409);
    for (const row of rows) {
      if (
        row.scope.vmId !== scope.vmId ||
        row.scope.projectId !== scope.projectId ||
        datasetDigest(row) !== row.digest
      )
        throw new AppError('导入数据版本摘要或作用域不符', 409);
      const manifest = await this.artifacts.get(scope, row.manifestId);
      if (manifest.digest !== row.manifestDigest) throw new AppError('导入清单摘要不符', 409);
      await this.artifacts.verify(scope, manifest.id);
      await this.artifacts.retain(scope, manifest.id, 'data:dataset:' + row.id);
    }
    await this.records.change(scope, (current) => {
      if (rows.some((r) => current.some((v) => v.id === r.id))) throw new AppError('接收身份已存在', 409);
      current.push(...rows);
    });
    return rows;
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    if (input.action === 'archive') {
      const row = await this.get(scope, input.id);
      return {
        dataset: (await this.records.change(scope, (rows) => {
          const current = rows.find((v) => v.id === row.id)!;
          current.archived = true;
          return current;
        })) as DataDataset,
      };
    }
    if (input.action === 'seal') {
      const source = (await this.sources.view(scope)).sources.find((s) => s.id === input.sourceId);
      if (!source) throw new AppError('来源不存在', 404);
      const manifest = await this.artifacts.get(scope, source.manifestId);
      if (manifest.digest !== source.manifestDigest) throw new AppError('来源摘要不符', 409);
      const run = await this.runtime.execute(
        scope,
        dataTaskSchema.parse({
          kind: 'inspect',
          environment: input.environment,
          inputs: [
            {
              manifest,
              files: source.files,
              format: source.format,
              parse: input.parse.schema ? input.parse : (source.parseHint ?? input.parse),
            },
          ],
        }),
      );
      await this.runtime.wait(scope, run.id, signal);
      return {
        dataset: await this.publish(scope, {
          name: input.name,
          runId: run.id,
          parents: [],
          sensitivity: 'raw',
        }),
      };
    }
    if (input.action === 'mask') {
      const parent = await this.get(scope, input.datasetId);
      const run = await this.runtime.execute(
        scope,
        dataTaskSchema.parse({
          kind: 'mask',
          environment: input.environment,
          inputs: [await dataInput(this.artifacts, scope, parent)],
          masks: input.masks,
        }),
      );
      await this.runtime.wait(scope, run.id, signal);
      return {
        dataset: await this.publish(scope, {
          name: input.name,
          runId: run.id,
          parents: [parent.digest],
          sensitivity: 'redacted',
        }),
      };
    }
    throw new AppError('数据版本不支持该动作', 400);
  }
  async close() {
    await this.records.close();
  }
}

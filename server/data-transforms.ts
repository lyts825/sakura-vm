/** 版本固定的 SQL 变换。 SQL transformations over immutable inputs. */
import { randomUUID } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DataDatasetsV1, DataRuntimeV1, DataTransformsV1 } from './service-contracts/data-lab.ts';
import {
  dataSqlSchema,
  dataEvidenceSchema,
  dataTaskSchema,
  type DataScope,
  type DataSql,
  type DataEvidence,
} from '../shared/contracts/data-common.ts';
import { dataViewSchema, type DataAction, type DataResult } from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, sameDataScope, type DataAuthorize } from './data-store.ts';
import { dataInput } from './data-datasets.ts';
import { AppError } from '../shared/errors.ts';
export class DataTransforms implements DataTransformsV1 {
  private queries: DataStore<DataSql>;
  private evidence: DataStore<DataEvidence>;
  constructor(
    queryMeta: PluginMetadata,
    evidenceMeta: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    private runtime: DataRuntimeV1,
    private datasets: DataDatasetsV1,
    private authorize: DataAuthorize,
  ) {
    this.queries = new DataStore(queryMeta, dataSqlSchema, authorize);
    this.evidence = new DataStore(evidenceMeta, dataEvidenceSchema, authorize);
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({
      queries: await this.queries.list(scope),
      evidence: await this.evidence.list(scope),
    });
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    if (input.action === 'save-query') {
      for (const id of input.datasetIds) await this.datasets.get(scope, id);
      const row: DataSql = {
        id: input.id || randomUUID(),
        scope,
        revision: input.expectedRevision + 1,
        name: input.name,
        sql: input.sql,
        parameters: input.parameters,
        datasetIds: input.datasetIds,
        createdAt: new Date().toISOString(),
      };
      return {
        query: (await this.queries.change(scope, (rows) => {
          const old = rows.find((v) => v.id === row.id && sameDataScope(v.scope, scope));
          if ((old?.revision ?? 0) !== input.expectedRevision) throw new AppError('SQL 修订冲突', 409);
          if (old) Object.assign(old, row);
          else if (rows.some((v) => v.id === row.id)) throw new AppError('记录身份冲突', 409);
          else rows.push(row);
          return row;
        })) as DataSql,
      };
    }
    if (input.action === 'run-query') {
      const query = await this.queries.get(scope, input.id),
        datasets = await Promise.all(query.datasetIds.map((id) => this.datasets.get(scope, id)));
      const run = await this.runtime.execute(
        scope,
        dataTaskSchema.parse({
          kind: 'transform',
          environment: input.environment,
          inputs: await Promise.all(datasets.map((d) => dataInput(this.artifacts, scope, d))),
          sql: query.sql,
          parameters: input.parameters ?? query.parameters,
        }),
      );
      await this.runtime.wait(scope, run.id, signal);
      const dataset = await this.datasets.publish(scope, {
        name: query.name,
        runId: run.id,
        parents: datasets.map((d) => d.digest),
        sensitivity: datasets.some((d) => d.sensitivity === 'raw') ? 'raw' : 'redacted',
      });
      const evidence = await this.evidence.put(scope, {
        id: randomUUID(),
        scope,
        kind: 'transform',
        inputIds: datasets.map((d) => d.id),
        inputDigests: datasets.map((d) => d.digest),
        definitionDigest: dataHash({ sql: query.sql, parameters: input.parameters ?? query.parameters }),
        runId: run.id,
        outputDatasetId: dataset.id,
        createdAt: new Date().toISOString(),
      });
      return { dataset, evidence };
    }
    throw new AppError('SQL 变换不支持该动作', 400);
  }
  async close() {
    await this.queries.close();
    await this.evidence.close();
  }
}

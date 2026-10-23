/** 数据画像与全量规则证据。 Profiles and coverage-aware quality evidence. */
import { randomUUID } from 'node:crypto';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { DeliveryArtifactsV1 } from './service-contracts/delivery-storage.ts';
import type { DataDatasetsV1, DataRuntimeV1, DataQualityV1 } from './service-contracts/data-lab.ts';
import {
  dataEvidenceSchema,
  dataTaskSchema,
  type DataScope,
  type DataEvidence,
} from '../shared/contracts/data-common.ts';
import {
  dataViewSchema,
  dataRuleSetSchema,
  type DataAction,
  type DataResult,
  type DataRuleSet,
} from '../shared/contracts/data-services.ts';
import { DataStore, dataHash, sameDataScope, type DataAuthorize } from './data-store.ts';
import { dataInput } from './data-datasets.ts';
import { AppError } from '../shared/errors.ts';
export class DataQuality implements DataQualityV1 {
  private rules: DataStore<DataRuleSet>;
  private evidence: DataStore<DataEvidence>;
  constructor(
    ruleMeta: PluginMetadata,
    evidenceMeta: PluginMetadata,
    private artifacts: DeliveryArtifactsV1,
    private runtime: DataRuntimeV1,
    private datasets: DataDatasetsV1,
    private authorize: DataAuthorize,
  ) {
    this.rules = new DataStore(ruleMeta, dataRuleSetSchema, authorize);
    this.evidence = new DataStore(evidenceMeta, dataEvidenceSchema, authorize);
  }
  async view(scope: DataScope) {
    return dataViewSchema.parse({
      rules: await this.rules.list(scope),
      evidence: await this.evidence.list(scope),
    });
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    await this.authorize(scope);
    if (input.action === 'save-rules') {
      const row: DataRuleSet = {
        id: input.id || randomUUID(),
        scope,
        revision: input.expectedRevision + 1,
        name: input.name,
        rules: input.rules,
        createdAt: new Date().toISOString(),
      };
      return {
        rules: (await this.rules.change(scope, (rows) => {
          const old = rows.find((v) => v.id === row.id && sameDataScope(v.scope, scope));
          if ((old?.revision ?? 0) !== input.expectedRevision) throw new AppError('质量规则修订冲突', 409);
          if (old) Object.assign(old, row);
          else if (rows.some((v) => v.id === row.id)) throw new AppError('记录身份冲突', 409);
          else rows.push(row);
          return row;
        })) as DataRuleSet,
      };
    }
    if (input.action === 'check') {
      const rules = await this.rules.get(scope, input.id),
        datasets = await Promise.all(input.datasetIds.map((id) => this.datasets.get(scope, id)));
      const run = await this.runtime.execute(
        scope,
        dataTaskSchema.parse({
          kind: 'quality',
          environment: input.environment,
          inputs: await Promise.all(datasets.map((d) => dataInput(this.artifacts, scope, d))),
          rules: rules.rules,
          sample: input.sample,
        }),
      );
      const finished = await this.runtime.wait(scope, run.id, signal);
      const evidence = await this.evidence.put(scope, {
        id: randomUUID(),
        scope,
        kind: 'quality',
        inputIds: datasets.map((d) => d.id),
        inputDigests: datasets.map((d) => d.digest),
        definitionDigest: dataHash({ rules: rules.rules, sample: input.sample }),
        runId: run.id,
        createdAt: new Date().toISOString(),
      });
      return {
        evidence,
        run: finished,
        message: input.sample
          ? '样本画像，不代表全量通过'
          : finished.output?.checks.some((c) => c.verdict !== 'pass')
            ? '全量检查存在失败或未知项'
            : rules.rules.length
              ? '全量规则通过'
              : '仅完成画像，未配置质量规则',
      };
    }
    throw new AppError('数据质量不支持该动作', 400);
  }
  async close() {
    await this.rules.close();
    await this.evidence.close();
  }
}

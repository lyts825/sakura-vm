/** 聚合独立数据能力；每个动作仍由所属服务实施准入。 */
import type {
  DataWorkbenchV1,
  DataRuntimeV1,
  DataSourcesV1,
  DataDatasetsV1,
  DataTransformsV1,
  DataQualityV1,
  DataNotebooksV1,
  DataExperimentsV1,
  DataLineageV1,
  DataExchangeV1,
} from './service-contracts/data-lab.ts';
import type { DataScope } from '../shared/contracts/data-common.ts';
import {
  dataViewSchema,
  type DataView,
  type DataAction,
  type DataResult,
} from '../shared/contracts/data-services.ts';
import { AppError } from '../shared/errors.ts';
export type DataWorkbenchProviders = {
  runtime: DataRuntimeV1;
  sources: DataSourcesV1;
  datasets: DataDatasetsV1;
  transforms: DataTransformsV1;
  quality: DataQualityV1;
  notebooks: DataNotebooksV1;
  experiments: DataExperimentsV1;
  lineage: DataLineageV1;
  exchange: DataExchangeV1;
};
export class DataWorkbench implements DataWorkbenchV1 {
  constructor(private providers: DataWorkbenchProviders) {}
  async view(scope: DataScope) {
    const views = await Promise.all(
      Object.entries(this.providers)
        .filter(([key]) => key !== 'lineage')
        .map(([, p]) => p.view(scope)),
    );
    const result = dataViewSchema.parse({});
    for (const key of Object.keys(result) as (keyof DataView)[]) {
      const rows = views.flatMap((v) => v[key] as unknown as { id: string }[]);
      (result[key] as unknown) = [...new Map(rows.map((r) => [r.id, r])).values()];
    }
    return dataViewSchema.parse(result);
  }
  async act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult> {
    const action = input.action;
    const key =
      action === 'prepare-builtin' ||
      action === 'prepare-environment' ||
      action === 'execute' ||
      action === 'cancel' ||
      action === 'reconcile' ||
      action === 'reconcile-preparation'
        ? 'runtime'
        : action === 'credential-version' || action.startsWith('capture-')
          ? 'sources'
          : ['seal', 'mask', 'archive'].includes(action)
            ? 'datasets'
            : ['save-query', 'run-query'].includes(action)
              ? 'transforms'
              : ['save-rules', 'check'].includes(action)
                ? 'quality'
                : action.includes('notebook')
                  ? 'notebooks'
                  : action.includes('experiment')
                    ? 'experiments'
                    : ['graph', 'compare'].includes(action)
                      ? 'lineage'
                      : ['export', 'import-preview', 'accept', 'reconcile-import', 'inspect-import'].includes(
                            action,
                          )
                        ? 'exchange'
                        : null;
    if (!key) throw new AppError('未知数据动作', 400);
    return this.providers[key].act(scope, input, signal);
  }
}

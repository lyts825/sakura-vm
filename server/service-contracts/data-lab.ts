/** 数据插件独立公共端口。 Independently versioned data plugin ports. */
import type {
  DataScope,
  DataTask,
  DataRun,
  DataDataset,
  DataEvidence,
  DataSource,
} from '../../shared/contracts/data-common.ts';
import type {
  DataView,
  DataAction,
  DataResult,
  DataSession,
  DataPg,
} from '../../shared/contracts/data-services.ts';
export interface DataRuntimeV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
  execute(scope: DataScope, task: DataTask): Promise<DataRun>;
  wait(scope: DataScope, id: string, signal?: AbortSignal): Promise<DataRun>;
  get(scope: DataScope, id: string): Promise<DataRun>;
  cancel(scope: DataScope, id: string): Promise<DataRun>;
}
export interface DataSourcesV1 {
  captureDatabase(
    scope: DataScope,
    input: { name: string; connection: DataPg },
    signal?: AbortSignal,
  ): Promise<DataSource>;
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataDatasetsV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
  get(scope: DataScope, id: string): Promise<DataDataset>;
  publish(
    scope: DataScope,
    input: { name: string; runId: string; parents: string[]; sensitivity: 'raw' | 'redacted' },
  ): Promise<DataDataset>;
  accept(scope: DataScope, dataset: DataDataset): Promise<DataDataset>;
  acceptMany(scope: DataScope, datasets: DataDataset[]): Promise<DataDataset[]>;
}
export interface DataTransformsV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataQualityV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataNotebooksV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataExperimentsV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataLineageV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataExchangeV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}
export interface DataWorkbenchV1 {
  view(scope: DataScope): Promise<DataView>;
  act(scope: DataScope, input: DataAction, signal?: AbortSignal): Promise<DataResult>;
}

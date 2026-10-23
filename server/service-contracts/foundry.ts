import type {
  FoundryScope,
  FoundryAction,
  FoundryResult,
  FoundryView,
  FoundryUse,
} from '../../shared/contracts/foundry.ts';
/** 各领域分别注册，动作按其声明的阶段严格限制。 */
export interface FoundrySourcesV1 {
  view(scope: FoundryScope): Promise<FoundryView>;
  act(scope: FoundryScope, input: FoundryAction): Promise<FoundryResult>;
}
export interface FoundryBlueprintsV1 extends FoundrySourcesV1 {}
export interface FoundryDepotV1 extends FoundrySourcesV1 {}
export interface FoundryBuildersV1 extends FoundrySourcesV1 {}
export interface FoundrySanitizersV1 extends FoundrySourcesV1 {}
export interface FoundryChecksV1 extends FoundrySourcesV1 {}
export interface FoundryCatalogV1 extends FoundrySourcesV1 {
  previewUse(scope: FoundryScope, id: string): Promise<FoundryUse>;
  authorizeUse(scope: FoundryScope, id: string, owner: string): Promise<FoundryUse>;
}
export interface FoundryExchangeV1 extends FoundrySourcesV1 {}
export interface FoundryWorkbenchV1 extends FoundrySourcesV1 {}

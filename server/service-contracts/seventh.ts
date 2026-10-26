/** 第七批各领域只声明本域方法；实现不进入公共合同。 */
import type * as S from "../../shared/contracts/suite-common.ts";
import type * as T from "../../shared/contracts/seventh-common.ts";
import type {z} from "zod";
import type {SeventhExchangeV1} from "../../shared/contracts/seventh-exchange.ts";
export interface QualitydeskSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface QualitydeskSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface QualitydeskPartitionsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  bind(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskProfilesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compute(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskRulesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskBaselinesV1 extends T.SeventhRecordsV1 {
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskFindingsV1 extends T.SeventhRecordsV1 {
  collect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  classify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskReconciliationV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskExceptionsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  expire(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskReleasesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskExchangeV1 extends SeventhExchangeV1 {
}
export interface QualitydeskChecklistsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface QualitydeskWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface LineageatlasCatalogsV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface LineageatlasAssetsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  matchIdentity(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasMappingsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasProcessesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  bind(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasAssertionsV1 extends T.SeventhRecordsV1 {
  record(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  classify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasGraphsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasImpactsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  trace(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasInvestigationsV1 extends T.SeventhRecordsV1 {
  open(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  attach(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasReviewsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface LineageatlasExchangeV1 extends SeventhExchangeV1 {
}
export interface LineageatlasWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface EntitydeskSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface EntitydeskNormalizationV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskBlocksV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  estimate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskComparatorsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskCandidatesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compute(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskConstraintsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskClustersV1 extends T.SeventhRecordsV1 {
  propose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  split(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskDecisionsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskEvaluationsV1 extends T.SeventhRecordsV1 {
  defineSet(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskSurvivorsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskVersionsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface EntitydeskExchangeV1 extends SeventhExchangeV1 {
}
export interface EntitydeskWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface TemporaldeskSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface TemporaldeskCalendarsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskSemanticsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskAlignmentV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskIntervalsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskWindowsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskLatepolicyV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskComparisonsV1 extends T.SeventhRecordsV1 {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskReviewsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TemporaldeskExchangeV1 extends SeventhExchangeV1 {
}
export interface TemporaldeskWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface GeodeskSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface GeodeskCrsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskValidationV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskLayersV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskOperationsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskJoinsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskIndexesV1 extends T.SeventhRecordsV1 {
  build(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskMeasuresV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskStylesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskReviewsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GeodeskExchangeV1 extends SeventhExchangeV1 {
}
export interface GeodeskWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface GraphdeskSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface GraphdeskEntitiesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskEdgesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskProjectionsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskQueriesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskAlgorithmsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskComparisonsV1 extends T.SeventhRecordsV1 {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskAnnotationsV1 extends T.SeventhRecordsV1 {
  record(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskViewsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  layout(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface GraphdeskExchangeV1 extends SeventhExchangeV1 {
}
export interface GraphdeskWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface TrialplanQuestionsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanPopulationsV1 extends T.SeventhMaterialsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface TrialplanOutcomesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanAllocationsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanPowerplansV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  simulate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanAssignmentsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanObservationsV1 extends T.SeventhMaterialsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface TrialplanAnalysesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  sealPlan(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanSensitivityV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanReviewsV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface TrialplanExchangeV1 extends SeventhExchangeV1 {
}
export interface TrialplanWorkbenchV1 extends T.SeventhRecordsV1 {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface FeatSourcesV1 extends T.SeventhMaterialsV1 {
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface FeatSchemasV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatPartitionsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkOverlap(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatTransformsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkGraph(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatJoinsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkCardinality(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatWindowsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkAvailability(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatFitsV1 extends T.SeventhRecordsV1 {
  fit(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatSelectionsV1 extends T.SeventhRecordsV1 {
  rank(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatChecksV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatArtifactsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatReviewsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FeatExchangeV1 extends SeventhExchangeV1 {
}
export interface FeatWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface CtrainSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface CtrainDatasetsV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface CtrainTargetsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainPartitionsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkOverlap(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainEstimatorsV1 extends T.SeventhRecordsV1 {
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainSearchesV1 extends T.SeventhRecordsV1 {
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  freeze(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainPredictionsV1 extends T.SeventhRecordsV1 {
  predict(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainMetricsV1 extends T.SeventhRecordsV1 {
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  slice(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainComparisonsV1 extends T.SeventhRecordsV1 {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainExplanationsV1 extends T.SeventhRecordsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainRegistryV1 extends T.SeventhRecordsV1 {
  register(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CtrainExchangeV1 extends SeventhExchangeV1 {
}
export interface CtrainWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface CsolveSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface CsolveVariablesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveDomainsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveConstraintsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkTypes(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveObjectivesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveScenariosV1 extends T.SeventhRecordsV1 {
  derive(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveSolutionsV1 extends T.SeventhRecordsV1 {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveValidationV1 extends T.SeventhRecordsV1 {
  verify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveConflictsV1 extends T.SeventhRecordsV1 {
  analyze(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveSensitivityV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveDecisionsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface CsolveExchangeV1 extends SeventhExchangeV1 {
}
export interface CsolveWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface DextractSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface DextractSourcesV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface DextractPagesV1 extends T.SeventhRecordsV1 {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractLayoutsV1 extends T.SeventhRecordsV1 {
  detect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  edit(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractOcrV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractTablesV1 extends T.SeventhRecordsV1 {
  reconstruct(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  edit(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractSchemasV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractFieldsV1 extends T.SeventhRecordsV1 {
  extract(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractChecksV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  listFindings(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractCorrectionsV1 extends T.SeventhRecordsV1 {
  propose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  apply(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractDatasetsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractReviewsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DextractExchangeV1 extends SeventhExchangeV1 {
}
export interface DextractWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface DsysSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface DsysTokensV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysThemesV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysTypographyV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysIconsV1 extends T.SeventhMaterialsV1 {
  sanitize(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface DsysComponentsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysStatesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkCoverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysLayoutsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysChecksV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysBuildsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysReviewsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DsysExchangeV1 extends SeventhExchangeV1 {
}
export interface DsysWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface FformSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface FformFieldsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformSchemasV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformLogicV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkGraph(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformPagesV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkReachability(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformFixturesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformValidationsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformPreviewsV1 extends T.SeventhRecordsV1 {
  open(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  answer(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  navigate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  close(input:S.SuiteScope & {expectedRevision:number}):Promise<S.SuiteWorkspace>;
}
export interface FformSubmissionsV1 extends T.SeventhRecordsV1 {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  erasePreview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformVersionsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformReviewsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface FformExchangeV1 extends SeventhExchangeV1 {
}
export interface FformWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface NtplSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface NtplVariablesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplChannelsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplTemplatesV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  parse(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplLocalesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkCoverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplAssetsV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface NtplAudiencesV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplRulesV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  simulate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplRendersV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplInboxesV1 extends T.SeventhRecordsV1 {
  previewDelivery(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  deliverLocal(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplChecksV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplReleasesV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface NtplExchangeV1 extends SeventhExchangeV1 {
}
export interface NtplWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface SchedlabSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface SchedlabCalendarsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabClocksV1 extends T.SeventhRecordsV1 {
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabRulesV1 extends T.SeventhRecordsV1 {
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabPoliciesV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabWorkloadsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabScenariosV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabSimulationsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabHarnessV1 extends T.SeventhVmV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabObservationsV1 extends T.SeventhRecordsV1 {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  readEvents(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabChecksV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface SchedlabExchangeV1 extends SeventhExchangeV1 {
}
export interface SchedlabWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface ExtforgeSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface ExtforgeSourcesV1 extends T.SeventhMaterialsV1 {
  edit(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface ExtforgeManifestsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeInterfacesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeToolchainsV1 extends T.SeventhRecordsV1 {
  importProfile(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeBuildsV1 extends T.SeventhVmV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeInspectionsV1 extends T.SeventhRecordsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeCasesV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeTrialsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeSignaturesV1 extends T.SeventhRecordsV1 {
  prepareEnvelope(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  importSignature(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  verify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeBundlesV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeReviewsV1 extends T.SeventhRecordsV1 {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeExchangeV1 extends SeventhExchangeV1 {
}
export interface ExtforgeCatalogsV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  exportCatalog(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ExtforgeWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface DepsolveSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface DepsolveCatalogsV1 extends T.SeventhMaterialsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface DepsolveRootsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolvePlatformsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveConstraintsV1 extends T.SeventhRecordsV1 {
  compile(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveCandidatesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveSolvesV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveProofsV1 extends T.SeventhRecordsV1 {
  checkAssignment(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explainConflict(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveComparisonsV1 extends T.SeventhRecordsV1 {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  annotate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveLocksV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface DepsolveExchangeV1 extends SeventhExchangeV1 {
}
export interface DepsolveWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface ProtostateSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface ProtostateGrammarsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateMessagesV1 extends T.SeventhMaterialsV1 {
  encode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  decode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface ProtostateMachinesV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateGuardsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateScenariosV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateGeneratorsV1 extends T.SeventhRecordsV1 {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateTargetsV1 extends T.SeventhMaterialsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface ProtostateRunsV1 extends T.SeventhVmV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateTracesV1 extends T.SeventhRecordsV1 {
  decode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  readFrames(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostatePropertiesV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateReductionsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  reduce(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ProtostateExchangeV1 extends SeventhExchangeV1 {
}
export interface ProtostateWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface ReplabSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface ReplabSchemasV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabReplicasV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabOperationsV1 extends T.SeventhMaterialsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface ReplabClocksV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabChannelsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabPoliciesV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabScenariosV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabRunsV1 extends T.SeventhRecordsV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabConflictsV1 extends T.SeventhRecordsV1 {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  proposeResolution(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabJudgmentsV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface ReplabExchangeV1 extends SeventhExchangeV1 {
}
export interface ReplabWorkbenchV1 extends T.SeventhRecordsV1 {
}
export interface VirtserviceSpacesV1 extends T.SeventhRootV1 {
  create(input:{name:string}):Promise<S.SuiteJson>;
}
export interface VirtserviceContractsV1 extends T.SeventhMaterialsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface VirtservicePayloadsV1 extends T.SeventhMaterialsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  pin(input:S.SuitePin):Promise<S.SuiteRecord>;
  upload(input:z.infer<typeof T.seventhUpload>):Promise<S.SuiteRecord>;
}
export interface VirtserviceMatchersV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceStatesV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceTransitionsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceFaultsV1 extends T.SeventhRecordsV1 {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceScenariosV1 extends T.SeventhRecordsV1 {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtservicePackagesV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceSessionsV1 extends T.SeventhVmV1 {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  checkpoint(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  fork(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceTrafficV1 extends T.SeventhRecordsV1 {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  readRequests(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceAssertionsV1 extends T.SeventhRecordsV1 {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceReportsV1 extends T.SeventhRecordsV1 {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>;
}
export interface VirtserviceExchangeV1 extends SeventhExchangeV1 {
}
export interface VirtserviceWorkbenchV1 extends T.SeventhRecordsV1 {
}

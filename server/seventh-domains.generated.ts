/** 逐领域固定方法适配；不接收服务名、模块名或任意执行函数。 */
import {SeventhService} from "./seventh-runtime.ts";
import type * as S from "../shared/contracts/suite-common.ts";
import type * as T from "../shared/contracts/seventh-common.ts";
import type {z} from "zod";
import {SeventhExchange} from "./seventh-exchange.ts";
export class QualitydeskSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class QualitydeskSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class QualitydeskPartitions extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  bind(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('bind',input);}
}
export class QualitydeskProfiles extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  compute(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compute',input);}
}
export class QualitydeskRules extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class QualitydeskBaselines extends SeventhService {
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('select',input);}
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('calculate',input);}
}
export class QualitydeskRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class QualitydeskFindings extends SeventhService {
  collect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('collect',input);}
  classify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('classify',input);}
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('resolve',input);}
}
export class QualitydeskReconciliation extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class QualitydeskExceptions extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
  expire(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('expire',input);}
}
export class QualitydeskReleases extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class QualitydeskReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class QualitydeskExchange extends SeventhExchange {
}
export class QualitydeskChecklists extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class QualitydeskWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class LineageatlasSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class LineageatlasCatalogs extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class LineageatlasAssets extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  matchIdentity(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('matchIdentity',input);}
}
export class LineageatlasMappings extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class LineageatlasProcesses extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  bind(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('bind',input);}
}
export class LineageatlasAssertions extends SeventhService {
  record(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('record',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  classify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('classify',input);}
}
export class LineageatlasGraphs extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class LineageatlasImpacts extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  trace(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('trace',input);}
}
export class LineageatlasInvestigations extends SeventhService {
  open(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('open',input);}
  attach(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('attach',input);}
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('resolve',input);}
}
export class LineageatlasReviews extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class LineageatlasReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class LineageatlasExchange extends SeventhExchange {
}
export class LineageatlasWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class EntitydeskSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class EntitydeskSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class EntitydeskNormalization extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class EntitydeskBlocks extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  estimate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('estimate',input);}
}
export class EntitydeskComparators extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class EntitydeskCandidates extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  compute(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compute',input);}
}
export class EntitydeskConstraints extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class EntitydeskClusters extends SeventhService {
  propose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('propose',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
  split(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('split',input);}
}
export class EntitydeskDecisions extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class EntitydeskEvaluations extends SeventhService {
  defineSet(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('defineSet',input);}
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class EntitydeskSurvivors extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('resolve',input);}
}
export class EntitydeskVersions extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class EntitydeskReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class EntitydeskExchange extends SeventhExchange {
}
export class EntitydeskWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class TemporaldeskSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class TemporaldeskSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class TemporaldeskCalendars extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
}
export class TemporaldeskSemantics extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TemporaldeskAlignment extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class TemporaldeskIntervals extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TemporaldeskWindows extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TemporaldeskLatepolicy extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TemporaldeskRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class TemporaldeskComparisons extends SeventhService {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class TemporaldeskReviews extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class TemporaldeskReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
}
export class TemporaldeskExchange extends SeventhExchange {
}
export class TemporaldeskWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class GeodeskSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class GeodeskSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class GeodeskCrs extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GeodeskValidation extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class GeodeskLayers extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GeodeskOperations extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class GeodeskJoins extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GeodeskIndexes extends SeventhService {
  build(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('build',input);}
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
}
export class GeodeskRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class GeodeskMeasures extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('calculate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class GeodeskStyles extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class GeodeskReviews extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class GeodeskReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
}
export class GeodeskExchange extends SeventhExchange {
}
export class GeodeskWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class GraphdeskSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class GraphdeskSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class GraphdeskEntities extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GraphdeskEdges extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GraphdeskProjections extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GraphdeskQueries extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class GraphdeskAlgorithms extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class GraphdeskRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class GraphdeskComparisons extends SeventhService {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class GraphdeskAnnotations extends SeventhService {
  record(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('record',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class GraphdeskViews extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  layout(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('layout',input);}
}
export class GraphdeskReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
}
export class GraphdeskExchange extends SeventhExchange {
}
export class GraphdeskWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class TrialplanSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class TrialplanQuestions extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TrialplanPopulations extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
}
export class TrialplanOutcomes extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TrialplanAllocations extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class TrialplanPowerplans extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  simulate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('simulate',input);}
}
export class TrialplanAssignments extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('generate',input);}
}
export class TrialplanObservations extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class TrialplanAnalyses extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  sealPlan(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('sealPlan',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class TrialplanSensitivity extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class TrialplanReviews extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class TrialplanReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class TrialplanExchange extends SeventhExchange {
}
export class TrialplanWorkbench extends SeventhService {
  saveView(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('saveView',input);}
}
export class FeatSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class FeatSources extends SeventhService {
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('read',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class FeatSchemas extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class FeatPartitions extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  checkOverlap(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkOverlap',input);}
}
export class FeatTransforms extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  checkGraph(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkGraph',input);}
}
export class FeatJoins extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  checkCardinality(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkCardinality',input);}
}
export class FeatWindows extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  checkAvailability(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkAvailability',input);}
}
export class FeatFits extends SeventhService {
  fit(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('fit',input);}
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
}
export class FeatSelections extends SeventhService {
  rank(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('rank',input);}
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('select',input);}
}
export class FeatRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class FeatChecks extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class FeatArtifacts extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class FeatReviews extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class FeatExchange extends SeventhExchange {
}
export class FeatWorkbench extends SeventhService {
}
export class CtrainSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class CtrainDatasets extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class CtrainTargets extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class CtrainPartitions extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  checkOverlap(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkOverlap',input);}
}
export class CtrainEstimators extends SeventhService {
  configure(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('configure',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class CtrainSearches extends SeventhService {
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('expand',input);}
  freeze(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('freeze',input);}
}
export class CtrainRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class CtrainPredictions extends SeventhService {
  predict(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('predict',input);}
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('read',input);}
}
export class CtrainMetrics extends SeventhService {
  calculate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('calculate',input);}
  slice(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('slice',input);}
}
export class CtrainComparisons extends SeventhService {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  select(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('select',input);}
}
export class CtrainExplanations extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class CtrainRegistry extends SeventhService {
  register(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('register',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class CtrainReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class CtrainExchange extends SeventhExchange {
}
export class CtrainWorkbench extends SeventhService {
}
export class CsolveSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class CsolveVariables extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
}
export class CsolveDomains extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class CsolveConstraints extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  checkTypes(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkTypes',input);}
}
export class CsolveObjectives extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class CsolveScenarios extends SeventhService {
  derive(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('derive',input);}
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('diff',input);}
}
export class CsolveRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class CsolveSolutions extends SeventhService {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('capture',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class CsolveValidation extends SeventhService {
  verify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('verify',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class CsolveConflicts extends SeventhService {
  analyze(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('analyze',input);}
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('read',input);}
}
export class CsolveSensitivity extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class CsolveDecisions extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class CsolveExchange extends SeventhExchange {
}
export class CsolveWorkbench extends SeventhService {
}
export class DextractSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class DextractSources extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class DextractPages extends SeventhService {
  prepare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepare',input);}
}
export class DextractLayouts extends SeventhService {
  detect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('detect',input);}
  override edit(input:any,...rest:any[]):Promise<any>{if(typeof input==='function')return super.edit(input,rest[0],rest[1]);return this.perform('edit',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DextractOcr extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class DextractTables extends SeventhService {
  reconstruct(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('reconstruct',input);}
  override edit(input:any,...rest:any[]):Promise<any>{if(typeof input==='function')return super.edit(input,rest[0],rest[1]);return this.perform('edit',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class DextractSchemas extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DextractFields extends SeventhService {
  extract(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('extract',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class DextractChecks extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  listFindings(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('listFindings',input);}
}
export class DextractCorrections extends SeventhService {
  propose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('propose',input);}
  apply(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('apply',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class DextractDatasets extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('read',input);}
}
export class DextractReviews extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class DextractExchange extends SeventhExchange {
}
export class DextractWorkbench extends SeventhService {
}
export class DsysSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class DsysTokens extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('resolve',input);}
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('diff',input);}
}
export class DsysThemes extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DsysTypography extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class DsysIcons extends SeventhService {
  sanitize(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('sanitize',input);}
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
}
export class DsysComponents extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DsysStates extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('expand',input);}
  checkCoverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkCoverage',input);}
}
export class DsysLayouts extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class DsysChecks extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class DsysBuilds extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class DsysReviews extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class DsysExchange extends SeventhExchange {
}
export class DsysWorkbench extends SeventhService {
}
export class FformSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class FformFields extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class FformSchemas extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class FformLogic extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  checkGraph(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkGraph',input);}
}
export class FformPages extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  checkReachability(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkReachability',input);}
}
export class FformFixtures extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('generate',input);}
}
export class FformValidations extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class FformPreviews extends SeventhService {
  open(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('open',input);}
  answer(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('answer',input);}
  navigate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('navigate',input);}
  override async close(input?:S.SuiteScope & {expectedRevision:number}):Promise<any>{if(!input)return super.close();return this.revokeWorkspace({...input,revoked:true});}
}
export class FformSubmissions extends SeventhService {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('capture',input);}
  read(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('read',input);}
  erasePreview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('erasePreview',input);}
}
export class FformVersions extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('diff',input);}
}
export class FformReviews extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  decide(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decide',input);}
}
export class FformExchange extends SeventhExchange {
}
export class FformWorkbench extends SeventhService {
}
export class NtplSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class NtplVariables extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class NtplChannels extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  check(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('check',input);}
}
export class NtplTemplates extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  parse(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('parse',input);}
  diff(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('diff',input);}
}
export class NtplLocales extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  checkCoverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkCoverage',input);}
}
export class NtplAssets extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class NtplAudiences extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  generate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('generate',input);}
}
export class NtplRules extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  simulate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('simulate',input);}
}
export class NtplRenders extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class NtplInboxes extends SeventhService {
  previewDelivery(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('previewDelivery',input);}
  deliverLocal(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('deliverLocal',input);}
}
export class NtplChecks extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class NtplReleases extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class NtplExchange extends SeventhExchange {
}
export class NtplWorkbench extends SeventhService {
}
export class SchedlabSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class SchedlabCalendars extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class SchedlabClocks extends SeventhService {
  resolve(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('resolve',input);}
}
export class SchedlabRules extends SeventhService {
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('expand',input);}
}
export class SchedlabPolicies extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class SchedlabWorkloads extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class SchedlabScenarios extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class SchedlabSimulations extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class SchedlabHarness extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class SchedlabObservations extends SeventhService {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('capture',input);}
  readEvents(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('readEvents',input);}
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('coverage',input);}
}
export class SchedlabChecks extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class SchedlabReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class SchedlabExchange extends SeventhExchange {
}
export class SchedlabWorkbench extends SeventhService {
}
export class ExtforgeSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class ExtforgeSources extends SeventhService {
  override edit(input:any,...rest:any[]):Promise<any>{if(typeof input==='function')return super.edit(input,rest[0],rest[1]);return this.perform('edit',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class ExtforgeManifests extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ExtforgeInterfaces extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class ExtforgeToolchains extends SeventhService {
  importProfile(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('importProfile',input);}
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
}
export class ExtforgeBuilds extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class ExtforgeInspections extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class ExtforgeCases extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ExtforgeTrials extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class ExtforgeSignatures extends SeventhService {
  prepareEnvelope(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('prepareEnvelope',input);}
  importSignature(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('importSignature',input);}
  verify(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('verify',input);}
}
export class ExtforgeBundles extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ExtforgeReviews extends SeventhService {
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
}
export class ExtforgeReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
}
export class ExtforgeExchange extends SeventhExchange {
}
export class ExtforgeCatalogs extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
  exportCatalog(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('exportCatalog',input);}
}
export class ExtforgeWorkbench extends SeventhService {
}
export class DepsolveSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class DepsolveCatalogs extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class DepsolveRoots extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DepsolvePlatforms extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DepsolveConstraints extends SeventhService {
  compile(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compile',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class DepsolveCandidates extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class DepsolveSolves extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class DepsolveProofs extends SeventhService {
  checkAssignment(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkAssignment',input);}
  explainConflict(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explainConflict',input);}
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('coverage',input);}
}
export class DepsolveComparisons extends SeventhService {
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  annotate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('annotate',input);}
}
export class DepsolveLocks extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class DepsolveReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class DepsolveExchange extends SeventhExchange {
}
export class DepsolveWorkbench extends SeventhService {
}
export class ProtostateSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class ProtostateGrammars extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ProtostateMessages extends SeventhService {
  encode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('encode',input);}
  decode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decode',input);}
}
export class ProtostateMachines extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ProtostateGuards extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ProtostateScenarios extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class ProtostateGenerators extends SeventhService {
  define(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('define',input);}
  expand(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('expand',input);}
}
export class ProtostateTargets extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class ProtostateRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
}
export class ProtostateTraces extends SeventhService {
  decode(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('decode',input);}
  readFrames(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('readFrames',input);}
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('coverage',input);}
}
export class ProtostateProperties extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class ProtostateReductions extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  reduce(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('reduce',input);}
}
export class ProtostateReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class ProtostateExchange extends SeventhExchange {
}
export class ProtostateWorkbench extends SeventhService {
}
export class ReplabSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class ReplabSchemas extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ReplabReplicas extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ReplabOperations extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
}
export class ReplabClocks extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ReplabChannels extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ReplabPolicies extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class ReplabScenarios extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class ReplabRuns extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  run(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('run',input);}
}
export class ReplabConflicts extends SeventhService {
  inspect(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('inspect',input);}
  proposeResolution(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('proposeResolution',input);}
}
export class ReplabJudgments extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class ReplabReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class ReplabExchange extends SeventhExchange {
}
export class ReplabWorkbench extends SeventhService {
}
export class VirtserviceSpaces extends SeventhService {
  create(input:{name:string}):Promise<S.SuiteJson>{return this.perform('create',input);}
}
export class VirtserviceContracts extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtservicePayloads extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  pin(input:S.SuitePin){return this.get(input);}
}
export class VirtserviceMatchers extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtserviceStates extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtserviceTransitions extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtserviceFaults extends SeventhService {
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtserviceScenarios extends SeventhService {
  compose(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compose',input);}
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
}
export class VirtservicePackages extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  validate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('validate',input);}
}
export class VirtserviceSessions extends SeventhService {
  preview(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('preview',input);}
  start(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('start',input);}
  checkpoint(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('checkpoint',input);}
  fork(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('fork',input);}
}
export class VirtserviceTraffic extends SeventhService {
  capture(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('capture',input);}
  readRequests(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('readRequests',input);}
  coverage(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('coverage',input);}
}
export class VirtserviceAssertions extends SeventhService {
  evaluate(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('evaluate',input);}
  compare(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('compare',input);}
  explain(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('explain',input);}
}
export class VirtserviceReports extends SeventhService {
  assemble(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('assemble',input);}
  review(input:z.infer<typeof T.seventhAction> | S.SuiteApproval):Promise<S.SuiteJson>{return this.perform('review',input);}
}
export class VirtserviceExchange extends SeventhExchange {
}
export class VirtserviceWorkbench extends SeventhService {
}

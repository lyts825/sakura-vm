/** 事件领域每个插件拥有自己的记录和依赖；执行资源由 brokers 持有。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as E from '../../shared/contracts/event-lab.ts';
import type { ImageAsset } from '../../shared/contracts/image-assets.ts';
export interface EventContractsV1 extends S.SuiteMaterialsV1 {
  images(): Promise<ImageAsset[]>;
  upload(input: z.input<typeof E.eventUpload>): Promise<S.SuiteRecord>;
  validate(input: z.infer<typeof E.eventContractInput>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof E.eventCompare>): Promise<S.SuiteRecord>;
}
export interface EventFixturesV1 extends S.SuiteRecordsV1 {
  generate(input: z.infer<typeof E.eventGenerate>): Promise<S.SuiteRecord>;
  importRows(input: z.infer<typeof E.eventImportRows>): Promise<S.SuiteRecord>;
}
export interface EventProducersV1 extends S.SuiteRecordsV1 {
  compile(input: z.input<typeof E.eventProducerInput>): Promise<S.SuiteRecord>;
  previewMessages(input: S.SuiteScope & { producer: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EventConsumersV1 extends S.SuiteRecordsV1 {
  compile(input: z.input<typeof E.eventConsumerInput>): Promise<S.SuiteRecord>;
  validatePolicy(input: S.SuiteScope & { consumer: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EventScenariosV1 extends S.SuiteRecordsV1 {
  compile(input: z.infer<typeof E.eventScenarioInput>): Promise<S.SuiteRecord>;
  preview(input: S.SuiteScope & { scenario: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EventBrokersV1 extends S.SuiteRecordsV1 {
  prepare(input: z.infer<typeof E.eventPrepare>): Promise<S.SuiteRecord>;
  observe(input: S.SuiteScope & { broker: S.SuiteRef }): Promise<S.SuiteRecord>;
  planExecution(input: z.infer<typeof E.eventRunPreview>): Promise<S.SuitePlan>;
  submitExecution(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspectExecution(input: S.SuiteScope & { session: S.SuiteRef }): Promise<S.SuiteRecord>;
  stopExecution(input: S.SuiteScope & { session: S.SuiteRef }): Promise<S.SuiteRecord>;
  reconcileExecution(input: S.SuiteScope & { session: S.SuiteRef }): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
}
export interface EventRunsV1 extends S.SuiteRecordsV1 {
  preview(input: z.infer<typeof E.eventRunPreview>): Promise<S.SuitePlan>;
  start(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { run: S.SuiteRef }): Promise<S.SuiteRecord>;
  cancel(input: S.SuiteScope & { run: S.SuiteRef }): Promise<S.SuiteRecord>;
  reconcile(input: S.SuiteScope & { run: S.SuiteRef }): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
}
export interface EventAssertionsV1 extends S.SuiteRecordsV1 {
  evaluate(input: S.SuiteScope & { run: S.SuiteRef }): Promise<S.SuiteRecord>;
  explain(input: S.SuiteScope & { assertion: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EventReportsV1 extends S.SuiteRecordsV1 {
  sealReport(input: z.infer<typeof E.eventReportInput>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof E.eventCompare>): Promise<S.SuiteRecord>;
}
export interface EventExchangeV1 extends S.SuiteRecordsV1 {
  quarantines(input: S.SuiteScope): Promise<S.SuiteQuarantine[]>;
  previewQuarantineDiscard(input: S.SuiteScope & { targetWorkspaceId: string }): Promise<S.SuitePlan>;
  discardQuarantine(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewImportRecovery(input: S.SuiteScope & { receipt: S.SuiteRef }): Promise<S.SuitePlan>;
  recoverImport(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewExport(input: S.SuiteScope & { references: S.SuiteRef[] }): Promise<S.SuitePlan>;
  export(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  download(
    input: S.SuitePin & { offset: number; length: number },
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  beginImport(input: S.SuiteScope & { name: string; bytes: number; digest: string }): Promise<S.SuiteUpload>;
  appendImport(input: S.SuiteScope & { id: string; offset: number; data: string }): Promise<S.SuiteUpload>;
  transfers(input: S.SuiteScope): Promise<S.SuiteUpload[]>;
  discardImport(input: S.SuiteScope & { id: string }): Promise<S.SuiteUpload>;
  inspectImport(
    input: S.SuiteScope & { id: string },
  ): Promise<{ inspection: S.SuiteRecord; plan: S.SuitePlan }>;
  acceptImport(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  imports(input: S.SuiteScope): Promise<S.SuiteRecord[]>;
}
export interface EventWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<z.infer<typeof E.eventTemplate>[]>;
  createExample(input: z.infer<typeof E.eventExample>): Promise<z.infer<typeof E.eventExampleResult>>;
  view(input: z.input<typeof E.eventViewInput>): Promise<z.infer<typeof E.eventView>>;
}

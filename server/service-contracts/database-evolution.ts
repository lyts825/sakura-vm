/** 数据库演练的独立领域版本；执行票据只在原副本与运行器之间传递。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as D from '../../shared/contracts/database-evolution.ts';
export interface DatabaseSourcesV1 extends S.SuiteMaterialsV1 {
  upload(input: z.input<typeof D.databaseUpload>): Promise<S.SuiteRecord>;
  generate(input: z.input<typeof D.databaseGenerate>): Promise<S.SuiteRecord>;
  pin(input: z.infer<typeof D.databasePin>): Promise<S.SuiteRecord>;
  importRows(input: z.input<typeof D.databaseImportRows>): Promise<S.SuiteRecord>;
}
export interface DatabaseSchemasV1 extends S.SuiteRecordsV1 {
  validate(input: S.SuiteScope & { source: S.SuiteRef }): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof D.databaseCompare>): Promise<S.SuiteRecord>;
}
export interface DatabaseChangesV1 extends S.SuiteRecordsV1 {
  compile(input: z.infer<typeof D.databaseCompile>): Promise<S.SuiteRecord>;
  riskSummary(input: S.SuiteScope & { changes: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface DatabaseFixturesV1 extends S.SuiteRecordsV1 {
  cancel(input: S.SuiteScope & { fixture: S.SuiteRef }): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
  prepare(input: z.input<typeof D.databaseFixturePrepare>): Promise<S.SuitePlan>;
  checkpoint(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { fixture: S.SuiteRef }): Promise<S.SuiteRecord>;
  cleanupPreview(input: S.SuiteScope & { fixture: S.SuiteRef }): Promise<S.SuitePlan>;
  planExecution(input: z.infer<typeof D.databaseRunPreview>): Promise<S.SuitePlan>;
  submitExecution(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  planRestore(
    input: S.SuiteScope & { fixture: S.SuiteRef; image: { assetId: string; digest: string } },
  ): Promise<S.SuitePlan>;
  submitRestore(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  stopExecution(input: S.SuiteScope & { fixture: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface DatabaseRunnersV1 extends S.SuiteRecordsV1 {
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
  preview(input: z.infer<typeof D.databaseRunPreview>): Promise<S.SuitePlan>;
  execute(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspect(input: z.infer<typeof D.databaseRunAction>): Promise<S.SuiteRecord>;
  cancel(input: z.infer<typeof D.databaseRunAction>): Promise<S.SuiteRecord>;
  reconcile(input: z.infer<typeof D.databaseRunAction>): Promise<S.SuitePlan>;
  confirmReconcile(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewRestore(input: z.infer<typeof D.databaseRecovery>): Promise<S.SuitePlan>;
  restore(input: S.SuiteApproval): Promise<S.SuiteRecord>;
}
export interface DatabaseChecksV1 extends S.SuiteRecordsV1 {
  evaluate(input: z.infer<typeof D.databaseRunAction>): Promise<S.SuiteRecord>;
  explain(input: S.SuiteScope & { check: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface DatabaseRehearsalsV1 extends S.SuiteRecordsV1 {
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
  preview(input: z.infer<typeof D.databaseRunPreview>): Promise<S.SuitePlan>;
  start(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { rehearsal: S.SuiteRef }): Promise<S.SuiteRecord>;
  cancel(input: S.SuiteScope & { rehearsal: S.SuiteRef }): Promise<S.SuiteRecord>;
  recover(
    input: S.SuiteScope & { rehearsal: S.SuiteRef; image: { assetId: string; digest: string } },
  ): Promise<S.SuitePlan>;
  confirmRecovery(input: S.SuiteApproval): Promise<S.SuiteRecord>;
}
export interface DatabaseReportsV1 extends S.SuiteRecordsV1 {
  sealReport(input: z.infer<typeof D.databaseReportInput>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof D.databaseCompare>): Promise<S.SuiteRecord>;
}
export interface DatabaseExchangeV1 extends S.SuiteRecordsV1 {
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
export interface DatabaseWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<z.infer<typeof D.databaseWorkbenchTemplates>>;
  view(input: z.input<typeof D.databaseWorkbenchRequest>): Promise<z.infer<typeof D.databaseWorkbenchView>>;
}

import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as M from '../../shared/contracts/media-studio.ts';
export interface MediaSourcesV1 extends S.SuiteMaterialsV1 {
  pin(input: z.infer<typeof M.mediaPin>): Promise<S.SuiteRecord>;
  publishDerived(input: z.infer<typeof M.mediaDerived>): Promise<S.SuiteRecord>;
}
export interface MediaInspectV1 extends S.SuiteRecordsV1 {
  preview(input: z.infer<typeof M.mediaInspectPreview>): Promise<S.SuitePlan>;
  inspect(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  poll(input: z.infer<typeof M.mediaAction>): Promise<S.SuiteRecord>;
  cancel(input: z.infer<typeof M.mediaAction>): Promise<S.SuiteRecord>;
  reconcile(input: z.infer<typeof M.mediaAction>): Promise<S.SuitePlan>;
  confirmReconcile(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
}
export interface MediaRecipesV1 extends S.SuiteRecordsV1 {
  validate(
    input: z.infer<typeof M.mediaCompile>,
  ): Promise<{ valid: true; recipe: z.infer<typeof M.mediaRecipe> }>;
  compile(input: z.infer<typeof M.mediaCompile>): Promise<S.SuiteRecord>;
}
export interface MediaWorkersV1 extends S.SuiteRecordsV1 {
  preview(input: z.infer<typeof M.mediaRunPreview>): Promise<S.SuitePlan>;
  start(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  poll(input: z.infer<typeof M.mediaAction>): Promise<S.SuiteRecord>;
  publish(input: z.infer<typeof M.mediaAction>): Promise<S.SuiteRecord>;
  cancel(input: z.infer<typeof M.mediaAction>): Promise<S.SuiteRecord>;
  reconcile(input: z.infer<typeof M.mediaAction>): Promise<S.SuitePlan>;
  confirmReconcile(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
}
export interface MediaCaptionsV1 extends S.SuiteRecordsV1 {
  importText(input: z.infer<typeof M.mediaCaptionInput>): Promise<S.SuiteRecord>;
  validateTiming(
    input: z.infer<typeof M.mediaCaptionInput>,
  ): Promise<{ valid: true; cues: z.infer<typeof M.mediaCue>[] }>;
  exportText(input: S.SuiteScope & { caption: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface MediaCollectionsV1 extends S.SuiteRecordsV1 {
  assemble(input: z.infer<typeof M.mediaAssemble>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof M.mediaCompare>): Promise<S.SuiteRecord>;
}
export interface MediaReviewsV1 extends S.SuiteRecordsV1 {
  open(input: S.SuiteScope & { collection: S.SuiteRef }): Promise<S.SuiteRecord>;
  decide(input: z.infer<typeof M.mediaDecision>): Promise<S.SuiteRecord>;
  recheck(input: S.SuiteScope & { review: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface MediaExchangeV1 extends S.SuiteRecordsV1 {
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
export interface MediaWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<z.infer<typeof M.mediaTemplates>>;
  view(input: S.SuiteScope): Promise<z.infer<typeof M.mediaView>>;
}

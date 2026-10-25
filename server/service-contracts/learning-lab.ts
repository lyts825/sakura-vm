import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as L from '../../shared/contracts/learning-lab.ts';
import type * as H from '../../shared/contracts/learning-http.ts';
import type * as E from '../../shared/contracts/suite-execution.ts';
import type { ImageAsset } from '../../shared/contracts/image-assets.ts';
export interface LearningCoursesV1 extends S.SuiteWorkspacePortV1, S.SuiteRecordsV1 {
  create(
    i: z.infer<typeof L.learningCreateCourse>,
  ): Promise<{ workspace: S.SuiteWorkspace; course: S.SuiteRecord }>;
  sealCourse(i: z.infer<typeof L.learningSealCourse>): Promise<S.SuiteRecord>;
}
export interface LearningAssetsV1 extends S.SuiteByteMaterialsV1 {
  images(): Promise<ImageAsset[]>;
  upload(i: z.input<typeof L.learningUpload>): Promise<S.SuiteRecord>;
  pin(i: z.infer<typeof L.learningPinAsset>): Promise<S.SuiteRecord>;
  files(i: S.SuitePin): Promise<z.infer<typeof L.learningFiles>>;
}
export interface LearningLessonsV1 extends S.SuiteRecordsV1 {
  compile(i: z.infer<typeof L.learningCompileLesson>): Promise<S.SuiteRecord>;
}
export interface LearningEnvironmentsV1 extends S.SuiteRecordsV1 {
  prepare(i: z.infer<typeof L.learningPrepare>): Promise<S.SuiteRecord>;
  checkpoint(i: z.infer<typeof L.learningCheckpointInput>): Promise<S.SuiteRecord>;
  restore(i: z.infer<typeof L.learningRestore>): Promise<S.SuiteRecord>;
}
export interface LearningStepsV1 extends S.SuiteRecordsV1 {
  compile(i: z.input<typeof L.learningCompileSteps>): Promise<S.SuiteRecord>;
}
export interface LearningChecksV1 extends S.SuiteRecordsV1 {
  compile(i: z.infer<typeof L.learningCompileChecks>): Promise<S.SuiteRecord>;
  explain(i: S.SuitePin): Promise<S.SuiteRecord>;
}
export interface LearningSessionsV1 extends S.SuiteRecordsV1 {
  tool(): Promise<z.infer<typeof E.suiteExecutionTool>>;
  preview(i: z.infer<typeof L.learningPreview>): Promise<S.SuitePlan>;
  start(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewStep(i: z.infer<typeof L.learningStepInput>): Promise<S.SuitePlan>;
  step(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  discardPreview(i: S.SuiteApproval): Promise<S.SuitePlan>;
  inspect(i: z.infer<typeof L.learningSessionSelection>): Promise<S.SuiteRecord>;
  cancel(i: z.infer<typeof L.learningSessionSelection>): Promise<S.SuiteRecord>;
  reconcile(i: z.infer<typeof L.learningSessionSelection>): Promise<S.SuiteRecord>;
  pause(i: z.infer<typeof L.learningSessionSelection>): Promise<S.SuiteRecord>;
  resume(i: z.infer<typeof L.learningSessionSelection>): Promise<S.SuiteRecord>;
}
export interface LearningProgressV1 extends S.SuiteRecordsV1 {
  summarize(i: z.infer<typeof L.learningProgressInput>): Promise<S.SuiteRecord>;
  compare(i: z.infer<typeof L.learningCompare>): Promise<S.SuiteRecord>;
}
export interface LearningAssessmentsV1 extends S.SuiteRecordsV1 {
  assess(i: z.infer<typeof L.learningAssessmentInput>): Promise<S.SuiteRecord>;
  selfReview(i: z.infer<typeof L.learningSelfReview>): Promise<S.SuiteRecord>;
  sealAssessment(i: z.infer<typeof L.learningSealAssessment>): Promise<S.SuiteRecord>;
}
export interface LearningExchangeV1 extends S.SuiteRecordsV1 {
  quarantines(i: S.SuiteScope): Promise<S.SuiteQuarantine[]>;
  previewQuarantineDiscard(i: S.SuiteScope & { targetWorkspaceId: string }): Promise<S.SuitePlan>;
  discardQuarantine(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewImportRecovery(i: S.SuiteScope & { receipt: S.SuiteRef }): Promise<S.SuitePlan>;
  recoverImport(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewExport(i: S.SuiteScope & { references: S.SuiteRef[] }): Promise<S.SuitePlan>;
  export(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  download(
    i: S.SuitePin & { offset: number; length: number },
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  beginImport(i: S.SuiteScope & { name: string; bytes: number; digest: string }): Promise<S.SuiteUpload>;
  appendImport(i: S.SuiteScope & { id: string; offset: number; data: string }): Promise<S.SuiteUpload>;
  transfers(i: S.SuiteScope): Promise<S.SuiteUpload[]>;
  discardImport(i: S.SuiteScope & { id: string }): Promise<S.SuiteUpload>;
  inspectImport(i: S.SuiteScope & { id: string }): Promise<{ inspection: S.SuiteRecord; plan: S.SuitePlan }>;
  acceptImport(i: S.SuiteApproval): Promise<S.SuiteRecord>;
  imports(i: S.SuiteScope): Promise<S.SuiteRecord[]>;
}
export interface LearningWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<z.infer<typeof H.learningTemplate>[]>;
  createExample(i: z.infer<typeof L.learningExampleInput>): Promise<z.infer<typeof H.learningExample>>;
  view(i: z.infer<typeof H.learningViewInput>): Promise<z.infer<typeof H.learningView>>;
}

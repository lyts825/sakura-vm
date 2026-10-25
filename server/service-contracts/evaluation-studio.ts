import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as E from '../../shared/contracts/evaluation-studio.ts';
import type * as C from '../../shared/contracts/evaluation-calls.ts';
export interface EvaluationDatasetsV1 extends S.SuiteMaterialsV1 {
  upload(input: S.SuiteScope & { name: string; text: string; allowExport: boolean }): Promise<S.SuiteRecord>;
  pin(input: z.input<typeof E.evaluationPin>): Promise<S.SuiteRecord>;
  split(input: z.input<typeof E.evaluationSplit>): Promise<S.SuiteRecord>;
  allowSending(input: z.input<typeof E.evaluationSending>): Promise<S.SuiteRecord>;
  authorizeSend(input: S.SuiteScope & { dataset: S.SuiteRef }): Promise<void>;
}
export interface EvaluationPromptsV1 extends S.SuiteRecordsV1 {
  compile(input: z.input<typeof E.evaluationCompile>): Promise<S.SuiteRecord>;
  renderPreview(
    input: S.SuiteScope & { prompt: S.SuiteRef; cursor?: number; limit?: number },
  ): Promise<{
    total: number;
    items: { sampleId: string; prompt: string; digest: string }[];
    next: number | null;
  }>;
}
export interface EvaluationEndpointsV1 extends S.SuiteRecordsV1 {
  register(input: z.input<typeof E.evaluationRegister>): Promise<S.SuiteRecord>;
  previewConnection(input: S.SuiteScope & { endpoint: S.SuiteRef }): Promise<S.SuitePlan>;
  check(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  revoke(input: S.SuiteScope & { endpoint: S.SuiteRef }): Promise<S.SuiteRecord>;
  authorizeCall(
    input: S.SuiteScope & { endpoint: S.SuiteRef },
  ): Promise<{
    target: C.EvaluationTarget;
    connection: C.EvaluationConnection | null;
    bearer: string | null;
  }>;
}
export interface EvaluationRunnersV1 extends S.SuiteRecordsV1 {
  importOutputs(input: z.input<typeof E.evaluationImportOutputs>): Promise<S.SuiteRecord>;
  preview(input: z.input<typeof E.evaluationPreview>): Promise<S.SuitePlan>;
  start(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  inspect(input: z.input<typeof E.evaluationRunKey>): Promise<S.SuiteRecord>;
  cancel(input: z.input<typeof E.evaluationRunKey>): Promise<S.SuiteRecord>;
  reconcile(input: z.input<typeof E.evaluationRunKey>): Promise<S.SuiteRecord>;
}
export interface EvaluationScorersV1 extends S.SuiteRecordsV1 {
  evaluate(input: z.input<typeof E.evaluationEvaluate>): Promise<S.SuiteRecord>;
  scoreHuman(input: z.input<typeof E.evaluationHuman>): Promise<S.SuiteRecord>;
  planJudge(input: z.input<typeof E.evaluationJudge>): Promise<S.SuitePlan>;
  applyJudge(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  cancelJudge(input: z.input<typeof E.evaluationRunKey>): Promise<S.SuiteRecord>;
}
export interface EvaluationComparisonsV1 extends S.SuiteRecordsV1 {
  compare(input: z.input<typeof E.evaluationCompare>): Promise<S.SuiteRecord>;
  explain(input: S.SuiteScope & { comparison: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EvaluationReviewsV1 extends S.SuiteRecordsV1 {
  open(input: z.input<typeof E.evaluationReviewOpen>): Promise<S.SuiteRecord>;
  score(input: z.input<typeof E.evaluationReviewDecide>): Promise<S.SuiteRecord>;
  decide(input: z.input<typeof E.evaluationReviewDecide>): Promise<S.SuiteRecord>;
}
export interface EvaluationReportsV1 extends S.SuiteRecordsV1 {
  sealReport(input: z.input<typeof E.evaluationReportSeal>): Promise<S.SuiteRecord>;
  compare(input: S.SuiteScope & { before: S.SuiteRef; after: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface EvaluationExchangeV1 extends S.SuiteRecordsV1 {
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
export interface EvaluationWorkbenchV1 extends S.SuiteRecordsV1 {
  view(
    input: z.input<typeof E.evaluationWorkbenchRequest>,
  ): Promise<z.infer<typeof E.evaluationWorkbenchView>>;
  templates(): Promise<z.infer<typeof E.evaluationTemplate>[]>;
}

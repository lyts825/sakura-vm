import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as F from '../../shared/contracts/flow-studio.ts';
import type {
  DelegatedInput,
  DelegatedPlan,
  DelegatedTicket,
  DelegatedReceipt,
  DelegatedIntent,
} from '../../shared/contracts/delegated-actions.ts';
export interface FlowDefinitionsV1 extends S.SuiteWorkspacePortV1, S.SuiteRecordsV1 {
  compile(input: z.input<typeof F.flowCompile>): Promise<S.SuiteRecord>;
  validate(input: S.SuiteScope & { definition: S.SuiteRef }): Promise<{ valid: true; order: string[] }>;
}
export interface FlowInputsV1 extends S.SuiteByteMaterialsV1 {
  upload(input: S.SuiteScope & { name: string; text: string; allowExport: boolean }): Promise<S.SuiteRecord>;
  bind(input: z.input<typeof F.flowBind>): Promise<S.SuiteRecord>;
  resolve(
    input: S.SuiteScope & { inputs: S.SuiteRef; name: string },
  ): Promise<{ value: string | number | boolean | null; digest: string }>;
}
export interface FlowConnectorsV1 extends S.SuiteRecordsV1 {
  catalogue(): Promise<{ adapter: string; available: boolean; description: string }[]>;
  inspectProvider(input: { target: DelegatedInput }): Promise<{ available: boolean; adapter: string }>;
  preview(input: { target: DelegatedInput }): Promise<DelegatedPlan>;
  dispatch(
    input: { ticket: DelegatedTicket },
    commit: (plan: DelegatedPlan) => Promise<DelegatedIntent>,
  ): Promise<DelegatedReceipt>;
  inspect(input: { ticket: DelegatedTicket }): Promise<DelegatedReceipt>;
  cancel(input: { ticket: DelegatedTicket }): Promise<DelegatedReceipt>;
  reconcile(input: { ticket: DelegatedTicket }): Promise<DelegatedReceipt>;
}
export interface FlowPlansV1 extends S.SuiteRecordsV1 {
  previewFlow(input: z.input<typeof F.flowPreview>): Promise<S.SuiteRecord>;
  previewStep(input: z.input<typeof F.flowStepReady>, authorize: () => Promise<void>): Promise<S.SuiteRecord>;
  invalidate(input: S.SuiteScope & { plan: S.SuiteRef }): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { plan: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface FlowApprovalsV1 extends S.SuiteRecordsV1 {
  approve(input: z.input<typeof F.flowApprove>): Promise<S.SuiteRecord>;
  revoke(input: z.input<typeof F.flowRevoke>): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { approval: S.SuiteRef }): Promise<S.SuiteRecord>;
  claim(input: z.input<typeof F.flowClaim>): Promise<S.SuiteRecord>;
}
export interface FlowJournalV1 extends S.SuiteRecordsV1 {
  append(input: z.input<typeof F.flowAppend>): Promise<S.SuiteRecord>;
  readTimeline(
    input: S.SuiteScope & { runId: string; cursor?: number; limit?: number },
  ): Promise<S.SuitePage>;
  verify(
    input: S.SuiteScope & { runId: string },
  ): Promise<{ valid: true; events: number; tail: string | null }>;
}
export interface FlowRunsV1 extends S.SuiteRecordsV1 {
  start(input: S.SuiteScope & { plan: S.SuiteRef }): Promise<S.SuiteRecord>;
  inspect(input: z.input<typeof F.flowRunKey>): Promise<S.SuiteRecord>;
  previewStep(input: z.input<typeof F.flowNodeKey>): Promise<S.SuiteRecord>;
  advance(input: z.input<typeof F.flowAdvance>): Promise<S.SuiteRecord>;
  cancel(input: z.input<typeof F.flowRunKey>): Promise<S.SuiteRecord>;
  reconcile(input: z.input<typeof F.flowNodeKey>): Promise<S.SuiteRecord>;
  wake(input: z.input<typeof F.flowWake>): Promise<S.SuiteRecord>;
}
export interface FlowTimersV1 extends S.SuiteRecordsV1 {
  scheduleWait(input: z.input<typeof F.flowWait>): Promise<S.SuiteRecord>;
  due(input: S.SuiteScope): Promise<{ timer: S.SuiteRecord; due: boolean }[]>;
  release(input: S.SuiteScope & { timer: S.SuiteRef }): Promise<S.SuiteRecord>;
  cancelWait(input: S.SuiteScope & { timer: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface FlowExchangeV1 extends S.SuiteRecordsV1 {
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
export interface FlowWorkbenchV1 extends S.SuiteRecordsV1 {
  view(input: z.input<typeof F.flowViewRequest>): Promise<z.infer<typeof F.flowView>>;
  templates(): Promise<z.infer<typeof F.flowTemplate>[]>;
}

/** 事件复盘实施中的领域声明；通过各插件装配后才成为可调用服务。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as I from '../../shared/contracts/incident-desk.ts';
import type * as A from '../../shared/contracts/incident-actions.ts';
import type * as M from '../../shared/contracts/incident-materials.ts';
import type * as C from '../../shared/contracts/incident-snapshots.ts';
import type { DelegatedReceipt, DelegatedAdapter } from '../../shared/contracts/delegated-actions.ts';

export interface IncidentCasesV1 extends S.SuiteWorkspacePortV1, S.SuiteRecordsV1 {
  open(input: z.infer<typeof I.incidentCaseInput>): Promise<{ workspace: S.SuiteWorkspace; case: S.SuiteRecord }>;
  scope(input: S.SuiteScope): Promise<S.SuiteRecord>;
  reviseScope(input: z.infer<typeof I.incidentCaseRevision>): Promise<S.SuiteRecord>;
  resolve(input: z.infer<typeof I.incidentResolve>): Promise<S.SuiteRecord>;
  reopen(input: Omit<z.infer<typeof I.incidentResolve>, 'unresolved'>): Promise<S.SuiteRecord>;
  withOpenCase(input: S.SuiteScope & { expected: S.SuiteRef }, work: () => Promise<S.SuiteJson>): Promise<S.SuiteJson>;
}
export interface IncidentEvidenceV1 extends S.SuiteByteMaterialsV1 {
  upload(input: z.input<typeof I.incidentUpload>): Promise<S.SuiteRecord>;
  attach(input: z.input<typeof I.incidentAttach>): Promise<S.SuiteRecord>;
  pin(input: S.SuitePin): Promise<S.SuiteRecord>;
  observe(input: z.input<typeof M.incidentObservationInput>): Promise<S.SuiteRecord>;
  redact(input: z.infer<typeof I.incidentRedact>): Promise<S.SuiteRecord>;
  planRedactionReview(input: z.infer<typeof M.incidentRedactionReviewInput>): Promise<S.SuitePlan>;
  reviewRedaction(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  redactionStatus(input: S.SuitePin): Promise<{ reviewed: boolean; exportGranted: boolean; effective: boolean }>;
  captureSources(): Promise<{ kind: 'metrics' | 'health'; available: boolean }[]>;
  planCapture(input: z.infer<typeof C.incidentCaptureInput>): Promise<S.SuitePlan>;
  capture(input: S.SuiteApproval): Promise<S.SuiteRecord>;
}
export interface IncidentTimelineV1 extends S.SuiteRecordsV1 {
  assemble(input: z.infer<typeof I.incidentAssemble>): Promise<S.SuiteRecord>;
  annotateClock(input: S.SuiteScope & { timeline: S.SuiteRef; note: z.infer<typeof I.incidentClockNote> }): Promise<S.SuiteRecord>;
  compare(input: S.SuiteScope & { before: S.SuiteRef; after: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface IncidentHypothesesV1 extends S.SuiteRecordsV1 {
  propose(input: z.infer<typeof I.incidentHypothesisInput>): Promise<S.SuiteRecord>;
  linkEvidence(input: S.SuiteScope & { hypothesis: S.SuiteRef; support: string[]; against: string[] }): Promise<S.SuiteRecord>;
  decide(input: S.SuiteScope & { hypothesis: S.SuiteRef; status: 'supported' | 'contradicted' | 'unresolved'; reason: string }): Promise<S.SuiteRecord>;
}
export interface IncidentRunbooksV1 extends S.SuiteRecordsV1 {
  compile(input: z.infer<typeof I.incidentRunbookInput>): Promise<S.SuiteRecord>;
  previewSteps(input: S.SuiteScope & { runbook: S.SuiteRef }): Promise<S.SuiteRecord>;
}
export interface IncidentActionsV1 extends S.SuiteRecordsV1 {
  providers(): Promise<{ adapter: DelegatedAdapter; available: boolean }[]>;
  planAction(input: z.infer<typeof A.incidentPlanAction>): Promise<S.SuitePlan>;
  submitAction(input: S.SuiteApproval, signal?: AbortSignal): Promise<S.SuiteRecord>;
  inspect(input: S.SuiteScope & { action: S.SuiteRef }): Promise<{ record: S.SuiteRecord; provider: DelegatedReceipt | null; providerAvailable: boolean }>;
  recordManual(input: z.infer<typeof A.incidentManualActionInput>): Promise<S.SuiteRecord>;
}

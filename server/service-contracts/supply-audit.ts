/** 软件供应审查的独立服务声明；内部容量与接收端口不直接开放 HTTP。 */
import type { z } from 'zod';
import type * as A from '../../shared/contracts/supply-audit.ts';
import type { ProjectCaptureRequest } from '../../shared/contracts/files-capture.ts';
import type {
  SuiteMaterialsV1,
  SuiteRecordsV1,
  SuiteScope,
  SuitePin,
  SuiteRef,
  SuiteRecord,
  SuitePlan,
  SuiteApproval,
  SuiteWorkspace,
  SuiteUpload,
  SuiteQuarantine,
} from '../../shared/contracts/suite-common.ts';
export interface SupplySourcesV1 extends SuiteMaterialsV1 {
  upload(input: z.input<typeof A.supplyUploadText>): Promise<SuiteRecord>;
  pin(input: SuitePin): Promise<SuiteRecord>;
  planCapture(
    input: SuiteScope & { request: ProjectCaptureRequest; allowExport?: boolean },
  ): Promise<SuitePlan>;
  capture(input: SuiteApproval): Promise<SuiteRecord[]>;
}
export interface SupplyInventoryV1 extends SuiteRecordsV1 {
  parse(input: z.infer<typeof A.supplyInput>): Promise<SuiteRecord>;
  compare(input: z.infer<typeof A.supplyCompare>): Promise<SuiteRecord>;
}
export interface SupplyAdvisoriesV1 extends SuiteRecordsV1 {
  importDataset(input: z.infer<typeof A.supplyInput>): Promise<SuiteRecord>;
  match(input: z.infer<typeof A.supplyMatch>): Promise<SuiteRecord>;
  freshness(
    input: SuiteScope & { dataset: SuiteRef },
  ): Promise<{ collectedAt: string; ageSeconds: number; sourceAuthenticated: boolean }>;
}
export interface SupplyLicensesV1 extends SuiteRecordsV1 {
  classify(input: SuiteScope & { inventory: SuiteRef }): Promise<SuiteRecord>;
  reviewExpression(
    input: SuiteScope & { inventory: SuiteRef; expression: string; note: string; acceptedForUse: boolean },
  ): Promise<SuiteRecord>;
}
export interface SupplyProvenanceV1 extends SuiteRecordsV1 {
  inspect(input: SuiteScope & { inventory: SuiteRef }): Promise<SuiteRecord>;
  verify(input: z.infer<typeof A.supplyProvenanceInput>): Promise<SuiteRecord>;
}
export interface SupplyPoliciesV1 extends SuiteRecordsV1 {
  evaluate(input: z.infer<typeof A.supplyEvaluate>): Promise<SuiteRecord>;
  explain(input: z.infer<typeof A.supplyExplanation>): Promise<SuiteRecord>;
}
export interface SupplyReviewsV1 extends SuiteRecordsV1 {
  open(input: z.infer<typeof A.supplyReviewOpen>): Promise<SuiteRecord>;
  decide(input: z.infer<typeof A.supplyReviewDecision>): Promise<SuiteRecord>;
  recheck(
    input: SuiteScope & { review: SuiteRef },
  ): Promise<{ valid: boolean; expired: string[]; reviewer: string; singleOwnerReview: boolean }>;
}
export interface SupplyReportsV1 extends SuiteRecordsV1 {
  seal(input: SuitePin | z.infer<typeof A.supplySeal>): Promise<SuiteRecord>;
  compare(input: z.infer<typeof A.supplyCompare>): Promise<SuiteRecord>;
}
export interface SupplyExchangeV1 extends SuiteRecordsV1 {
  quarantines(input: SuiteScope): Promise<SuiteQuarantine[]>;
  previewQuarantineDiscard(input: SuiteScope & { targetWorkspaceId: string }): Promise<SuitePlan>;
  discardQuarantine(input: SuiteApproval): Promise<SuiteRecord>;
  previewImportRecovery(input: SuiteScope & { receipt: SuiteRef }): Promise<SuitePlan>;
  recoverImport(input: SuiteApproval): Promise<SuiteRecord>;
  previewExport(input: SuiteScope & { references: SuiteRef[] }): Promise<SuitePlan>;
  export(input: SuiteApproval): Promise<SuiteRecord>;
  download(
    input: SuitePin & { offset: number; length: number },
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  beginImport(input: SuiteScope & { name: string; bytes: number; digest: string }): Promise<SuiteUpload>;
  appendImport(input: SuiteScope & { id: string; offset: number; data: string }): Promise<SuiteUpload>;
  transfers(input: SuiteScope): Promise<SuiteUpload[]>;
  discardImport(input: SuiteScope & { id: string }): Promise<SuiteUpload>;
  inspectImport(input: SuiteScope & { id: string }): Promise<{ inspection: SuiteRecord; plan: SuitePlan }>;
  acceptImport(input: SuiteApproval): Promise<SuiteRecord>;
  imports(input: SuiteScope): Promise<SuiteRecord[]>;
}
export interface SupplyWorkbenchV1 extends SuiteRecordsV1 {
  templates(): Promise<{ id: string; name: string; description: string }[]>;
  createExample(input: {
    name: string;
    template: 'npm-lock' | 'python-lock' | 'advisory-update';
  }): Promise<{ workspace: SuiteWorkspace; example: SuiteRecord }>;
  runChecks(
    input: SuiteScope & { source: SuiteRef; advisorySource: SuiteRef; policy: SuiteRef },
  ): Promise<{ run: SuiteRecord; evaluation: SuiteRecord; review: SuiteRecord }>;
  view(input: { workspaceId?: string }): Promise<{
    workspaces: SuiteWorkspace[];
    workspace: SuiteWorkspace | null;
    capacity: { used: number; reserved: number; limit: number; metadataLimit: number } | null;
    domains: { id: string; records: SuiteRecord[]; error: string | null }[];
  }>;
}

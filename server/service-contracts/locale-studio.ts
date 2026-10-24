/** 本地化领域的版本服务；记忆登记仅供原审阅提供者调用。 */
import type { z } from 'zod';
import type * as L from '../../shared/contracts/locale-studio.ts';
import type { ProjectCaptureRequest } from '../../shared/contracts/files-capture.ts';
import type {
  SuiteScope,
  SuitePin,
  SuiteRef,
  SuiteRecord,
  SuitePlan,
  SuiteApproval,
  SuiteWorkspace,
  SuiteMaterialsV1,
  SuiteRecordsV1,
  SuiteUpload,
  SuiteQuarantine,
} from '../../shared/contracts/suite-common.ts';
export interface LocaleCatalogsV1 extends SuiteMaterialsV1 {
  upload(input: SuiteScope & { name: string; text: string; allowExport?: boolean }): Promise<SuiteRecord>;
  importJson(input: z.infer<typeof L.localeImport>): Promise<SuiteRecord>;
  compare(input: z.infer<typeof L.localeCompare>): Promise<SuiteRecord>;
  planCapture(
    input: SuiteScope & { request: ProjectCaptureRequest; allowExport?: boolean },
  ): Promise<SuitePlan>;
  capture(input: SuiteApproval): Promise<SuiteRecord[]>;
}
export interface LocaleContextsV1 extends SuiteRecordsV1 {
  attach(input: z.infer<typeof L.localeContextAttach>): Promise<SuiteRecord>;
  inspect(input: SuiteScope & { contexts: SuiteRef }): Promise<SuiteRecord>;
}
export interface LocaleTerminologyV1 extends SuiteRecordsV1 {
  validate(input: SuiteScope & { terminology: SuiteRef }): Promise<{ valid: boolean; conflicts: string[] }>;
  lookup(
    input: SuiteScope & { terminology: SuiteRef; text: string },
  ): Promise<z.infer<typeof L.localeTerm>[]>;
}
export interface LocaleTranslationsV1 extends SuiteRecordsV1 {
  applyDelta(input: z.input<typeof L.localeDelta>): Promise<SuiteRecord>;
  revise(input: z.infer<typeof L.localeRevise>): Promise<SuiteRecord>;
  markStale(input: SuiteScope & { translation: SuiteRef; catalog: SuiteRef }): Promise<SuiteRecord>;
  remember(input: z.infer<typeof L.localeMemoryInput>): Promise<SuiteRecord>;
  suggestFromMemory(
    input: SuiteScope & { catalog: SuiteRef; terminology: SuiteRef; language: string; keys: string[] },
  ): Promise<{
    language: string;
    candidates: {
      key: string;
      text: string;
      translation: SuiteRef;
      reviewReceipt: SuiteRef;
      acceptedAutomatically: false;
    }[];
    provenance: 'local-single-owner-review';
  }>;
}
export interface LocaleChecksV1 extends SuiteRecordsV1 {
  evaluate(input: z.infer<typeof L.localeCheckInput>): Promise<SuiteRecord>;
  explain(input: SuiteScope & { check: SuiteRef; key?: string }): Promise<{
    total: number;
    translated: number;
    result: 'passed' | 'failed';
    findings: z.infer<typeof L.localeFinding>[];
  }>;
}
export interface LocalePreviewsV1 extends SuiteRecordsV1 {
  render(input: z.input<typeof L.localePreviewInput>): Promise<SuiteRecord>;
  compare(input: z.infer<typeof L.localeCompare>): Promise<SuiteRecord>;
}
export interface LocaleReviewsV1 extends SuiteRecordsV1 {
  open(input: z.infer<typeof L.localeReviewOpen>): Promise<SuiteRecord>;
  decide(input: z.infer<typeof L.localeDecision>): Promise<SuiteRecord>;
  recheck(
    input: SuiteScope & { review: SuiteRef },
  ): Promise<{ valid: boolean; reviewer: string; singleOwnerReview: true }>;
}
export interface LocaleReleasesV1 extends SuiteRecordsV1 {
  active(input: SuiteScope): Promise<SuiteRecord | null>;
  preview(input: z.infer<typeof L.localeReleaseInput>): Promise<SuitePlan>;
  publishLocal(input: SuiteApproval): Promise<SuiteRecord>;
  previewRollback(input: SuiteScope & { release: SuiteRef }): Promise<SuitePlan>;
  rollback(input: SuiteApproval): Promise<SuiteRecord>;
  makePatch(input: SuiteScope & { release: SuiteRef }): Promise<SuiteRecord>;
}
export interface LocaleExchangeV1 extends SuiteRecordsV1 {
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
export interface LocaleWorkbenchV1 extends SuiteRecordsV1 {
  templates(): Promise<{ id: string; name: string; description: string }[]>;
  createExample(input: {
    name: string;
    template: 'app-text' | 'error-messages' | 'source-update';
  }): Promise<{ workspace: SuiteWorkspace; example: SuiteRecord }>;
  runChecks(
    input: SuiteScope & {
      catalog: SuiteRef;
      translation: SuiteRef;
      width?: '320' | '768' | '1280';
      pseudo?: boolean;
    },
  ): Promise<{ run: SuiteRecord; check: SuiteRecord; preview: SuiteRecord; review: SuiteRecord }>;
  view(input: { workspaceId?: string }): Promise<{
    workspaces: SuiteWorkspace[];
    workspace: SuiteWorkspace | null;
    capacity: { used: number; reserved: number; limit: number; metadataLimit: number } | null;
    domains: { id: string; records: SuiteRecord[]; error: string | null }[];
  }>;
}

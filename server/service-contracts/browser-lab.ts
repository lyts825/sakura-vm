/** 浏览器十个领域的独立版本服务；实际执行由固定本体会话提供。 */
import type { z } from 'zod';
import type * as S from '../../shared/contracts/suite-common.ts';
import type * as B from '../../shared/contracts/browser-lab.ts';
import type * as E from '../../shared/contracts/suite-execution.ts';
import type { ImageAsset } from '../../shared/contracts/image-assets.ts';
export interface BrowserTargetsV1 extends S.SuiteMaterialsV1 {
  images(): Promise<ImageAsset[]>;
  upload(
    input: S.SuiteScope & { name: string; site: z.infer<typeof B.browserSite>; allowExport?: boolean },
  ): Promise<S.SuiteRecord>;
  pin(input: z.infer<typeof B.browserTargetInput>): Promise<S.SuiteRecord>;
  resolve(input: S.SuitePin): Promise<S.SuiteRecord>;
  publishArtifact(
    input: S.SuiteScope & {
      source: S.SuiteRef;
      name: string;
      data: string;
      digest: string;
      allowExport: boolean;
    },
  ): Promise<S.SuiteRecord>;
}
export interface BrowserFixturesV1 extends S.SuiteRecordsV1 {
  generate(input: z.infer<typeof B.browserFixtureInput>): Promise<S.SuiteRecord>;
  validate(input: S.SuitePin): Promise<S.SuiteRecord>;
}
export interface BrowserJourneysV1 extends S.SuiteRecordsV1 {
  compile(input: z.infer<typeof B.browserCompile>): Promise<S.SuiteRecord>;
  previewSteps(input: S.SuitePin): Promise<S.SuiteRecord>;
}
export interface BrowserRunnersV1 extends S.SuiteRecordsV1 {
  tool(): Promise<z.infer<typeof E.suiteExecutionTool>>;
  preview(input: z.input<typeof B.browserRunInput>): Promise<S.SuitePlan>;
  start(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  discardPreview(input: S.SuiteApproval): Promise<S.SuitePlan>;
  inspect(input: z.infer<typeof B.browserRunSelect>): Promise<S.SuiteRecord>;
  cancel(input: z.infer<typeof B.browserRunSelect>): Promise<E.SuiteExecutionReceipt>;
  reconcile(input: z.infer<typeof B.browserRunSelect>): Promise<E.SuiteExecutionReceipt>;
}
export interface BrowserAssertionsV1 extends S.SuiteRecordsV1 {
  evaluate(input: z.infer<typeof B.browserRunSelect>): Promise<S.SuiteRecord>;
  explain(input: S.SuitePin): Promise<S.SuiteRecord>;
}
export interface BrowserVisualV1 extends S.SuiteRecordsV1 {
  proposeBaseline(input: z.infer<typeof B.browserBaselineInput>): Promise<S.SuiteRecord>;
  acceptBaseline(input: z.infer<typeof B.browserBaselineDecision>): Promise<S.SuiteRecord>;
  active(input: S.SuiteScope & { journey: S.SuiteRef }): Promise<S.SuiteRecord | null>;
  compare(input: z.infer<typeof B.browserRunSelect>): Promise<S.SuiteRecord>;
}
export interface BrowserAccessibilityV1 extends S.SuiteRecordsV1 {
  evaluate(input: z.infer<typeof B.browserRunSelect>): Promise<S.SuiteRecord>;
  review(input: z.infer<typeof B.browserReviewInput>): Promise<S.SuiteRecord>;
}
export interface BrowserReportsV1 extends S.SuiteRecordsV1 {
  seal(input: S.SuitePin | z.infer<typeof B.browserReportInput>): Promise<S.SuiteRecord>;
  compare(input: z.infer<typeof B.browserCompare>): Promise<S.SuiteRecord>;
}
export interface BrowserExchangeV1 extends S.SuiteRecordsV1 {
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
export interface BrowserWorkbenchV1 extends S.SuiteRecordsV1 {
  templates(): Promise<
    {
      id: string;
      name: string;
      description: string;
      site: z.infer<typeof B.browserSite>;
      fixture: z.infer<typeof B.browserFixtureData>;
      journey: z.infer<typeof B.browserJourneyDefinition>;
    }[]
  >;
  createExample(input: {
    name: string;
    template: 'form-submit' | 'responsive-navigation' | 'visual-change';
    image: z.infer<typeof B.browserTarget>['image'];
  }): Promise<{
    workspace: S.SuiteWorkspace;
    source: S.SuiteRecord;
    target: S.SuiteRecord;
    fixture: S.SuiteRecord;
    journey: S.SuiteRecord;
  }>;
  view(input: {
    workspaceId?: string;
    cursor?: number;
    limit?: number;
    history?: boolean;
  }): Promise<{
    workspaces: S.SuiteWorkspace[];
    workspace: S.SuiteWorkspace | null;
    domains: { id: string; records: S.SuiteRecord[]; next: number | null }[];
  }>;
}

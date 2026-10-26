/** 第七批独立64MiB交换合同；旧套件默认16MiB保持原样。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { suiteExchangeMethods, suiteMethod, suiteEmpty } from './suite-http.ts';
export const SEVENTH_BUNDLE_LIMIT = 64 * 1024 ** 2;
export const seventhAcceptPreview = S.suiteScope.extend({ inspection: S.suiteRef }).strict();
export const seventhExchangeView = S.suiteScope;
export const seventhExchangeMethods = () => ({
  ...suiteExchangeMethods(),
  beginImport: suiteMethod(
    S.suiteScope
      .extend({
        name: S.suiteName,
        bytes: z.number().int().positive().max(SEVENTH_BUNDLE_LIMIT),
        digest: S.suiteDigest,
      })
      .strict(),
    S.suiteUpload,
  ),
  previewAccept: suiteMethod(seventhAcceptPreview, S.suitePlan),
  templates: suiteMethod(suiteEmpty, S.suiteJson, true),
  view: suiteMethod(seventhExchangeView, S.suiteJson, true),
});
/** 新接口单独登记，不改变任何旧包的独立V1公开面。 */
export interface SeventhExchangeV1 extends S.SuiteRecordsV1 {
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
  previewAccept(input: z.infer<typeof seventhAcceptPreview>): Promise<S.SuitePlan>;
  acceptImport(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  imports(input: S.SuiteScope): Promise<S.SuiteRecord[]>;
  quarantines(input: S.SuiteScope): Promise<S.SuiteQuarantine[]>;
  previewQuarantineDiscard(input: S.SuiteScope & { targetWorkspaceId: string }): Promise<S.SuitePlan>;
  discardQuarantine(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  previewImportRecovery(input: S.SuiteScope & { receipt: S.SuiteRef }): Promise<S.SuitePlan>;
  recoverImport(input: S.SuiteApproval): Promise<S.SuiteRecord>;
  templates(input: Record<string, never>): Promise<S.SuiteJson>;
  view(input: S.SuiteScope): Promise<S.SuiteJson>;
}

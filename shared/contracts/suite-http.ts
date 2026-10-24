/** 领域共用的记录、材料和交换线路；内部委派与容量端口不在此公开。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
export const suiteMethod = (request: z.ZodType, response: z.ZodType, read = false) => ({
  request,
  response,
  read,
});
export const suiteEmpty = z.object({}).strict();
export const suiteCapacity = z
  .object({
    used: z.number().int().min(0),
    reserved: z.number().int().min(0),
    limit: z.number().int().positive(),
    metadataLimit: z.number().int().positive(),
  })
  .strict();
export const suiteChunk = z
  .object({ data: z.string().max(700000), offset: z.number().int().min(0), eof: z.boolean() })
  .strict();
export const suiteChunkInput = S.suiteScope
  .extend({ id: S.suiteId, offset: z.number().int().min(0), data: z.string().max(700000) })
  .strict();
export const suiteReadInput = S.suitePin
  .extend({
    offset: z.number().int().min(0),
    length: z
      .number()
      .int()
      .positive()
      .max(512 * 1024),
  })
  .strict();
export const suiteControls = (definition?: z.ZodType) => ({
  list: suiteMethod(S.suiteList, S.suitePage, true),
  get: suiteMethod(S.suitePin, S.suiteRecord, true),
  archive: suiteMethod(S.suitePin, S.suiteRecord),
  references: suiteMethod(S.suitePin, z.object({ holders: z.array(z.string()).max(100000) }).strict(), true),
  previewCleanup: suiteMethod(
    S.suiteScope.extend({ references: z.array(S.suiteRef).min(1).max(50) }).strict(),
    S.suitePlan,
  ),
  cleanup: suiteMethod(S.suiteApproval, S.suiteRecord),
  inspectPlan: suiteMethod(S.suiteScope.extend({ planId: S.suiteId }).strict(), S.suitePlan, true),
  previewRecovery: suiteMethod(S.suiteScope.extend({ planId: S.suiteId }).strict(), S.suitePlan),
  ...(definition
    ? {
        save: suiteMethod(S.suiteSave.extend({ content: definition }).strict(), S.suiteRecord),
        seal: suiteMethod(S.suitePin, S.suiteRecord),
      }
    : {}),
});
export const suiteMaterialMethods = () => ({
  ...suiteControls(),
  createWorkspace: suiteMethod(z.object({ name: S.suiteName }).strict(), S.suiteWorkspace),
  listWorkspaces: suiteMethod(suiteEmpty, z.array(S.suiteWorkspace).max(50), true),
  workspace: suiteMethod(S.suiteScope, S.suiteWorkspace, true),
  revokeWorkspace: suiteMethod(
    S.suiteScope.extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() }).strict(),
    S.suiteWorkspace,
  ),
  capacity: suiteMethod(S.suiteScope, suiteCapacity, true),
  policy: suiteMethod(
    S.suitePin,
    z
      .object({ allowRead: z.boolean(), allowExport: z.boolean(), revision: z.number().int().positive() })
      .strict(),
    true,
  ),
  beginUpload: suiteMethod(S.suiteUploadInput, S.suiteUpload),
  appendUpload: suiteMethod(suiteChunkInput, S.suiteUpload),
  finishUpload: suiteMethod(S.suiteScope.extend({ id: S.suiteId }).strict(), S.suiteRecord),
  uploads: suiteMethod(S.suiteScope, z.array(S.suiteUpload).max(10000), true),
  discardUpload: suiteMethod(S.suiteScope.extend({ id: S.suiteId }).strict(), S.suiteUpload),
  openRead: suiteMethod(
    S.suitePin.extend({ purpose: z.enum(['read', 'export']).optional() }).strict(),
    S.suiteReadLease,
  ),
  readLease: suiteMethod(
    S.suiteScope
      .extend({
        id: S.suiteId,
        offset: z.number().int().min(0),
        length: z
          .number()
          .int()
          .positive()
          .max(512 * 1024),
      })
      .strict(),
    suiteChunk,
    true,
  ),
  closeRead: suiteMethod(S.suiteScope.extend({ id: S.suiteId }).strict(), S.suiteReadLease),
  readSource: suiteMethod(
    suiteReadInput.extend({ purpose: z.enum(['read', 'export']).optional() }).strict(),
    suiteChunk,
    true,
  ),
  planPolicy: suiteMethod(
    S.suitePin
      .extend({
        expectedPolicyRevision: z.number().int().positive(),
        allowRead: z.boolean(),
        allowExport: z.boolean(),
      })
      .strict(),
    S.suitePlan,
  ),
  applyPolicy: suiteMethod(S.suiteApproval, S.suiteRecord),
});
export const suiteExchangeMethods = () => ({
  ...suiteControls(),
  previewExport: suiteMethod(
    S.suiteScope.extend({ references: z.array(S.suiteRef).min(1).max(100) }).strict(),
    S.suitePlan,
  ),
  export: suiteMethod(S.suiteApproval, S.suiteRecord),
  download: suiteMethod(suiteReadInput, suiteChunk, true),
  beginImport: suiteMethod(
    S.suiteScope
      .extend({
        name: S.suiteName,
        bytes: z
          .number()
          .int()
          .positive()
          .max(16 * 1024 ** 2),
        digest: S.suiteDigest,
      })
      .strict(),
    S.suiteUpload,
  ),
  appendImport: suiteMethod(suiteChunkInput, S.suiteUpload),
  transfers: suiteMethod(S.suiteScope, z.array(S.suiteUpload).max(10000), true),
  discardImport: suiteMethod(S.suiteScope.extend({ id: S.suiteId }).strict(), S.suiteUpload),
  inspectImport: suiteMethod(
    S.suiteScope.extend({ id: S.suiteId }).strict(),
    z.object({ inspection: S.suiteRecord, plan: S.suitePlan }).strict(),
  ),
  acceptImport: suiteMethod(S.suiteApproval, S.suiteRecord),
  imports: suiteMethod(S.suiteScope, z.array(S.suiteRecord).max(100), true),
});

/** 供应审查逐方法 HTTP 契约；内部引用、容量和导入回调不注册为路由。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as A from './supply-audit.ts';
import { captureRequestSchema } from './files-capture.ts';
const method = (request: z.ZodType, response: z.ZodType, read = false) => ({ request, response, read });
const empty = z.object({}).strict(),
  record = S.suiteRecord,
  ref = S.suiteRef,
  scope = S.suiteScope;
const inventory = scope.extend({ inventory: ref }).strict(),
  query = scope.extend({ reference: ref }).strict();
const controls = (definition?: z.ZodType) => ({
  publications: method(S.suitePublicationList, S.suitePublicationPage, true),
  previewPublicationRecovery: method(scope.extend({ id: S.suiteId }).strict(), S.suitePlan),
  recoverPublication: method(S.suiteApproval, record),
  list: method(S.suiteList, S.suitePage, true),
  get: method(S.suitePin, record, true),
  archive: method(S.suitePin, record),
  references: method(S.suitePin, z.object({ holders: z.array(z.string()).max(100000) }).strict(), true),
  previewCleanup: method(scope.extend({ references: z.array(ref).min(1).max(50) }).strict(), S.suitePlan),
  cleanup: method(S.suiteApproval, record),
  inspectPlan: method(scope.extend({ planId: S.suiteId }).strict(), S.suitePlan, true),
  previewRecovery: method(scope.extend({ planId: S.suiteId }).strict(), S.suitePlan),
  ...(definition
    ? {
        save: method(S.suiteSave.extend({ content: definition }).strict(), record),
        seal: method(S.suitePin, record),
      }
    : {}),
});
const capacity = z
  .object({
    used: z.number().int().min(0),
    reserved: z.number().int().min(0),
    limit: z.number().int().positive(),
    metadataLimit: z.number().int().positive(),
  })
  .strict();
const chunk = z
  .object({ data: z.string().max(700000), offset: z.number().int().min(0), eof: z.boolean() })
  .strict();
const chunkInput = scope
  .extend({ id: S.suiteId, offset: z.number().int().min(0), data: z.string().max(700000) })
  .strict();
export const supplyHttpSchemas = {
  sources: {
    ...controls(),
    createWorkspace: method(z.object({ name: S.suiteName }).strict(), S.suiteWorkspace),
    listWorkspaces: method(empty, z.array(S.suiteWorkspace).max(50), true),
    workspace: method(scope, S.suiteWorkspace, true),
    revokeWorkspace: method(
      scope.extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() }).strict(),
      S.suiteWorkspace,
    ),
    capacity: method(scope, capacity, true),
    policy: method(
      S.suitePin,
      z
        .object({ allowRead: z.boolean(), allowExport: z.boolean(), revision: z.number().int().positive() })
        .strict(),
      true,
    ),
    upload: method(A.supplyUploadText, record),
    pin: method(S.suitePin, record, true),
    beginUpload: method(S.suiteUploadInput, S.suiteUpload),
    appendUpload: method(chunkInput, S.suiteUpload),
    finishUpload: method(scope.extend({ id: S.suiteId }).strict(), record),
    discardUpload: method(scope.extend({ id: S.suiteId }).strict(), S.suiteUpload),
    openRead: method(
      S.suitePin.extend({ purpose: z.enum(['read', 'export']).optional() }).strict(),
      S.suiteReadLease,
    ),
    readLease: method(
      scope
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
      chunk,
      true,
    ),
    closeRead: method(scope.extend({ id: S.suiteId }).strict(), S.suiteReadLease),
    uploads: method(scope, z.array(S.suiteUpload).max(10000), true),
    readSource: method(
      S.suitePin
        .extend({
          offset: z.number().int().min(0),
          length: z
            .number()
            .int()
            .positive()
            .max(512 * 1024),
          purpose: z.enum(['read', 'export']).optional(),
        })
        .strict(),
      chunk,
      true,
    ),
    planPolicy: method(
      S.suitePin
        .extend({
          expectedPolicyRevision: z.number().int().positive(),
          allowRead: z.boolean(),
          allowExport: z.boolean(),
        })
        .strict(),
      S.suitePlan,
    ),
    applyPolicy: method(S.suiteApproval, record),
    planCapture: method(
      scope.extend({ request: captureRequestSchema, allowExport: z.boolean().optional() }).strict(),
      S.suitePlan,
    ),
    capture: method(S.suiteApproval, z.array(record).max(2000)),
  },
  inventory: {
    ...controls(),
    parse: method(A.supplyInput, record),
    compare: method(A.supplyCompare, record),
  },
  advisories: {
    ...controls(),
    importDataset: method(A.supplyInput, record),
    match: method(A.supplyMatch, record),
    freshness: method(
      scope.extend({ dataset: ref }).strict(),
      z
        .object({
          collectedAt: z.iso.datetime(),
          ageSeconds: z.number().min(0),
          sourceAuthenticated: z.boolean(),
        })
        .strict(),
      true,
    ),
  },
  licenses: {
    ...controls(),
    classify: method(inventory, record),
    reviewExpression: method(
      inventory
        .extend({
          expression: z.string().min(1).max(512),
          note: z.string().min(1).max(4000),
          acceptedForUse: z.boolean(),
        })
        .strict(),
      record,
    ),
  },
  provenance: {
    ...controls(A.supplyTrust),
    inspect: method(inventory, record),
    verify: method(A.supplyProvenanceInput, record),
  },
  policies: {
    ...controls(A.supplyPolicy),
    evaluate: method(A.supplyEvaluate, record),
    explain: method(query, record, true),
  },
  reviews: {
    ...controls(),
    open: method(A.supplyReviewOpen, record),
    decide: method(A.supplyReviewDecision, record),
    recheck: method(
      scope.extend({ review: ref }).strict(),
      z
        .object({
          valid: z.boolean(),
          expired: z.array(S.suiteDigest).max(1000),
          reviewer: z.string(),
          singleOwnerReview: z.boolean(),
        })
        .strict(),
      true,
    ),
  },
  reports: { ...controls(), seal: method(A.supplySeal, record), compare: method(A.supplyCompare, record) },
  exchange: {
    ...controls(),
    previewExport: method(scope.extend({ references: z.array(ref).min(1).max(1000) }).strict(), S.suitePlan),
    export: method(S.suiteApproval, record),
    download: method(
      S.suitePin
        .extend({
          offset: z.number().int().min(0),
          length: z
            .number()
            .int()
            .positive()
            .max(512 * 1024),
        })
        .strict(),
      chunk,
      true,
    ),
    beginImport: method(
      scope
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
    appendImport: method(chunkInput, S.suiteUpload),
    transfers: method(scope, z.array(S.suiteUpload).max(10000), true),
    discardImport: method(scope.extend({ id: S.suiteId }).strict(), S.suiteUpload),
    inspectImport: method(
      scope.extend({ id: S.suiteId }).strict(),
      z.object({ inspection: record, plan: S.suitePlan }).strict(),
    ),
    acceptImport: method(S.suiteApproval, record),
    imports: method(scope, z.array(record).max(100), true),
  },
  workbench: {
    ...controls(),
    templates: method(
      empty,
      z.array(z.object({ id: z.string(), name: z.string(), description: z.string() }).strict()).max(10),
      true,
    ),
    createExample: method(
      z
        .object({ name: S.suiteName, template: z.enum(['npm-lock', 'python-lock', 'advisory-update']) })
        .strict(),
      z.object({ workspace: S.suiteWorkspace, example: record }).strict(),
    ),
    runChecks: method(
      scope.extend({ source: ref, advisorySource: ref, policy: ref }).strict(),
      z.object({ run: record, evaluation: record, review: record }).strict(),
    ),
    view: method(
      z.object({ workspaceId: S.suiteId.optional() }).strict(),
      z
        .object({
          workspaces: z.array(S.suiteWorkspace).max(50),
          workspace: S.suiteWorkspace.nullable(),
          capacity: capacity.nullable(),
          domains: z
            .array(
              z
                .object({ id: z.string(), records: z.array(record).max(10), error: z.string().nullable() })
                .strict(),
            )
            .max(9),
        })
        .strict(),
      true,
    ),
  },
} as const;
export type SupplyDomain = keyof typeof supplyHttpSchemas;
export const supplyMethodPath = (method: string) =>
  method.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
export { supplyRoutes, supplyHttp } from './supply-routes.generated.ts';
export const supplyHttpRequests = Object.fromEntries(
  Object.entries(supplyHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, contract]) => [`supply-${domain}.${method}`, contract.request]),
  ),
);
export const supplyHttpResponses = Object.fromEntries(
  Object.entries(supplyHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, contract]) => [`supply-${domain}.${method}`, contract.response]),
  ),
);

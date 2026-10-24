/** 第三批领域共用的固定修订、材料及计划协议，不包含资源实现。 */
import { z } from 'zod';

export type SuiteJson = null | boolean | number | string | SuiteJson[] | { [key: string]: SuiteJson };
export function isSuiteJsonBounded(value: unknown, maxDepth = 24): value is SuiteJson {
  let nodes = 0;
  function inspect(item: unknown, depth: number): boolean {
    if (++nodes > 2000000 || depth > maxDepth) return false;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') return item.length <= 2 * 1024 ** 2;
    if (Array.isArray(item)) return item.length <= 100000 && item.every((v) => inspect(v, depth + 1));
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      const entries = Object.entries(item);
      return (
        entries.length <= 50000 &&
        entries.every(
          ([key, v]) =>
            key.length <= 512 &&
            !['__proto__', 'prototype', 'constructor'].includes(key) &&
            inspect(v, depth + 1),
        )
      );
    }
    return item === null || typeof item === 'boolean';
  }
  return inspect(value, 0);
}
export const suiteJson: z.ZodType<SuiteJson> = z.json().superRefine((value, context) => {
  if (!isSuiteJsonBounded(value)) context.addIssue({ code: 'custom', message: '内容结构或深度超出限制' });
});
export const suiteId = z.uuid();
export const suiteDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const suiteName = z.string().trim().min(1).max(160);
export const suiteScope = z.object({ workspaceId: suiteId }).strict();
export type SuiteScope = z.infer<typeof suiteScope>;
export const suiteRef = z
  .object({ domain: z.string().regex(/^[a-z]+-[a-z-]+$/), id: suiteId, revision: suiteDigest })
  .strict();
export type SuiteRef = z.infer<typeof suiteRef>;
export const suitePin = suiteScope.extend({ id: suiteId, revision: suiteDigest }).strict();
export type SuitePin = z.infer<typeof suitePin>;
export const suiteWorkspace = z
  .object({
    id: suiteId,
    name: suiteName,
    owner: suiteId,
    createdAt: z.iso.datetime(),
    revoked: z.boolean(),
    policyRevision: z.number().int().positive(),
    quarantined: z.boolean(),
  })
  .strict();
export type SuiteWorkspace = z.infer<typeof suiteWorkspace>;
export const suiteRecord = z
  .object({
    id: suiteId,
    workspaceId: suiteId,
    domain: suiteRef.shape.domain,
    name: suiteName,
    sequence: z.number().int().positive(),
    revision: suiteDigest,
    parent: suiteDigest.nullable(),
    actor: suiteId,
    createdAt: z.iso.datetime(),
    state: z.enum(['draft', 'sealed', 'archived']),
    kind: z.enum(['definition', 'source', 'result', 'review', 'import']),
    origin: z.enum(['local', 'imported']),
    content: suiteJson,
    references: z.array(suiteRef).max(1000),
    policyRevision: z.number().int().positive(),
    authorizationDigest: suiteDigest.optional(),
  })
  .strict();
export type SuiteRecord = z.infer<typeof suiteRecord>;
export const suiteSave = suiteScope
  .extend({
    id: suiteId.optional(),
    expectedRevision: suiteDigest.optional(),
    name: suiteName,
    content: suiteJson,
    references: z.array(suiteRef).max(1000).default([]),
  })
  .strict();
export type SuiteSave = z.infer<typeof suiteSave>;
export const suiteList = suiteScope
  .extend({
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
    history: z.boolean().default(false),
    archived: z.boolean().default(false),
  })
  .strict();
export const suitePage = z
  .object({ items: z.array(suiteRecord).max(100), next: z.number().int().min(0).nullable() })
  .strict();
export type SuitePage = z.infer<typeof suitePage>;
export const suitePlan = z
  .object({
    id: suiteId,
    workspaceId: suiteId,
    actor: suiteId,
    binding: z.string().min(1),
    action: z.string().min(1).max(100),
    input: suiteJson,
    references: z.array(suiteRef).max(1000),
    digest: suiteDigest,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    workspacePolicyRevision: z.number().int().positive(),
    permissions: z
      .array(
        z
          .object({ ref: suiteRef, policyRevision: z.number().int().positive(), policyDigest: suiteDigest })
          .strict(),
      )
      .max(1000),
    state: z.enum(['ready', 'consumed', 'completed', 'failed']),
    result: suiteRef.nullable(),
  })
  .strict();
export type SuitePlan = z.infer<typeof suitePlan>;
export const suiteApproval = suiteScope.extend({ planId: suiteId, digest: suiteDigest }).strict();
export type SuiteApproval = z.infer<typeof suiteApproval>;
export const suiteQuota = z
  .object({
    id: suiteId,
    workspaceId: suiteId,
    consumer: z.string(),
    bytes: z.number().int().min(0),
    kind: z.enum(['metadata', 'material', 'temporary']),
    slot: z.string().nullable().default(null),
    payloadDigest: suiteDigest.nullable().default(null),
    sequence: z.number().int().min(0).default(0),
    state: z.enum(['reserved', 'committed', 'released']),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type SuiteQuota = z.infer<typeof suiteQuota>;
export type SuiteReservation = SuiteScope & {
  bytes: number;
  kind: SuiteQuota['kind'];
  slot?: string;
  payloadDigest?: string;
};
export type SuiteSettlement = SuiteScope & {
  id: string;
  release?: boolean;
  actualBytes?: number;
  payloadDigest?: string;
};
export interface SuiteRecordsV1 {
  list(input: z.input<typeof suiteList>): Promise<SuitePage>;
  get(input: SuitePin): Promise<SuiteRecord>;
  save(input: SuiteSave): Promise<SuiteRecord>;
  seal(input: SuitePin): Promise<SuiteRecord>;
  archive(input: SuitePin): Promise<SuiteRecord>;
  retain(input: SuitePin & { holder: string; release?: boolean }): Promise<{ holders: string[] }>;
  references(input: SuitePin): Promise<{ holders: string[] }>;
  previewCleanup(input: SuiteScope & { references: SuiteRef[] }): Promise<SuitePlan>;
  cleanup(input: SuiteApproval): Promise<SuiteRecord>;
  inspectPlan(input: SuiteScope & { planId: string }): Promise<SuitePlan>;
  previewRecovery(input: SuiteScope & { planId: string }): Promise<SuitePlan>;
  importRecord(
    input: SuiteScope & {
      name: string;
      kind: 'definition' | 'result' | 'review' | 'import';
      content: SuiteJson;
      references: SuiteRef[];
    },
  ): Promise<SuiteRecord>;
}
export interface SuiteWorkspacePortV1 {
  createWorkspace(input: { name: string }): Promise<SuiteWorkspace>;
  listWorkspaces(): Promise<SuiteWorkspace[]>;
  workspace(input: SuiteScope): Promise<SuiteWorkspace>;
  revokeWorkspace(
    input: SuiteScope & { expectedRevision: number; revoked: boolean },
  ): Promise<SuiteWorkspace>;
  reserve(input: SuiteReservation): Promise<SuiteQuota>;
  settle(input: SuiteSettlement): Promise<SuiteQuota>;
  reconcileMetadata(
    input: SuiteScope & { slot: string; payloadDigest: string; bytes: number },
  ): Promise<{ reconciled: number }>;
  capacity(
    input: SuiteScope,
  ): Promise<{ used: number; reserved: number; limit: number; metadataLimit: number }>;
  acceptWorkspace(
    input: { name: string },
    work: (scope: SuiteScope) => Promise<SuiteJson>,
  ): Promise<{ workspace: SuiteWorkspace; result: SuiteJson }>;
}
export const suiteUploadInput = suiteScope
  .extend({
    name: suiteName,
    format: z.enum(['json', 'csv', 'text', 'png', 'jpeg', 'webp', 'wav', 'mp4', 'site', 'image', 'bundle']),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(2 * 1024 ** 3),
    digest: suiteDigest,
    allowExport: z.boolean().default(false),
    sourceId: suiteId.optional(),
    expectedRevision: suiteDigest.optional(),
  })
  .strict();
export const suiteUpload = suiteUploadInput
  .extend({
    id: suiteId,
    actor: suiteId,
    offset: z.number().int().min(0),
    state: z.enum(['uploading', 'ready', 'unknown', 'discarded']),
    reservationId: suiteId,
    source: suiteRef.nullable(),
    createdAt: z.iso.datetime(),
    identity: z
      .object({
        ino: z.string(),
        dev: z.string(),
        bytes: z.number().int().min(0),
        mtimeMs: z.number(),
        ctimeMs: z.number(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type SuiteUpload = z.infer<typeof suiteUpload>;
export const suiteReadLease = z
  .object({
    id: suiteId,
    workspaceId: suiteId,
    actor: suiteId,
    binding: z.string().min(1),
    reference: suiteRef,
    purpose: z.enum(['read', 'export']),
    policyRevision: z.number().int().positive(),
    workspacePolicyRevision: z.number().int().positive().default(1),
    expiresAt: z.iso.datetime(),
    state: z.enum(['active', 'released']),
  })
  .strict();
export type SuiteReadLease = z.infer<typeof suiteReadLease>;
export const suiteMaterial = z
  .object({
    blobId: suiteId,
    bytes: z.number().int().min(0),
    digest: suiteDigest,
    format: z.string(),
    allowRead: z.boolean(),
    allowExport: z.boolean(),
  })
  .strict();
export interface SuiteMaterialsV1 extends SuiteWorkspacePortV1, SuiteRecordsV1 {
  policy(input: SuitePin): Promise<{ allowRead: boolean; allowExport: boolean; revision: number }>;
  beginUpload(input: z.input<typeof suiteUploadInput>): Promise<SuiteUpload>;
  appendUpload(input: SuiteScope & { id: string; offset: number; data: string }): Promise<SuiteUpload>;
  finishUpload(input: SuiteScope & { id: string }): Promise<SuiteRecord>;
  uploads(input: SuiteScope): Promise<SuiteUpload[]>;
  discardUpload(input: SuiteScope & { id: string }): Promise<SuiteUpload>;
  openRead(input: SuitePin & { purpose?: 'read' | 'export' }): Promise<SuiteReadLease>;
  readLease(
    input: SuiteScope & { id: string; offset: number; length: number },
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  closeRead(input: SuiteScope & { id: string }): Promise<SuiteReadLease>;
  readSource(
    input: SuitePin & { offset: number; length: number; purpose?: 'read' | 'export' },
  ): Promise<{ data: string; offset: number; eof: boolean }>;
  planPolicy(
    input: SuitePin & { expectedPolicyRevision: number; allowRead: boolean; allowExport: boolean },
  ): Promise<SuitePlan>;
  applyPolicy(input: SuiteApproval): Promise<SuiteRecord>;
}

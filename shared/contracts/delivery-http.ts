/** 交付插件的线路输入输出，供服务端、生成契约及浏览器共同校验。 */
import { z } from 'zod';
import {
  deliveryCandidateSchema,
  deliveryDefinitionSchema,
  deliveryDigestSchema,
  deliveryFileSchema,
  deliveryManifestSchema,
  deliveryReportFormatSchema,
} from './delivery-common.ts';
import {
  deliveryCleanupPlanSchema,
  deliveryInputPlanSchema,
  deliveryInputSchema,
  deliveryUploadSchema,
} from './delivery-storage.ts';
import { deliveryPreviewSchema, deliveryRunSchema, deliveryRunRequestSchema } from './delivery-execution.ts';
import {
  deliveryDecisionSchema,
  deliveryEvaluateSchema,
  deliveryEvidenceSchema,
  deliveryPolicyInputSchema,
  deliveryPolicySchema,
  deliveryReleaseViewSchema,
  deliveryReleaseSchema,
  deliveryChannelSchema,
  deliveryTrustKeySchema,
  deliveryImportSchema,
} from './delivery-quality.ts';
import {
  deliveryDefinitionRecordSchema,
  deliveryDefinitionSaveSchema,
  deliveryWorkbenchSchema,
} from './delivery-workbench.ts';
const id = z.uuid();
/** 只接受动作及准确记录 ID。 Accept only the action and exact record ID. */
const actionId = <T extends string>(action: T) => z.object({ action: z.literal(action), id }).strict();
export const deliveryArtifactActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('begin'),
      sha256: deliveryDigestSchema,
      bytes: z
        .number()
        .int()
        .min(0)
        .max(2 ** 30),
    })
    .strict(),
  z
    .object({
      action: z.literal('chunk'),
      id,
      offset: z.number().int().nonnegative(),
      data: z.string().max(700000),
    })
    .strict(),
  actionId('complete'),
  actionId('open-read'),
  z.object({ action: z.literal('close-read'), token: id }).strict(),
  z
    .object({
      action: z.literal('read'),
      blobId: deliveryDigestSchema,
      offset: z.number().int().nonnegative(),
      length: z.number().int().min(1).max(524288),
    })
    .strict(),
  z
    .object({
      action: z.literal('seal'),
      label: z.string().min(1).max(160),
      kind: z.enum(['source', 'output', 'report', 'import']),
      files: z.array(deliveryFileSchema).max(10000),
    })
    .strict(),
  actionId('verify'),
  z.object({ action: z.literal('cleanup-plan') }).strict(),
  z.object({ action: z.literal('cleanup'), token: id }).strict(),
]);
export const deliveryInputActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('preview'),
      definition: deliveryDefinitionSchema,
      reviewedDraft: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal('capture'), token: id }).strict(),
  z.object({ action: z.literal('compare'), leftId: id, rightId: id }).strict(),
]);
export const deliveryRunnerActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), input: deliveryRunRequestSchema }).strict(),
  actionId('cancel'),
  actionId('recover'),
]);
export const deliveryPreviewActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      candidate: deliveryCandidateSchema,
      lifetimeMinutes: z.number().int().min(1).max(1440),
      reviewed: z.literal(true),
    })
    .strict(),
  actionId('health'),
  actionId('stop'),
  actionId('recover'),
]);
export const deliveryReportActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ingest'),
      candidate: deliveryCandidateSchema,
      runId: id,
      manifestId: id,
      path: z.string().min(1).max(1024),
      format: deliveryReportFormatSchema,
    })
    .strict(),
  z.object({ action: z.literal('compare'), leftId: id, rightId: id }).strict(),
]);
export const deliveryGateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('policy'), input: deliveryPolicyInputSchema }).strict(),
  z.object({ action: z.literal('evaluate'), input: deliveryEvaluateSchema }).strict(),
]);
export const deliveryWorkbenchActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), input: deliveryDefinitionSaveSchema }).strict(),
  actionId('copy'),
  z.object({ action: z.literal('archive'), id, expectedRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('preview-import'), text: z.string().max(1024 * 1024) }).strict(),
]);
const inputComparison = z
  .object({
    added: z.array(z.string()),
    removed: z.array(z.string()),
    changed: z.array(z.string()),
    definitionChanged: z.boolean(),
  })
  .strict();
export const deliveryArtifactResultSchema = z.union([
  deliveryUploadSchema,
  deliveryManifestSchema,
  deliveryCleanupPlanSchema,
  z.object({ token: id, expiresAt: z.iso.datetime() }).strict(),
  z.object({ closed: z.literal(true) }).strict(),
  z.object({ offset: z.number().int() }).strict(),
  z.object({ blobId: z.string(), sha256: deliveryDigestSchema, bytes: z.number().int() }).strict(),
  z
    .object({ data: z.string(), offset: z.number().int(), eof: z.boolean(), sha256: deliveryDigestSchema })
    .strict(),
  z.object({ verified: z.literal(true), digest: deliveryDigestSchema }).strict(),
  z.object({ manifests: z.number().int(), blobs: z.number().int(), bytes: z.number().int() }).strict(),
]);
export const deliveryInputResultSchema = z.union([
  deliveryInputPlanSchema,
  deliveryInputSchema,
  inputComparison,
]);
export const deliveryReportResultSchema = z.union([
  deliveryEvidenceSchema,
  z.object({ comparable: z.boolean(), reason: z.string(), changePercent: z.number().nullable() }).strict(),
]);
export const deliveryGateViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    policies: z.array(deliveryPolicySchema),
    decisions: z.array(deliveryDecisionSchema),
  })
  .strict();
export const deliveryGateResultSchema = z.union([deliveryPolicySchema, deliveryDecisionSchema]);
export const deliveryWorkbenchResultSchema = z.union([
  deliveryDefinitionRecordSchema,
  deliveryDefinitionSchema,
]);
export const deliveryReleaseActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('candidate'), inputId: id, runId: id, manifestId: id }).strict(),
  z
    .object({
      action: z.literal('register'),
      candidateId: id,
      decisionId: id,
      namespace: z.string().min(1).max(200),
      version: z.string().max(80),
      notes: z.string().max(32000),
    })
    .strict(),
  z
    .object({
      action: z.literal('channel'),
      name: z.enum(['candidate', 'stable']),
      expectedRevision: z.number().int().nonnegative(),
      releaseId: id.nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal('status'),
      id,
      status: z.enum(['withdrawn', 'archived']),
      reason: z.string().min(5).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal('trust'),
      expectedRevision: z.number().int().nonnegative(),
      id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
      publisher: z.string().min(1).max(200).optional(),
      publicKey: z.string().max(8192).optional(),
      revoke: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('export'),
      id,
      includeSource: z.boolean(),
      signingKeyRef: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ action: z.literal('import'), manifestId: id }).strict(),
  z
    .object({
      action: z.literal('accept'),
      id,
      namespace: z.string().min(1).max(200),
      allowUntrusted: z.boolean(),
      reviewed: z.literal(true),
    })
    .strict(),
]);
export const deliveryExportResultSchema = z
  .object({
    manifest: deliveryManifestSchema,
    packageDigest: deliveryDigestSchema,
    releaseCoreDigest: deliveryDigestSchema,
    signed: z.boolean(),
  })
  .strict();
export const deliveryReleaseResultSchema = z.union([
  deliveryCandidateSchema,
  deliveryReleaseSchema,
  deliveryChannelSchema,
  deliveryImportSchema,
  deliveryExportResultSchema,
  z.object({ revision: z.number().int().nonnegative(), keys: z.array(deliveryTrustKeySchema) }).strict(),
]);
export const deliveryHttpRequests = {
  'delivery-artifacts.act': deliveryArtifactActionSchema,
  'delivery-inputs.act': deliveryInputActionSchema,
  'delivery-runners.act': deliveryRunnerActionSchema,
  'delivery-previews.act': deliveryPreviewActionSchema,
  'delivery-reports.act': deliveryReportActionSchema,
  'delivery-gates.act': deliveryGateActionSchema,
  'delivery-workbench.act': deliveryWorkbenchActionSchema,
  'delivery-releases.act': deliveryReleaseActionSchema,
};
/** 将领域 DTO 绑定 JSON 响应线路。 Bind a domain DTO to its JSON response contract. */
const json = (schema: z.ZodType) => ({
  kind: 'json' as const,
  statuses: [200],
  media: 'application/json',
  schema,
});
export const deliveryHttpResponses = {
  'delivery-artifacts.view': json(z.array(deliveryManifestSchema)),
  'delivery-artifacts.act': json(deliveryArtifactResultSchema),
  'delivery-inputs.view': json(z.array(deliveryInputSchema)),
  'delivery-inputs.act': json(deliveryInputResultSchema),
  'delivery-runners.view': json(z.array(deliveryRunSchema)),
  'delivery-runners.act': json(deliveryRunSchema),
  'delivery-previews.view': json(z.array(deliveryPreviewSchema)),
  'delivery-previews.act': json(deliveryPreviewSchema),
  'delivery-reports.view': json(z.array(deliveryEvidenceSchema)),
  'delivery-reports.act': json(deliveryReportResultSchema),
  'delivery-gates.view': json(deliveryGateViewSchema),
  'delivery-gates.act': json(deliveryGateResultSchema),
  'delivery-workbench.view': json(deliveryWorkbenchSchema),
  'delivery-workbench.act': json(deliveryWorkbenchResultSchema),
  'delivery-releases.view': json(deliveryReleaseViewSchema),
  'delivery-releases.act': json(deliveryReleaseResultSchema),
};

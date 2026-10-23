/** 交付证据、门禁与本地版本的公开数据。 Public delivery evidence, gates and local releases. */
import { z } from 'zod';
import {
  deliveryCandidateSchema,
  deliveryDigestSchema,
  deliveryReportFormatSchema,
  deliveryScopeSchema,
} from './delivery-common.ts';
export const deliveryEvidenceSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    candidateDigest: deliveryDigestSchema,
    runId: z.uuid(),
    manifestId: z.uuid(),
    path: z.string(),
    rawDigest: deliveryDigestSchema,
    format: deliveryReportFormatSchema,
    parserVersion: z.literal(1),
    status: z.enum(['passed', 'failed', 'missing', 'malformed', 'truncated', 'cancelled', 'unknown']),
    external: z.boolean(),
    tests: z.number().int().nonnegative(),
    failures: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(100).nullable(),
    diagnostics: z
      .array(z.object({ severity: z.enum(['error', 'warning', 'info']), message: z.string() }))
      .max(1000),
    benchmark: z
      .object({
        tool: z.string(),
        environment: z.string(),
        inputClass: z.string(),
        samplesMs: z.array(z.number().nonnegative()).max(10000),
      })
      .nullable(),
    detail: z.string(),
    createdAt: z.iso.datetime(),
    digest: deliveryDigestSchema,
  })
  .strict();
export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;
export const deliveryPolicyInputSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    kind: z.enum(['build', 'import-acceptance']).default('build'),
    requireTests: z.boolean().default(true),
    minCoverage: z.number().min(0).max(100).default(0),
    requireEnvironment: z.boolean().default(true),
    maxAgeHours: z.number().min(0.01).max(8760).default(24),
    manualReview: z.boolean().default(true),
    requiredSteps: z.array(z.string().min(1).max(64)).max(20).default([]),
    requirePreview: z.boolean().default(false),
    requireTrusted: z.boolean().default(false),
  })
  .strict();
export const deliveryPolicySchema = deliveryPolicyInputSchema
  .omit({ expectedRevision: true })
  .extend({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    revision: z.number().int().positive(),
    digest: deliveryDigestSchema,
    createdAt: z.iso.datetime(),
  });
export type DeliveryPolicy = z.infer<typeof deliveryPolicySchema>;
export const deliveryDecisionSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    candidateDigest: deliveryDigestSchema,
    policyId: z.uuid(),
    runId: z.uuid().optional(),
    policyRevision: z.number().int().positive(),
    policyDigest: deliveryDigestSchema,
    evidenceIds: z.array(z.uuid()),
    evidenceDigests: z.array(deliveryDigestSchema),
    status: z.enum(['passed', 'failed', 'incomplete', 'waived']),
    checks: z.array(
      z.object({
        rule: z.string(),
        status: z.enum(['passed', 'failed', 'incomplete', 'waived', 'deferred']),
        detail: z.string(),
        waivable: z.boolean(),
        reason: z.string().optional(),
      }),
    ),
    expiresAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    digest: deliveryDigestSchema,
  })
  .strict();
export type DeliveryDecision = z.infer<typeof deliveryDecisionSchema>;
export const deliveryEvaluateSchema = z
  .object({
    candidate: deliveryCandidateSchema,
    runId: z.uuid().optional(),
    policyId: z.uuid(),
    evidenceIds: z.array(z.uuid()).max(100),
    reviewed: z.boolean().default(false),
    waivers: z
      .array(z.object({ rule: z.string().max(80), reason: z.string().min(10).max(2000) }).strict())
      .max(20)
      .default([]),
  })
  .strict();
export const deliveryTrustKeySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    publisher: z.string().min(1).max(200),
    publicKey: z.string().min(32).max(8192),
    fingerprint: deliveryDigestSchema,
    revoked: z.boolean(),
  })
  .strict();
export type DeliveryTrustKey = z.infer<typeof deliveryTrustKeySchema>;
export const deliveryReleaseSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    namespace: z.string().min(1).max(200),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
    candidate: deliveryCandidateSchema,
    decision: deliveryDecisionSchema,
    notes: z.string().max(32000),
    releaseCoreDigest: deliveryDigestSchema,
    status: z.enum(['registered', 'withdrawn', 'archived']),
    reason: z.string().optional(),
    createdAt: z.iso.datetime(),
    origin: z.enum(['local-build', 'local-acceptance']),
  })
  .strict();
export type DeliveryRelease = z.infer<typeof deliveryReleaseSchema>;
export const deliveryImportSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    packageDigest: deliveryDigestSchema,
    releaseCoreDigest: deliveryDigestSchema,
    namespace: z.string(),
    version: z.string(),
    status: z.enum(['quarantined', 'accepted']),
    trust: z.enum(['trusted', 'unknown', 'unsigned', 'revoked']),
    candidate: deliveryCandidateSchema,
    sourceCandidateId: z.string(),
    sourceRunId: z.string().optional(),
    manifestId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryImport = z.infer<typeof deliveryImportSchema>;
export const deliveryChannelSchema = z
  .object({
    name: z.enum(['candidate', 'stable']),
    revision: z.number().int().nonnegative(),
    releaseId: z.uuid().nullable(),
    history: z.array(z.object({ releaseId: z.uuid().nullable(), at: z.iso.datetime() })),
  })
  .strict();
export const deliverySignatureSchema = z
  .object({ keyId: z.string().max(80), publisher: z.string().max(200), signature: z.string().max(256) })
  .strict();
export const deliveryReleaseViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    candidates: z.array(deliveryCandidateSchema),
    releases: z.array(deliveryReleaseSchema),
    imports: z.array(deliveryImportSchema),
    keys: z.array(deliveryTrustKeySchema),
    trustRevision: z.number().int().nonnegative(),
    channels: z.array(deliveryChannelSchema),
    signatures: z.record(z.string(), deliverySignatureSchema),
  })
  .strict();
export const deliveryGateViewSchema = z
  .object({
    schemaVersion: z.literal(1),
    policies: z.array(deliveryPolicySchema).max(1000),
    decisions: z.array(deliveryDecisionSchema).max(10000),
  })
  .strict();
export type DeliveryPolicyInput = z.input<typeof deliveryPolicyInputSchema>;
export type DeliveryEvaluateInput = z.input<typeof deliveryEvaluateSchema>;
export type DeliveryGateView = z.infer<typeof deliveryGateViewSchema>;
export type DeliveryReleaseView = z.infer<typeof deliveryReleaseViewSchema>;
export type DeliveryChannel = z.infer<typeof deliveryChannelSchema>;

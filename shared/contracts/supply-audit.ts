/** 软件供应审查的明确输入、固定组件及判定结构。 */
import { z } from 'zod';
import { suiteScope, suiteRef, suiteName, suiteDigest, suiteJson } from './suite-common.ts';

export const supplyComponent = z
  .object({
    key: suiteDigest,
    ecosystem: z.enum(['npm', 'python']),
    name: z.string().min(1).max(240),
    version: z.string().min(1).max(120),
    source: z.string().max(2048),
    integrity: z.string().max(1024),
    license: z.string().max(512),
    direct: z.boolean(),
    location: z.string().max(1024),
  })
  .strict();
export const supplyInventory = z
  .object({
    parser: z.enum(['npm-lock/2', 'npm-lock/3', 'python-hashed/1', 'components/1']),
    components: z.array(supplyComponent).max(50000),
    edges: z
      .array(z.object({ from: suiteDigest, name: z.string(), to: suiteDigest.nullable() }).strict())
      .max(250000),
    warnings: z.array(z.string().max(1024)).max(10000),
    complete: z.boolean(),
  })
  .strict();
export const supplyAdvisory = z
  .object({
    id: z.string().min(1).max(160),
    ecosystem: z.enum(['npm', 'python']),
    name: z.string().min(1).max(240),
    ranges: z
      .array(z.object({ introduced: z.string().max(120), fixed: z.string().max(120).nullable() }).strict())
      .min(1)
      .max(100),
    severity: z.enum(['unknown', 'low', 'medium', 'high', 'critical']),
    issuedAt: z.iso.datetime(),
    modifiedAt: z.iso.datetime(),
    withdrawn: z.boolean(),
    summary: z.string().max(4000),
  })
  .strict();
export const supplyAdvisoryDataset = z
  .object({
    format: z.literal('sakura-advisories/1'),
    collectedAt: z.iso.datetime(),
    source: z.string().min(1).max(2048),
    records: z.array(supplyAdvisory).max(100000),
  })
  .strict();
export const supplyFinding = z
  .object({
    id: suiteDigest,
    component: suiteDigest.nullable(),
    category: z.enum(['advisory', 'license', 'provenance', 'coverage', 'freshness']),
    severity: z.enum(['unknown', 'low', 'medium', 'high', 'critical']),
    status: z.enum(['blocked', 'review', 'info']),
    message: z.string().max(4000),
    sourceId: z.string().max(240),
  })
  .strict();
export const supplyPolicy = z
  .object({
    name: suiteName,
    blockAt: z.enum(['low', 'medium', 'high', 'critical']),
    maxAgeDays: z.number().int().min(1).max(365),
    unknown: z.enum(['block', 'review']),
    allowedLicenses: z.array(z.string().min(1).max(240)).max(100),
    requireTrustedProvenance: z.boolean(),
  })
  .strict();
export const supplyTrust = z
  .object({
    publishers: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
            publicKey: z.string().min(1).max(8192),
            trusted: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const supplyInput = suiteScope.extend({ source: suiteRef }).strict();
export const supplyCompare = suiteScope.extend({ before: suiteRef, after: suiteRef }).strict();
export const supplyMatch = suiteScope.extend({ inventory: suiteRef, dataset: suiteRef }).strict();
export const supplyProvenanceInput = suiteScope
  .extend({ inventory: suiteRef, proof: suiteRef, trust: suiteRef })
  .strict();
export const supplyEvaluate = suiteScope
  .extend({
    inventory: suiteRef,
    matching: suiteRef,
    licenses: suiteRef,
    provenance: suiteRef,
    policy: suiteRef,
  })
  .strict();
export const supplyReviewOpen = suiteScope.extend({ evaluation: suiteRef }).strict();
export const supplyReviewDecision = suiteScope
  .extend({
    review: suiteRef,
    decision: z.enum(['accept', 'reject']),
    note: z.string().min(1).max(4000),
    exceptions: z
      .array(
        z
          .object({
            findingId: suiteDigest,
            reason: z.string().min(1).max(2000),
            expiresAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export const supplySeal = suiteScope.extend({ evaluation: suiteRef, review: suiteRef }).strict();
export const supplyUploadText = suiteScope
  .extend({
    name: suiteName,
    text: z.string().max(1024 ** 2),
    format: z.enum(['text', 'json', 'csv']),
    allowExport: z.boolean().default(false),
  })
  .strict();
export const supplyExplanation = suiteScope.extend({ reference: suiteRef }).strict();
export const supplyJsonObject = z.record(z.string().max(512), suiteJson);
export const supplyMatching = z
  .object({
    dataset: z
      .object({ collectedAt: z.iso.datetime(), source: z.string(), records: z.number().int().min(0) })
      .strict(),
    matches: z
      .array(
        z
          .object({
            component: suiteDigest,
            advisory: z.string(),
            severity: z.enum(['unknown', 'low', 'medium', 'high', 'critical']),
            status: z.enum(['affected', 'unknown', 'withdrawn']),
            reason: z.string(),
          })
          .strict(),
      )
      .max(100000),
    evaluatedComponents: z.number().int().min(0),
    installedBytesVerified: z.literal(false),
    sourceAuthenticated: z.literal(false),
  })
  .strict();
export const supplyLicenseResult = z
  .object({
    declarationsOnly: z.literal(true),
    legalConclusion: z.literal(false),
    components: z
      .array(
        z
          .object({
            component: suiteDigest,
            expression: z.string(),
            identifiers: z.array(z.string()),
            status: z.enum(['declared', 'review-required']),
            textVerified: z.literal(false),
          })
          .strict(),
      )
      .max(50000),
  })
  .strict();
export const supplyProvenanceResult = z
  .object({
    signatureValid: z.boolean(),
    publisherTrusted: z.boolean(),
    publisher: z.string(),
    inventoryRevision: suiteDigest,
    installedBytesVerified: z.literal(false),
    reason: z.string(),
  })
  .strict();
export const supplyEvaluation = z
  .object({
    findings: z.array(supplyFinding).max(100000),
    policy: supplyPolicy,
    evaluatedAt: z.iso.datetime(),
    inventory: suiteRef,
    matching: suiteRef,
    licenses: suiteRef,
    provenance: suiteRef,
    policyReference: suiteRef,
    result: z.enum(['passed', 'failed', 'inconclusive']),
    disclaimer: z.string(),
  })
  .strict();
export const supplyReview = z
  .object({
    evaluation: suiteRef,
    status: z.enum(['open', 'accepted', 'rejected']),
    note: z.string(),
    exceptions: supplyReviewDecision.shape.exceptions,
    reviewer: z.string(),
    reviewedAt: z.iso.datetime().nullable(),
  })
  .strict();

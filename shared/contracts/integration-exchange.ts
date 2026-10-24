/** 离线交换不包含地址、批准或资源令牌。 Portable definitions and evidence without execution authority. */
import { z } from 'zod';
export const integrationUploadSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    owner: z.string().min(1).max(200),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 ** 2),
    offset: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    state: z.enum(['uploading', 'quarantined', 'rejected', 'discarded']),
    importId: z.uuid().nullable(),
    capacityToken: z.uuid(),
    error: z.string().max(200).nullable(),
  })
  .strict();
export type IntegrationUpload = z.infer<typeof integrationUploadSchema>;
import {
  ilDigest,
  ilJson,
  ilName,
  ilRef,
  workspaceSchema,
  requestEvidenceSchema,
  assertionResultSchema,
  runSchema,
} from './integration-lab.ts';
export const integrationPortableReportSchema = z
  .object({
    origin: z.literal('imported'),
    createdAt: z.iso.datetime(),
    verdict: z.enum(['passed', 'failed', 'inconclusive']),
    evidenceCoverage: z.enum(['record-only', 'selected-fields', 'recomputable']),
    cannotRecompute: z.array(z.string().max(100)),
    runIdentityDigest: ilDigest,
    requests: z.array(requestEvidenceSchema.omit({ body: true })).max(6000),
    evaluation: z
      .object({ results: z.array(assertionResultSchema).max(1000) })
      .strict()
      .nullable(),
    load: runSchema.shape.load,
  })
  .strict();
export const integrationBundleEntrySchema = z
  .object({
    kind: z.enum(['spec', 'environment', 'fixture', 'mock', 'scenario', 'assertion', 'report']),
    key: ilDigest,
    path: z.string().regex(/^(spec|environment|fixture|mock|scenario|assertion|report)\/[a-f0-9]{64}\.json$/),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(50 * 1024 ** 2),
    digest: ilDigest,
    content: ilJson,
  })
  .strict();
export const integrationBundleSchema = z
  .object({
    format: z.literal('sakura-integration-bundle/1'),
    tool: z.literal('integration-http-v1'),
    createdAt: z.iso.datetime(),
    root: z.object({ scenario: ilDigest, mock: ilDigest.nullable(), assertions: ilDigest }).strict(),
    entries: z.array(integrationBundleEntrySchema).max(2000),
    digest: ilDigest,
  })
  .strict();
export type IntegrationBundle = z.infer<typeof integrationBundleSchema>;
export const integrationImportSchema = z
  .object({
    id: z.uuid(),
    owner: ilName,
    digest: ilDigest,
    createdAt: z.iso.datetime(),
    state: z.enum(['quarantined', 'accepting', 'accepted', 'failed']),
    workspace: workspaceSchema.nullable(),
    bundle: integrationBundleSchema,
    mapping: z.record(ilDigest, ilRef),
    error: ilName.nullable(),
  })
  .strict();
export type IntegrationImport = z.infer<typeof integrationImportSchema>;

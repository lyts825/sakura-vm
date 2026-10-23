/** 交付包共享身份、输入定义和不可变候选。Shared delivery identities, definitions and immutable candidates. */
import { z } from 'zod';
import { imageRefSchema } from './image-assets.ts';

export const deliveryDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const deliveryScopeSchema = z
  .object({ vmId: z.string().min(1).max(128), projectId: z.string().min(1).max(128) })
  .strict();
export type DeliveryScope = z.infer<typeof deliveryScopeSchema>;
export const deliveryPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !/[\u0000-\u001f:]/.test(value) &&
      value.split('/').every((part) => !!part && part !== '.' && part !== '..'),
    '需要无越界片段的相对文件路径',
  );
export const deliveryFileSchema = z
  .object({
    path: deliveryPathSchema,
    blobId: z.string().min(1).max(128),
    sha256: deliveryDigestSchema,
    bytes: z.number().int().nonnegative(),
    mode: z.number().int().min(0).max(0o777),
  })
  .strict();
export type DeliveryFile = z.infer<typeof deliveryFileSchema>;
export const deliveryManifestSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    label: z.string().min(1).max(160),
    kind: z.enum(['source', 'output', 'report', 'import']),
    digest: deliveryDigestSchema,
    files: z.array(deliveryFileSchema).max(10000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryManifest = z.infer<typeof deliveryManifestSchema>;
export const deliveryReportFormatSchema = z.enum([
  'junit',
  'istanbul',
  'lcov',
  'coverage-py',
  'diagnostics',
  'benchmark',
]);
export type DeliveryReportFormat = z.infer<typeof deliveryReportFormatSchema>;
export const deliveryEnvironmentSchema = z
  .object({
    distro: z.enum(['alpine', 'debian', 'ubuntu']).default('alpine'),
    architecture: z.enum(['x86_64', 'aarch64']).default('x86_64'),
    imageSha256: deliveryDigestSchema.optional(),
    imageRef: imageRefSchema.optional(),
    foundry: z
      .object({
        workspaceId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
        id: z.uuid(),
        revisionDigest: deliveryDigestSchema,
      })
      .strict()
      .optional(),
    nodeVersion: z.string().max(80).optional(),
    pythonVersion: z.string().max(80).optional(),
    network: z.enum(['isolated', 'nat']).default('isolated'),
    publicEnvironment: z.record(z.string(), z.string().max(8192)).default({}),
  })
  .strict();
export type DeliveryEnvironment = z.infer<typeof deliveryEnvironmentSchema>;
export const deliveryStartupSchema = z
  .object({
    kind: z.enum(['static', 'service', 'command']).default('static'),
    command: z.string().max(16384).default(''),
    root: z.union([z.literal('.'), deliveryPathSchema]).default('.'),
    port: z.number().int().min(1024).max(65535).default(8080),
    healthPath: z.string().startsWith('/').max(1024).default('/'),
    timeoutSeconds: z.number().int().min(1).max(3600).default(60),
  })
  .strict();
export type DeliveryStartup = z.infer<typeof deliveryStartupSchema>;
export const deliveryStepSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    name: z.string().min(1).max(120),
    command: z.string().min(1).max(16384),
    dependsOn: z.array(z.string().max(64)).max(20).default([]),
    timeoutSeconds: z.number().int().min(1).max(3600).default(300),
    rerunnable: z.boolean().default(false),
  })
  .strict();
export const deliveryDefinitionSchema = z
  .object({
    name: z.string().min(1).max(120),
    source: z
      .object({
        mode: z.enum(['commit', 'draft']).default('commit'),
        ref: z.string().min(1).max(256).default('HEAD'),
        paths: z.array(deliveryPathSchema).max(10000).default([]),
      })
      .strict(),
    environment: deliveryEnvironmentSchema,
    steps: z.array(deliveryStepSchema).min(1).max(20),
    outputs: z.array(deliveryPathSchema).max(1000).default([]),
    reports: z
      .array(
        z
          .object({
            path: deliveryPathSchema,
            format: deliveryReportFormatSchema,
            required: z.boolean().default(true),
          })
          .strict(),
      )
      .max(32)
      .default([]),
    startup: deliveryStartupSchema,
    matrix: z
      .array(z.object({ label: z.string().min(1).max(80), environment: deliveryEnvironmentSchema }).strict())
      .max(8)
      .default([]),
    maxConcurrency: z.number().int().min(1).max(4).default(1),
    requireTests: z.boolean().default(true),
  })
  .strict();
export type DeliveryDefinition = z.infer<typeof deliveryDefinitionSchema>;
export const deliveryCandidateSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    inputId: z.uuid().optional(),
    inputDigest: deliveryDigestSchema,
    runId: z.uuid().optional(),
    manifestId: z.uuid(),
    manifestDigest: deliveryDigestSchema,
    environment: deliveryEnvironmentSchema,
    startup: deliveryStartupSchema,
    origin: z
      .object({
        namespace: z.string().min(1).max(200),
        version: z.string().max(80),
        releaseCoreDigest: deliveryDigestSchema,
      })
      .strict()
      .optional(),
    digest: deliveryDigestSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryCandidate = z.infer<typeof deliveryCandidateSchema>;

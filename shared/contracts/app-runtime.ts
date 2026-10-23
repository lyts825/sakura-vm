/** 应用运行包的严格、可持久化领域对象；制品身份与执行身份分开。 */
import { z } from 'zod';
import { egressPlanSchema } from './egress-rules.ts';
import { imageAssetSchema } from './image-assets.ts';
export const appIdSchema = z.uuid();
export const appDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const appPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      p.split('/').every((s) => s && s !== '.' && s !== '..' && !/[\x00-\x1f:]/.test(s)),
    '必须为安全相对路径',
  );
const date = z.iso.datetime();
export const appRebindPlanSchema = z
  .object({
    id: appIdSchema,
    digest: appDigestSchema,
    vmId: z.string().min(1),
    vmCreatedAt: z.string(),
    diskIdentity: appDigestSchema,
    targetRevision: z.number().int().positive(),
    fromBootId: z.string().min(1),
    toBootId: z.string().min(1),
    createdAt: date,
    expiresAt: date,
    state: z.enum(['planned', 'applying', 'applied']),
    completedAt: date.optional(),
  })
  .strict();
export const appTargetSchema = z
  .object({
    appId: appIdSchema,
    name: z.string().min(1).max(100),
    revision: z.number().int().positive(),
    vmId: z.string().min(1),
    vmCreatedAt: z.string(),
    projectId: z.string().min(1),
    directory: z.string().regex(/^\/workspace\/apps\/[a-f0-9-]{36}$/),
    diskIdentity: appDigestSchema,
    bootId: z.string(),
    createdAt: date,
    desired: z.enum(['stopped', 'running']),
    state: z.enum(['ready', 'drifted', 'transitioning', 'unknown']),
    rebind: appRebindPlanSchema.nullable().default(null),
    lease: z
      .object({
        id: appIdSchema,
        operationId: appIdSchema,
        planDigest: appDigestSchema,
        expiresAt: date,
        executionId: appIdSchema,
        bootId: z.string(),
        parentExecutionId: appIdSchema.optional(),
      })
      .strict()
      .nullable(),
    transition: z
      .object({
        id: appIdSchema,
        fromBootId: z.string(),
        state: z.enum(['intent', 'stopped', 'backed-up', 'started', 'unknown']),
        backupId: z.string().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const appStartupSchema = z
  .object({
    kind: z.enum(['static', 'service', 'command']),
    command: z.string().max(8192).default(''),
    directory: appPathSchema.default('public'),
    port: z.number().int().min(1024).max(65535).default(8080),
    healthPath: z.string().startsWith('/').max(500).default('/'),
    healthCommand: z.string().max(4096).default(''),
    timeoutSeconds: z.number().int().min(5).max(600).default(60),
  })
  .strict();
export const appPackageSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    name: z.string().min(1).max(100),
    manifestId: appIdSchema,
    digest: appDigestSchema,
    startup: appStartupSchema,
    source: z.enum(['local-reviewed', 'delivery']),
    sourceDigest: z.string().optional(),
    sourceReference: z
      .object({
        vmId: z.string(),
        projectId: z.string(),
        releaseId: appIdSchema,
        releaseCoreDigest: appDigestSchema,
      })
      .strict()
      .optional(),
    createdAt: date,
    archived: z.boolean().default(false),
  })
  .strict();
export const appConfigSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    revision: z.number().int().positive(),
    values: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), z.string().max(8192)),
    secretRefs: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), z.string().min(1).max(100)),
    secretVersions: z.record(z.string(), z.string()),
    digest: appDigestSchema,
    createdAt: date,
  })
  .strict();
export const appDatasetSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
    generation: z.number().int().nonnegative(),
    schemaVersion: z.string().max(60),
    path: z.string(),
    budgetBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 ** 3),
    enforcement: z.literal('capacity-preflight'),
    retained: z.boolean(),
    createdAt: date,
  })
  .strict();
export const appObservationSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    installationId: appIdSchema.nullable(),
    bootId: z.string(),
    status: z.enum(['healthy', 'unhealthy', 'stopped', 'unknown']),
    checkedAt: date,
    detail: z.string().max(32768),
    exitCode: z.number().int().nullable(),
    probe: z
      .object({
        command: z.string().max(4096),
        healthPath: z.string().startsWith('/'),
        port: z.number().int().min(1024).max(65535),
      })
      .strict()
      .optional(),
  })
  .strict();
export const appRouteSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    revision: z.number().int().positive(),
    installationId: appIdSchema,
    url: z.string(),
    port: z.number().int(),
    state: z.enum(['open', 'closed', 'unknown']),
    bootId: z.string(),
    createdAt: date,
  })
  .strict();
export const appCheckpointSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    vmId: z.string(),
    vmCreatedAt: z.string(),
    diskIdentity: appDigestSchema,
    backupId: z.string().optional(),
    state: z.enum([
      'planned',
      'stopping',
      'backing-up',
      'verifying',
      'restarting',
      'ready',
      'failed',
      'unknown',
    ]),
    managedBy: z.enum(['app-recovery', 'app-deploy']).default('app-deploy'),
    fromBootId: z.string(),
    toBootId: z.string().optional(),
    checksum: z.string().optional(),
    createdAt: date,
    error: z.string().optional(),
    restoredVmId: z.string().optional(),
    restoredCreatedAt: z.string().optional(),
    datasets: z.array(appDatasetSchema).default([]),
    activatedAt: date.optional(),
    activationOperationId: appIdSchema.optional(),
  })
  .strict();
export const appBackupPolicySchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    enabled: z.boolean(),
    intervalHours: z.number().int().min(1).max(168),
    nextAt: date,
    lastAt: date.optional(),
    lastCheckpointId: appIdSchema.optional(),
    reason: z.string().max(2000),
  })
  .strict();
export const appPlanSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    action: z.enum(['install', 'upgrade', 'rollback', 'stop', 'uninstall']),
    targetRevision: z.number().int(),
    dataDigest: appDigestSchema,
    bootId: z.string(),
    diskIdentity: appDigestSchema,
    packageId: appIdSchema.nullable(),
    packageDigest: z.string(),
    configId: appIdSchema.nullable(),
    configDigest: z.string(),
    priorInstallationId: appIdSchema.nullable(),
    routeRevision: z.number().int(),
    checkpoint: z.boolean(),
    migration: z
      .object({
        command: z.string().min(1).max(8192),
        fromSchema: z.string().max(60),
        toSchema: z.string().max(60),
        verification: z.string().min(1).max(8192),
      })
      .strict()
      .nullable(),
    digest: appDigestSchema,
    expiresAt: date,
    createdAt: date,
    approvedAt: date.nullable(),
    usedBy: appIdSchema.nullable(),
  })
  .strict();
export const appInstallationSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    packageId: appIdSchema,
    packageDigest: appDigestSchema,
    configId: appIdSchema,
    configDigest: appDigestSchema,
    directory: z.string(),
    bootId: z.string(),
    state: z.enum(['running', 'stopped', 'failed', 'unknown']),
    createdAt: date,
    dataSchema: z.string(),
    routeRevision: z.number().int(),
  })
  .strict();
export const appOperationSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    planId: appIdSchema,
    phase: z.string(),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']),
    cleanup: z.enum(['not-needed', 'pending', 'verified', 'unknown']),
    createdAt: date,
    finishedAt: date.optional(),
    error: z.string().optional(),
    log: z.string().max(65536),
    installationId: appIdSchema.optional(),
  })
  .strict();
export const appEventSchema = z
  .object({
    appId: appIdSchema,
    id: appIdSchema,
    at: date,
    kind: z.string().max(60),
    message: z.string().max(4096),
  })
  .strict();
export const appViewSchema = z
  .object({
    targets: z.array(appTargetSchema).default([]),
    images: z.array(imageAssetSchema).default([]),
    packages: z.array(appPackageSchema).default([]),
    configs: z.array(appConfigSchema).default([]),
    datasets: z.array(appDatasetSchema).default([]),
    observations: z.array(appObservationSchema).default([]),
    routes: z.array(appRouteSchema).default([]),
    checkpoints: z.array(appCheckpointSchema).default([]),
    backupPolicies: z.array(appBackupPolicySchema).default([]),
    plans: z.array(appPlanSchema).default([]),
    installations: z.array(appInstallationSchema).default([]),
    operations: z.array(appOperationSchema).default([]),
    events: z.array(appEventSchema).default([]),
    selectedId: z.string().optional(),
    artifactCleanup: z
      .object({
        token: appIdSchema,
        expiresAt: date,
        bytes: z.number().nonnegative(),
        uploads: z.number().int().nonnegative(),
        manifests: z.number().int().nonnegative(),
        protected: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    transfer: z.object({ id: appIdSchema, offset: z.number().int().nonnegative() }).strict().optional(),
    networkPlans: z.array(egressPlanSchema).default([]),
    targetReceipts: z
      .array(
        z
          .object({
            vmId: appIdSchema,
            createdAt: z.string(),
            token: appIdSchema,
            cleanup: z.enum(['pending', 'confirmed', 'unknown']),
          })
          .strict(),
      )
      .default([]),
    capabilities: z
      .array(z.object({ id: z.string(), ready: z.boolean(), reason: z.string() }).strict())
      .default([]),
    uploads: z
      .array(
        z
          .object({ id: appIdSchema, offset: z.number(), bytes: z.number(), sha256: appDigestSchema })
          .strict(),
      )
      .default([]),
    blobs: z
      .array(z.object({ blobId: appDigestSchema, sha256: appDigestSchema, bytes: z.number() }).strict())
      .default([]),
  })
  .strict();
export type AppTarget = z.infer<typeof appTargetSchema>;
export type AppPackage = z.infer<typeof appPackageSchema>;
export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppDataset = z.infer<typeof appDatasetSchema>;
export type AppObservation = z.infer<typeof appObservationSchema>;
export type AppRoute = z.infer<typeof appRouteSchema>;
export type AppCheckpoint = z.infer<typeof appCheckpointSchema>;
export type AppPlan = z.infer<typeof appPlanSchema>;
export type AppInstallation = z.infer<typeof appInstallationSchema>;
export type AppOperation = z.infer<typeof appOperationSchema>;
export type AppView = z.infer<typeof appViewSchema>;
export type AppStartup = z.infer<typeof appStartupSchema>;
export const appSections = [
  'targets',
  'packages',
  'config',
  'data',
  'observe',
  'routes',
  'recovery',
  'deploy',
  'workbench',
] as const;
export type AppSection = (typeof appSections)[number];

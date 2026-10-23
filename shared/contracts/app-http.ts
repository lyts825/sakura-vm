/** 应用操作按插件分别校验，禁止跨领域动作和客户端自报成功。 */
import { z } from 'zod';
import { egressDestinationSchema } from './egress-rules.ts';
import { imageRefSchema } from './image-assets.ts';
import {
  appIdSchema as id,
  appDigestSchema as digest,
  appStartupSchema,
  appPathSchema,
  appViewSchema,
  appSections,
  appDatasetSchema,
} from './app-runtime.ts';
const action = <const N extends string, S extends z.ZodRawShape = {}>(name: N, shape: S = {} as S) =>
  z.object({ action: z.literal(name), ...shape }).strict();
const ids = { id };
const env = z.record(z.string().regex(/^[A-Z_][A-Z0-9_]{0,63}$/), z.string().max(8192));
export const appActionSchemas = {
  targets: z.discriminatedUnion('action', [
    action('adopt', {
      name: z.string().min(1).max(100),
      vmId: z.string().min(1),
      projectId: z.string().min(1),
      reviewed: z.literal(true),
    }),
    action('create', {
      name: z.string().min(1).max(100),
      imageRef: imageRefSchema.optional(),
      distro: z.enum(['alpine', 'debian', 'ubuntu']),
      architecture: z.enum(['x86_64', 'aarch64']).default('x86_64'),
      memoryMiB: z.number().int().min(512).max(32768),
      cpus: z.number().int().min(1).max(16),
      diskGiB: z.number().int().min(4).max(128),
      reviewed: z.literal(true),
    }),
    action('reconcile'),
    action('preview-rebind'),
    action('begin-rebind', { id, digest }),
    action('complete-rebind', { id, leaseId: id }),
    action('relocate', {
      leaseId: id,
      vmId: id,
      vmCreatedAt: z.string(),
      originalVmId: id,
      originalCreatedAt: z.string(),
    }),
    action('claim', {
      operationId: id,
      planDigest: digest,
      expectedRevision: z.number().int().positive(),
      expectedBootId: z.string().min(1),
      expectedDiskIdentity: digest,
      allowStopped: z.boolean().default(false),
    }),
    action('release', { leaseId: id }),
    action('desired', { value: z.enum(['running', 'stopped']) }),
    action('begin-boot'),
    action('boot-stopped'),
    action('boot-backed-up', { backupId: id }),
    action('complete-boot'),
    action('network-preview', {
      destinations: z.array(egressDestinationSchema).min(1).max(32),
      expiresAt: z.iso.datetime(),
    }),
    action('network-apply', { id, digest, reviewed: z.literal(true) }),
    action('network-observe', ids),
    action('network-revoke', ids),
    action('cleanup-target', { token: id, reviewed: z.literal(true) }),
  ]),
  packages: z.discriminatedUnion('action', [
    action('cleanup-preview'),
    action('cleanup', { token: id, reviewed: z.literal(true) }),
    action('import-delivery', {
      vmId: z.string().min(1).max(100),
      projectId: z.string().min(1).max(100),
      releaseId: id,
      releaseCoreDigest: digest,
      reviewed: z.literal(true),
    }),
    action('begin', {
      sha256: digest,
      bytes: z
        .number()
        .int()
        .min(0)
        .max(1024 ** 3),
    }),
    action('chunk', { id, offset: z.number().int().nonnegative(), data: z.string().max(700000) }),
    action('complete', ids),
    action('seal', {
      name: z.string().min(1).max(100),
      startup: appStartupSchema,
      files: z
        .array(
          z
            .object({
              path: appPathSchema,
              blobId: digest,
              sha256: digest,
              bytes: z.number().int().nonnegative(),
              mode: z.number().int().min(0).max(511),
            })
            .strict(),
        )
        .min(1)
        .max(10000),
      reviewed: z.literal(true),
    }),
    action('archive', ids),
  ]),
  config: z.discriminatedUnion('action', [
    action('save', { expectedRevision: z.number().int().nonnegative(), values: env, secretRefs: env }),
    action('verify', ids),
  ]),
  data: z.discriminatedUnion('action', [
    action('create', {
      name: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
      schemaVersion: z.string().max(60),
      budgetBytes: z
        .number()
        .int()
        .positive()
        .max(128 * 1024 ** 3),
      reviewed: z.literal(true),
    }),
    action('inspect'),
    action('restore-catalog', { datasets: z.array(appDatasetSchema), leaseId: id }),
    action('migrate', {
      command: z.string().min(1).max(8192),
      verification: z.string().min(1).max(8192),
      fromSchema: z.string(),
      toSchema: z.string(),
      leaseId: id,
    }),
    action('plan-delete', ids),
    action('delete', { id, token: id, reviewed: z.literal(true) }),
  ]),
  observe: z.discriminatedUnion('action', [
    action('probe', {
      installationId: id,
      command: z.string().max(4096),
      healthPath: z.string().startsWith('/'),
      port: z.number().int().min(1024).max(65535),
    }),
    action('logs'),
    action('acknowledge', { message: z.string().min(1).max(4096) }),
  ]),
  routes: z.discriminatedUnion('action', [
    action('drain', { expectedRevision: z.number().int().nonnegative() }),
    action('switch', {
      installationId: id,
      expectedRevision: z.number().int().nonnegative(),
      port: z.number().int().min(1024).max(65535),
      healthPath: z.string().startsWith('/'),
      leaseId: id,
    }),
    action('close', { expectedRevision: z.number().int().nonnegative() }),
    action('reconcile'),
  ]),
  recovery: z.discriminatedUnion('action', [
    action('rebind-preview'),
    action('rebind', { id, digest, reviewed: z.literal(true) }),
    action('schedule', {
      enabled: z.boolean(),
      intervalHours: z.number().int().min(1).max(168),
      reviewed: z.literal(true),
    }),
    action('checkpoint', { reviewed: z.literal(true), leaseId: id.optional() }),
    action('restore', { id, name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), reviewed: z.literal(true) }),
    action('verify', ids),
    action('reconcile', ids),
    action('activate-restored', { id, reviewed: z.literal(true) }),
  ]),
  deploy: z.discriminatedUnion('action', [
    action('preview', {
      kind: z.enum(['install', 'upgrade', 'rollback', 'stop', 'uninstall']),
      packageId: id.optional(),
      configId: id.optional(),
      checkpoint: z.boolean().default(false),
      migration: z
        .object({
          command: z.string().min(1).max(8192),
          verification: z.string().min(1).max(8192),
          fromSchema: z.string(),
          toSchema: z.string(),
        })
        .strict()
        .nullable()
        .default(null),
    }),
    action('approve', { id, digest, reviewed: z.literal(true) }),
    action('apply', ids),
    action('cancel', ids),
    action('recover-from-checkpoint', { id, checkpointId: id, reviewed: z.literal(true) }),
    action('reconcile', ids),
  ]),
  workbench: z.discriminatedUnion('action', [action('refresh')]),
} as const;
export type AppAction = {
  [K in keyof typeof appActionSchemas]: z.input<(typeof appActionSchemas)[K]>;
}[keyof typeof appActionSchemas];
export const appRouteRequests = {
  'app-targets.act': appActionSchemas.targets.refine(
    (o) =>
      ![
        'relocate',
        'preview-rebind',
        'begin-rebind',
        'complete-rebind',
        'claim',
        'release',
        'desired',
        'begin-boot',
        'boot-stopped',
        'boot-backed-up',
        'complete-boot',
      ].includes(o.action),
    '仅供领域服务调用的操作',
  ),
  'app-packages.act': appActionSchemas.packages,
  'app-config.act': appActionSchemas.config,
  'app-data.act': appActionSchemas.data.refine(
    (o) => !['migrate', 'restore-catalog'].includes(o.action),
    '数据变更必须通过已批准计划',
  ),
  'app-observe.act': appActionSchemas.observe.refine((o) => o.action !== 'probe', '探针必须绑定安装记录'),
  'app-routes.act': appActionSchemas.routes.refine(
    (o) => !['switch', 'drain'].includes(o.action),
    '入口切换必须通过已批准计划',
  ),
  'app-recovery.act': appActionSchemas.recovery.refine(
    (o) => o.action !== 'checkpoint' || !o.leaseId,
    '公开冷备不能借用其他操作租约',
  ),
  'app-deploy.act': appActionSchemas.deploy,
  'app-workbench.act': appActionSchemas.workbench,
};
export const appRouteQueries = Object.fromEntries(
  appSections.flatMap((s) =>
    ['view', 'act'].map((a) => ['app-' + s + '.' + a, z.object({ appId: id.optional() }).strict()]),
  ),
);
export const appRouteResponses = Object.fromEntries(
  appSections.flatMap((s) => ['view', 'act'].map((a) => ['app-' + s + '.' + a, appViewSchema])),
);

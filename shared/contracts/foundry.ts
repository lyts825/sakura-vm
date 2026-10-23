/** 镜像工坊跨端严格数据模型。 */
import { z } from 'zod';
import {
  imageAssetSchema,
  imageRefSchema,
  imageUploadSchema,
  imageLeaseSchema,
  ownedImageVmSchema,
} from './image-assets.ts';
export const foundrySections = [
  'sources',
  'blueprints',
  'depot',
  'builders',
  'sanitizers',
  'checks',
  'catalog',
  'exchange',
  'workbench',
] as const;
export const foundryScopeSchema = z
  .object({ workspaceId: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/) })
  .strict();
export type FoundryScope = z.infer<typeof foundryScopeSchema>;
export const foundryBlueprintSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    sourceId: z.uuid(),
    packages: z
      .array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.-]{0,127}$/))
      .min(1)
      .max(64),
    commands: z.array(z.string().min(1).max(8192)).max(20).default([]),
    tools: z
      .array(z.string().regex(/^[A-Za-z0-9_+.-]{1,100}$/))
      .min(1)
      .max(64),
    memoryMiB: z.number().int().min(512).max(8192).default(1024),
    timeoutMinutes: z.number().int().min(5).max(180).default(30),
  })
  .strict();
export type FoundryBlueprint = z.infer<typeof foundryBlueprintSchema>;
export const foundryRecordSchema = z
  .object({
    id: z.uuid(),
    scope: foundryScopeSchema,
    section: z.enum(foundrySections),
    name: z.string().max(160),
    revision: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    state: z.enum([
      'ready',
      'queued',
      'running',
      'succeeded',
      'failed',
      'interrupted',
      'published',
      'withdrawn',
      'quarantined',
      'accepted',
      'archived',
    ]),
    parents: z.array(z.uuid()).max(12),
    blueprint: foundryBlueprintSchema.optional(),
    image: imageAssetSchema.optional(),
    evidence: z.string().max(1048576).default(''),
    error: z.string().max(4096).default(''),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']).default('confirmed'),
    receipts: z.array(ownedImageVmSchema).max(8).default([]),
    jobId: z.string().optional(),
    trust: z.enum(['local', 'unverified']).default('local'),
  })
  .strict();
export type FoundryRecord = z.infer<typeof foundryRecordSchema>;
export const foundryTaskSchema = z.enum([
  'materials',
  'build',
  'sanitize',
  'check',
  'publish',
  'instantiate',
  'withdraw',
  'export',
  'accept',
  'recover',
]);
export const foundryPlanInputSchema = z
  .object({
    task: foundryTaskSchema,
    id: z.uuid(),
    name: z.string().max(100).default(''),
    reviewed: z.literal(true),
  })
  .strict();
export const foundryPlanSchema = z
  .object({
    token: z.uuid(),
    scope: foundryScopeSchema,
    input: foundryPlanInputSchema,
    dependencyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
    network: z.enum(['nat', 'isolated', 'none']),
    description: z.string().max(8192),
  })
  .strict();
export type FoundryPlan = z.infer<typeof foundryPlanSchema>;
export const foundryViewSchema = z
  .object({
    rows: z.array(foundryRecordSchema),
    plans: z.array(foundryPlanSchema),
    templates: z.array(foundryBlueprintSchema.omit({ sourceId: true })),
    capabilities: z.array(z.string()),
    pendingUploads: z.array(imageUploadSchema),
  })
  .strict();
export type FoundryView = z.infer<typeof foundryViewSchema>;
export const foundryActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('stage-import'),
      image: imageAssetSchema,
      blueprint: foundryBlueprintSchema,
      reviewed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('prepare'),
      distro: imageAssetSchema.shape.distro,
      architecture: imageAssetSchema.shape.architecture,
      reviewed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('save'),
      id: z.uuid().optional(),
      expectedRevision: z.number().int().nonnegative(),
      blueprint: foundryBlueprintSchema,
    })
    .strict(),
  z
    .object({ action: z.literal('archive'), id: z.uuid(), expectedRevision: z.number().int().positive() })
    .strict(),
  z.object({ action: z.literal('plan'), input: foundryPlanInputSchema }).strict(),
  z.object({ action: z.literal('execute'), token: z.uuid() }).strict(),
  z.object({ action: z.literal('cancel'), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('begin-import'),
      input: imageUploadSchema.pick({
        digest: true,
        bytes: true,
        distro: true,
        architecture: true,
        source: true,
      }),
      blueprint: foundryBlueprintSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('append-import'),
      id: z.uuid(),
      offset: z.number().int().nonnegative(),
      data: z.string().max(700000),
    })
    .strict(),
  z.object({ action: z.literal('finish-import'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('discard-import'), id: z.uuid(), reviewed: z.literal(true) }).strict(),
  z.object({ action: z.literal('open-read'), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('read'),
      imageRef: imageRefSchema,
      token: z.uuid(),
      offset: z.number().int().nonnegative(),
      length: z.number().int().min(1).max(524288),
    })
    .strict(),
  z.object({ action: z.literal('close-read'), token: z.uuid() }).strict(),
  z.object({ action: z.literal('cleanup-plan') }).strict(),
  z.object({ action: z.literal('cleanup'), token: z.uuid() }).strict(),
]);
export type FoundryAction = z.infer<typeof foundryActionSchema>;
export const foundryResultSchema = z.union([
  foundryRecordSchema,
  foundryPlanSchema,
  imageUploadSchema,
  imageLeaseSchema,
  z.object({ data: z.string(), offset: z.number(), eof: z.boolean() }).strict(),
  z.object({ closed: z.literal(true) }).strict(),
  z.object({ token: z.string(), assets: z.array(z.string()), protected: z.array(z.string()) }).strict(),
  z.object({ removed: z.number() }).strict(),
]);
export type FoundryResult = z.infer<typeof foundryResultSchema>;
export const foundryUseSchema = z
  .object({
    imageRef: imageRefSchema,
    revisionDigest: z.string(),
    evidence: z.string(),
    cleanup: z.literal('confirmed'),
  })
  .strict();
export type FoundryUse = z.infer<typeof foundryUseSchema>;

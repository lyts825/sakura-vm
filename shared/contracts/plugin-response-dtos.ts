/**
 * 模块职责（中文）：文件、语言服务、容器和剪贴板等插件响应的共用 DTO Schema，减少跨路由结构漂移。
 * Module responsibility (English): response DTOs reused across plugin HTTP routes.
 * 详细范围（中文）：公开入口包括 capabilityResultSchema, featureSettingSchema, operationJsonSchema, filePreviewSchema, fileListingSchema, fileOperationSchema, debuggerVariablesSchema, languageResultSchema, dockerContainerSchema, dockerImageSchema, dockerVolumeSchema, clipboardSessionSchema, clipboardViewSchema, clipboardActionSchema, signedBundleViewSchema；职责覆盖跨插件 HTTP 路由复用的响应 DTO，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include capabilityResultSchema, featureSettingSchema, operationJsonSchema, filePreviewSchema, fileListingSchema, fileOperationSchema, debuggerVariablesSchema, languageResultSchema, dockerContainerSchema, dockerImageSchema, dockerVolumeSchema, clipboardSessionSchema, clipboardViewSchema, clipboardActionSchema, signedBundleViewSchema. The scope covers response DTOs reused across plugin HTTP routes. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
import { jsonValueSchema } from './json-values.ts';
import { jobViewSchema } from './core-dtos.ts';

/** Feature adapters carry protocol-specific JSON beside a stable capability result envelope. */
export const capabilityResultSchema = z
  .object({
    ready: z.boolean(),
    executed: z.boolean().optional(),
    reason: z.string().optional(),
    adapter: z
      .union([
        z.string(),
        z
          .object({
            id: z.string(),
            enabled: z.boolean().optional(),
            options: z.record(z.string(), jsonValueSchema).optional(),
            actions: z.array(z.string()).optional(),
          })
          .catchall(jsonValueSchema),
      ])
      .optional(),
  })
  .catchall(jsonValueSchema);
export const featureSettingSchema = z
  .object({ enabled: z.boolean(), options: z.record(z.string(), jsonValueSchema), updatedAt: z.string() })
  .catchall(jsonValueSchema);

/** JSON Schema is transported as data; extension keywords contain JSON values. */
export const operationJsonSchema = z
  .object({
    $schema: z.string().optional(),
    $id: z.string().optional(),
    $ref: z.string().optional(),
    type: z
      .union([
        z.enum(['null', 'boolean', 'object', 'array', 'number', 'string', 'integer']),
        z.array(z.enum(['null', 'boolean', 'object', 'array', 'number', 'string', 'integer'])),
      ])
      .optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), jsonValueSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: jsonValueSchema.optional(),
    items: jsonValueSchema.optional(),
    $defs: z.record(z.string(), jsonValueSchema).optional(),
  })
  .catchall(jsonValueSchema);

const previewBase = { name: z.string(), size: z.number() };
export const filePreviewSchema = z.union([
  z
    .object({
      ...previewBase,
      kind: z.enum(['pdf', 'image']),
      mime: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']),
      base64: z.string(),
    })
    .strict(),
  z
    .object({
      ...previewBase,
      kind: z.literal('table'),
      rows: z.array(z.array(z.string())),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...previewBase,
      kind: z.literal('archive'),
      entries: z.array(
        z
          .object({
            name: z.string(),
            bytes: z.number(),
            compressedBytes: z.number().optional(),
            directory: z.boolean().optional(),
          })
          .strict(),
      ),
      totalEntries: z.number(),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...previewBase,
      kind: z.literal('hex'),
      hex: z.string(),
      truncated: z.boolean(),
      message: z.string().optional(),
    })
    .strict(),
]);
export const fileListingSchema = z.array(
  z
    .object({
      name: z.string(),
      size: z.number(),
      directory: z.boolean(),
      symlink: z.boolean(),
      modified: z.number(),
    })
    .strict(),
);
export const fileOperationSchema = z.object({ ok: z.boolean(), historyId: z.string().optional() }).strict();
export const debuggerVariablesSchema = z
  .object({
    variables: z.array(
      z
        .object({
          name: z.string(),
          value: z.string(),
          type: z.string(),
          variablesReference: z.number(),
        })
        .strict(),
    ),
  })
  .strict();
const position = z.object({ line: z.number(), character: z.number() }).strict();
const range = z.object({ start: position, end: position }).strict();
export const languageResultSchema = z.union([
  z
    .object({
      path: z.string(),
      items: z.array(
        z
          .object({ label: z.string(), detail: z.string(), insertText: z.string(), range: range.nullable() })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      locations: z.array(z.object({ path: z.string(), line: z.number(), column: z.number() }).strict()),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      received: z.boolean(),
      diagnostics: z.array(
        z
          .object({ severity: z.string(), message: z.string(), line: z.number(), column: z.number() })
          .strict(),
      ),
    })
    .strict(),
  z
    .object({
      token: z.string(),
      files: z.array(z.object({ path: z.string(), before: z.string(), after: z.string() }).strict()),
    })
    .strict(),
]);
// Docker's versioned CLI emits additional fields; known identifiers remain required.
export const dockerContainerSchema = z
  .object({
    ID: z.string(),
    Image: z.string(),
    Names: z.string(),
    State: z.string(),
    Status: z.string(),
    Ports: z.string(),
  })
  .catchall(jsonValueSchema);
export const dockerImageSchema = z
  .object({ ID: z.string(), Repository: z.string(), Tag: z.string(), Size: z.string() })
  .catchall(jsonValueSchema);
export const dockerVolumeSchema = z
  .object({ Name: z.string(), Driver: z.string() })
  .catchall(jsonValueSchema);

const clipboardRule = z
  .object({
    copy: z.boolean(),
    paste: z.boolean(),
    files: z.boolean(),
    sensitive: z.boolean(),
    maxTextBytes: z.number().int().min(1024).max(1048576),
  })
  .strict();
const clipboardApplication = z
  .object({ image: z.string(), sha256: z.string(), rule: clipboardRule })
  .strict();
export const clipboardSessionSchema = z
  .object({
    id: z.uuid(),
    state: z.enum(['running', 'stopped', 'error']),
    image: z.string().optional(),
    sha256: z.string().optional(),
    projectId: z.string().optional(),
    directory: z.string().optional(),
    startedAt: z.string().optional(),
    compatible: z.boolean().optional(),
    active: z.boolean().optional(),
    generation: z.number().optional(),
    rule: clipboardRule.optional(),
    blockedCopy: z.number().optional(),
    blockedPaste: z.number().optional(),
    error: z.string().optional(),
    desktopOwner: z.object({ projectId: z.string(), uid: z.number(), runId: z.uuid() }).strict().optional(),
    applicationOwner: z
      .object({ uid: z.number(), kind: z.enum(['project-desktop', 'window-sandbox']) })
      .strict()
      .optional(),
    processes: z
      .array(
        z.object({ pid: z.number(), created: z.string(), image: z.string(), loaded: z.boolean() }).strict(),
      )
      .optional(),
  })
  .strict();
export const clipboardViewSchema = z
  .object({
    version: z.number(),
    applications: z.array(clipboardApplication),
    ready: z.boolean(),
    build: z.string().optional(),
    sessions: z.array(clipboardSessionSchema),
    error: z.string().optional(),
    installation: jobViewSchema.nullable(),
  })
  .strict();
export const clipboardActionSchema = z.union([
  clipboardViewSchema,
  clipboardSessionSchema,
  jobViewSchema,
  z.object({ image: z.string(), sha256: z.string() }).strict(),
  z.object({ stopped: z.literal(true) }).strict(),
  z.object({ removed: z.literal(true) }).strict(),
]);
const bundleKey = z.object({ name: z.string(), fingerprint: z.string(), publicKey: z.string() }).strict();
export const signedBundleViewSchema = z
  .object({
    revision: z.number(),
    requireTrustedOnImport: z.boolean(),
    localKey: bundleKey.nullable(),
    trustedKeys: z.array(bundleKey),
  })
  .strict();

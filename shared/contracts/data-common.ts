/** 数据工作台的严格身份、版本与预算。 Strict data workbench identities and budgets. */
import { z } from 'zod';
import {
  deliveryScopeSchema,
  deliveryDigestSchema,
  deliveryPathSchema,
  deliveryManifestSchema,
} from './delivery-common.ts';
export const dataScopeSchema = deliveryScopeSchema;
export type DataScope = z.infer<typeof dataScopeSchema>;
export const dataDigestSchema = deliveryDigestSchema;
export const dataFormatSchema = z.enum(['csv', 'jsonl', 'parquet']);
export const dataColumnSchema = z
  .object({ name: z.string().min(1).max(256), type: z.string().min(1).max(80), nullable: z.boolean() })
  .strict();
export const dataSchemaSchema = z
  .array(dataColumnSchema)
  .min(1)
  .max(512)
  .refine((v) => new Set(v.map((c) => c.name)).size === v.length, '列名重复');
export const dataEnvironmentSchema = z
  .object({
    assetId: dataDigestSchema,
    digest: dataDigestSchema,
    memoryMiB: z.number().int().min(512).max(8192).default(2048),
    cpus: z.number().int().min(1).max(4).default(2),
    timeoutSeconds: z.number().int().min(1).max(1800).default(300),
  })
  .strict();
export type DataEnvironment = z.infer<typeof dataEnvironmentSchema>;
export const dataParseSchema = z
  .object({
    delimiter: z.string().length(1).default(','),
    header: z.boolean().default(true),
    nullValue: z.string().max(64).default(''),
    schema: dataSchemaSchema.optional(),
  })
  .strict();
export const dataDatasetSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    digest: dataDigestSchema,
    name: z.string().min(1).max(160),
    manifestId: z.uuid(),
    manifestDigest: dataDigestSchema,
    format: dataFormatSchema,
    files: z.array(deliveryPathSchema).min(1).max(128),
    schema: dataSchemaSchema,
    parse: dataParseSchema,
    rows: z.number().int().nonnegative(),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(512 * 1024 ** 2),
    parents: z.array(dataDigestSchema).max(32),
    definitionDigest: dataDigestSchema,
    sensitivity: z.enum(['raw', 'redacted']),
    archived: z.boolean().default(false),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataDataset = z.infer<typeof dataDatasetSchema>;
export const dataRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('not-null'), column: z.string().min(1).max(256) }).strict(),
  z
    .object({ kind: z.literal('unique'), columns: z.array(z.string().min(1).max(256)).min(1).max(32) })
    .strict(),
  z
    .object({
      kind: z.literal('range'),
      column: z.string().min(1).max(256),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('allowed'),
      column: z.string().min(1).max(256),
      values: z.array(z.union([z.string().max(1024), z.number(), z.boolean(), z.null()])).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('row-count'),
      min: z.number().int().nonnegative(),
      max: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('reference'),
      column: z.string().min(1).max(256),
      datasetIndex: z.number().int().min(1).max(15),
      referenceColumn: z.string().min(1).max(256),
    })
    .strict(),
]);
export type DataRule = z.infer<typeof dataRuleSchema>;
export const dataScalarSchema = z.union([z.string().max(8192), z.number().finite(), z.boolean(), z.null()]);
export const dataParametersSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), dataScalarSchema)
  .refine((v) => Object.keys(v).length <= 32, '参数过多');
export const dataMaskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('drop'), column: z.string().min(1).max(256) }).strict(),
  z
    .object({ kind: z.literal('constant'), column: z.string().min(1).max(256), value: z.string().max(1024) })
    .strict(),
  z
    .object({
      kind: z.literal('prefix'),
      column: z.string().min(1).max(256),
      length: z.number().int().min(0).max(128),
    })
    .strict(),
  z
    .object({ kind: z.literal('bucket'), column: z.string().min(1).max(256), size: z.number().positive() })
    .strict(),
]);
export const dataTaskSchema = z
  .object({
    kind: z.enum(['inspect', 'transform', 'mask', 'quality', 'notebook']),
    environment: dataEnvironmentSchema,
    inputs: z
      .array(
        z
          .object({
            manifest: deliveryManifestSchema,
            files: z.array(deliveryPathSchema).min(1).max(128),
            format: dataFormatSchema,
            parse: dataParseSchema,
          })
          .strict(),
      )
      .max(16),
    sql: z.string().max(65536).optional(),
    parameters: dataParametersSchema.default({}),
    rules: z.array(dataRuleSchema).max(128).default([]),
    masks: z.array(dataMaskSchema).max(512).default([]),
    notebook: z
      .string()
      .max(8 * 1024 ** 2)
      .optional(),
    allowRaw: z.boolean().default(false),
    sample: z.number().int().min(0).max(100).default(0),
  })
  .strict();
export type DataTask = z.infer<typeof dataTaskSchema>;
export const dataTableOutputSchema = z
  .object({
    schema: dataSchemaSchema,
    rows: z.number().int().nonnegative(),
    files: z.array(deliveryPathSchema).max(128),
    format: dataFormatSchema,
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(256 * 1024 ** 2),
  })
  .strict();
export const dataCheckSchema = z
  .object({
    rule: dataRuleSchema,
    rows: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    verdict: z.enum(['pass', 'fail', 'unknown']),
    scope: z.enum(['full', 'sample']),
  })
  .strict();
export const dataOutputSchema = z
  .object({
    table: dataTableOutputSchema.optional(),
    checks: z.array(dataCheckSchema).max(128).default([]),
    columns: z
      .array(
        z
          .object({
            name: z.string().max(256),
            rows: z.number().int().nonnegative(),
            nulls: z.number().int().nonnegative(),
            distinct: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(512)
      .default([]),
    metrics: z.record(z.string().max(128), z.number().finite()).default({}),
    notebookFile: deliveryPathSchema.optional(),
    executedCells: z.number().int().nonnegative().optional(),
    environment: z.record(z.string().max(64), z.string().max(256)),
    truncated: z.boolean().default(false),
  })
  .strict();
export type DataOutput = z.infer<typeof dataOutputSchema>;
export const dataRunSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    definitionDigest: dataDigestSchema,
    task: dataTaskSchema,
    state: z.enum([
      'queued',
      'preparing',
      'running',
      'collecting',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ]),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    manifestId: z.uuid().optional(),
    output: dataOutputSchema.optional(),
    vmId: z.uuid().optional(),
    vmCreatedAt: z.string().optional(),
    vmToken: z.uuid().optional(),
    error: z.string().max(2048).optional(),
    createdAt: z.iso.datetime(),
    finishedAt: z.iso.datetime().optional(),
  })
  .strict();
export type DataRun = z.infer<typeof dataRunSchema>;
export const dataSqlSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    revision: z.number().int().positive(),
    name: z.string().min(1).max(160),
    sql: z.string().min(1).max(65536),
    parameters: dataParametersSchema,
    datasetIds: z.array(z.uuid()).min(1).max(16),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataSql = z.infer<typeof dataSqlSchema>;
export const dataNotebookSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    revision: z.number().int().positive(),
    content: z.string().max(8 * 1024 ** 2),
    digest: dataDigestSchema,
    datasetIds: z.array(z.uuid()).max(16),
    sensitivity: z.enum(['raw', 'redacted']),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataNotebook = z.infer<typeof dataNotebookSchema>;
export const dataEvidenceSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    kind: z.enum(['transform', 'quality', 'notebook', 'experiment']),
    inputIds: z.array(z.uuid()).max(16),
    inputDigests: z.array(dataDigestSchema).max(16),
    definitionDigest: dataDigestSchema,
    runId: z.uuid(),
    outputDatasetId: z.uuid().optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataEvidence = z.infer<typeof dataEvidenceSchema>;
export const dataSourceSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    manifestId: z.uuid(),
    manifestDigest: dataDigestSchema,
    format: dataFormatSchema,
    files: z.array(deliveryPathSchema).min(1).max(128),
    origin: z.enum(['upload', 'project', 'postgres', 'import']),
    parseHint: dataParseSchema.optional(),
    captureDefinitionDigest: dataDigestSchema.optional(),
    capturedAt: z.iso.datetime(),
    bytes: z
      .number()
      .int()
      .nonnegative()
      .max(512 * 1024 ** 2),
    complete: z.literal(true),
  })
  .strict();
export type DataSource = z.infer<typeof dataSourceSchema>;
export const dataComparisonSchema = z
  .object({
    status: z.enum(['comparable', 'conditional', 'incomparable']),
    differences: z.array(z.string().max(512)).max(200),
    leftId: z.uuid(),
    rightId: z.uuid(),
    metrics: z
      .array(
        z
          .object({
            name: z.string(),
            left: z.number().nullable(),
            right: z.number().nullable(),
            difference: z.number().nullable(),
          })
          .strict(),
      )
      .max(1000),
  })
  .strict();
export type DataComparison = z.infer<typeof dataComparisonSchema>;

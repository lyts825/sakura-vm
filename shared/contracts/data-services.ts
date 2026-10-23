/** 数据服务的操作与视图。 Data service operations and views. */
import { z } from 'zod';
import { dataStudySchema } from './data-study.ts';
import {
  dataScopeSchema,
  dataDatasetSchema,
  dataEvidenceSchema,
  dataSourceSchema,
  dataSqlSchema,
  dataNotebookSchema,
  dataRunSchema,
  dataEnvironmentSchema,
  dataDigestSchema,
  dataRuleSchema,
  dataParametersSchema,
  dataFormatSchema,
  dataParseSchema,
  dataMaskSchema,
  dataTaskSchema,
  dataComparisonSchema,
} from './data-common.ts';
import { imageAssetSchema, ownedImageVmSchema } from './image-assets.ts';
export const dataEnvironmentRecordSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    image: imageAssetSchema,
    versions: z.record(z.string(), z.string()),
    ready: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataEnvironmentRecord = z.infer<typeof dataEnvironmentRecordSchema>;
export const dataPreparationSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    state: z.enum(['preparing', 'succeeded', 'failed', 'interrupted']),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    receipt: ownedImageVmSchema.optional(),
    environmentId: z.uuid().optional(),
    error: z.string().max(2048).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataPreparation = z.infer<typeof dataPreparationSchema>;
export const dataSessionSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    receipt: ownedImageVmSchema,
    projectId: z.string(),
    hostPort: z.number().int().min(1024).max(65535),
    guestPort: z.number().int().min(1024).max(65535),
    state: z.enum(['starting', 'active', 'stopping', 'stopped', 'review']),
    sensitivity: z.enum(['raw', 'redacted']),
    notebookId: z.uuid(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataSession = z.infer<typeof dataSessionSchema>;
export const dataExperimentSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    kind: z.enum(['sql', 'notebook']),
    definitionId: z.uuid(),
    definitionDigest: dataDigestSchema,
    combinations: z.array(dataParametersSchema).min(1).max(32),
    evidenceIds: z.array(z.uuid()).max(32),
    environment: dataEnvironmentSchema.optional(),
    state: z.enum(['planned', 'running', 'finished', 'partial', 'failed', 'cancelled', 'interrupted']),
    error: z.string().max(2048).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataExperiment = z.infer<typeof dataExperimentSchema>;
export const dataImportSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    manifestId: z.uuid(),
    digest: dataDigestSchema,
    state: z.enum(['verified', 'quarantined', 'accepting', 'accepted', 'rejected']),
    namespace: z.string().max(120),
    datasetIds: z.array(z.uuid()).max(128),
    missingAncestors: z.array(dataDigestSchema).max(1000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataImport = z.infer<typeof dataImportSchema>;
export const dataGraphSchema = z
  .object({
    datasets: z.array(dataDatasetSchema).max(10000),
    evidence: z.array(dataEvidenceSchema).max(10000),
    missing: z.array(dataDigestSchema).max(10000),
  })
  .strict();
export type DataGraph = z.infer<typeof dataGraphSchema>;
export const dataRuleSetSchema = z
  .object({
    id: z.uuid(),
    scope: dataScopeSchema,
    name: z.string().min(1).max(160),
    revision: z.number().int().positive(),
    rules: z.array(dataRuleSchema).max(128),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DataRuleSet = z.infer<typeof dataRuleSetSchema>;
export const dataPgSchema = z
  .object({
    host: z.string().min(1).max(253),
    address: z.string().min(1).max(64),
    port: z.number().int().min(1).max(65535).default(5432),
    database: z.string().min(1).max(128),
    user: z.string().min(1).max(128),
    secretRef: z.string().min(1).max(128),
    secretVersion: z.string().min(1).max(128),
    schema: z.string().min(1).max(128).default('public'),
    table: z.string().min(1).max(128),
    columns: z
      .array(z.string().min(1).max(128))
      .min(1)
      .max(512)
      .refine((v) => new Set(v).size === v.length, '列名不能重复'),
    ca: z.string().max(65536).optional(),
    timeoutSeconds: z.number().int().min(1).max(300).default(60),
  })
  .strict();
export type DataPg = z.infer<typeof dataPgSchema>;
export const dataViewSchema = z
  .object({
    preparations: z.array(dataPreparationSchema).default([]),
    environments: z.array(dataEnvironmentRecordSchema).default([]),
    runs: z.array(dataRunSchema).default([]),
    sources: z.array(dataSourceSchema).default([]),
    datasets: z.array(dataDatasetSchema).default([]),
    queries: z.array(dataSqlSchema).default([]),
    rules: z.array(dataRuleSetSchema).default([]),
    notebooks: z.array(dataNotebookSchema).default([]),
    sessions: z.array(dataSessionSchema).default([]),
    evidence: z.array(dataEvidenceSchema).default([]),
    experiments: z.array(dataExperimentSchema).default([]),
    imports: z.array(dataImportSchema).default([]),
  })
  .strict();
export type DataView = z.infer<typeof dataViewSchema>;
const id = z.uuid();
const name = z.string().min(1).max(160);
const env = dataEnvironmentSchema;
export const dataActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('prepare-builtin'),
      name,
      distro: z.enum(['debian', 'ubuntu']),
      architecture: z.enum(['x86_64', 'aarch64']),
      allowDownload: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('prepare-environment'),
      name,
      assetId: dataDigestSchema,
      digest: dataDigestSchema,
      allowDownload: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('execute'), task: dataTaskSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('cancel'), id }).strict(),
  z.object({ action: z.literal('reconcile'), id }).strict(),
  z.object({ action: z.literal('reconcile-preparation'), id }).strict(),
  z
    .object({
      action: z.literal('capture-upload'),
      name,
      manifestId: id,
      format: dataFormatSchema,
      files: z.array(z.string().min(1).max(1024)).min(1).max(128),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('capture-project'),
      name,
      paths: z.array(z.string().min(1).max(1024)).min(1).max(128),
      format: dataFormatSchema,
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('credential-version'), secretRef: z.string().min(1).max(128) }).strict(),
  z
    .object({
      action: z.literal('capture-postgres'),
      name,
      connection: dataPgSchema,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('seal'),
      sourceId: id,
      name,
      parse: dataParseSchema,
      environment: env,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('mask'),
      datasetId: id,
      name,
      masks: z.array(dataMaskSchema).min(1).max(512),
      environment: env,
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('archive'), id }).strict(),
  z
    .object({
      action: z.literal('save-query'),
      id: id.optional(),
      expectedRevision: z.number().int().nonnegative(),
      name,
      sql: z.string().min(1).max(65536),
      parameters: dataParametersSchema,
      datasetIds: z.array(id).min(1).max(16),
    })
    .strict(),
  z
    .object({
      action: z.literal('run-query'),
      id,
      environment: env,
      parameters: dataParametersSchema.optional(),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('save-rules'),
      id: id.optional(),
      expectedRevision: z.number().int().nonnegative(),
      name,
      rules: z.array(dataRuleSchema).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal('check'),
      id,
      datasetIds: z.array(id).min(1).max(16),
      environment: env,
      sample: z.number().int().min(0).max(100).default(0),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('save-notebook'),
      id: id.optional(),
      expectedRevision: z.number().int().nonnegative(),
      name,
      content: z.string().max(8 * 1024 ** 2),
      datasetIds: z.array(id).max(16),
      allowRaw: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      action: z.literal('execute-notebook'),
      id,
      environment: env,
      parameters: dataParametersSchema.default({}),
      allowRaw: z.boolean().default(false),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('open-notebook'),
      id,
      environment: env,
      allowRaw: z.boolean().default(false),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('stop-notebook'), id }).strict(),
  z.object({ action: z.literal('notebook-link'), id }).strict(),
  z
    .object({
      action: z.literal('plan-experiment'),
      name,
      kind: z.enum(['sql', 'notebook']),
      definitionId: id,
      parameters: z.record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
        z
          .array(z.union([z.string().max(8192), z.number(), z.boolean(), z.null()]))
          .min(1)
          .max(32),
      ),
    })
    .strict(),
  z.object({ action: z.literal('cancel-experiment'), id }).strict(),
  z
    .object({
      action: z.literal('run-experiment'),
      id,
      environment: env,
      allowRaw: z.boolean().default(false),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('compare'), leftId: id, rightId: id }).strict(),
  z.object({ action: z.literal('graph') }).strict(),
  z
    .object({
      action: z.literal('export'),
      datasetIds: z.array(id).min(1).max(128),
      evidenceIds: z.array(id).max(32).default([]),
      allowOutputs: z.boolean().default(false),
      allowRaw: z.boolean().default(false),
      confirmed: z.literal(true),
    })
    .strict(),
  z.object({ action: z.literal('inspect-import'), id }).strict(),
  z.object({ action: z.literal('import-preview'), manifestId: id }).strict(),
  z.object({ action: z.literal('reconcile-import'), id }).strict(),
  z
    .object({
      action: z.literal('accept'),
      id,
      namespace: z.string().min(1).max(120),
      confirmed: z.literal(true),
    })
    .strict(),
]);
export type DataAction = z.infer<typeof dataActionSchema>;
export const dataResultSchema = z
  .object({
    preparation: dataPreparationSchema.optional(),
    study: dataStudySchema.optional(),
    credential: z.object({ name: z.string(), version: dataDigestSchema }).strict().optional(),
    recordId: id.optional(),
    run: dataRunSchema.optional(),
    dataset: dataDatasetSchema.optional(),
    source: dataSourceSchema.optional(),
    evidence: dataEvidenceSchema.optional(),
    query: dataSqlSchema.optional(),
    rules: dataRuleSetSchema.optional(),
    notebook: dataNotebookSchema.optional(),
    session: dataSessionSchema.optional(),
    experiment: dataExperimentSchema.optional(),
    import: dataImportSchema.optional(),
    environment: dataEnvironmentRecordSchema.optional(),
    graph: dataGraphSchema.optional(),
    comparison: dataComparisonSchema.optional(),
    manifestId: id.optional(),
    url: z.string().max(2048).optional(),
    message: z.string().max(2048).optional(),
  })
  .strict();
export type DataResult = z.infer<typeof dataResultSchema>;

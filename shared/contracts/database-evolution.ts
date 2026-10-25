/** 固定 PostgreSQL 声明，不接受 SQL、程序或外部数据库连接。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import { suiteExecutionPlan, suiteExecutionReceipt } from './suite-execution.ts';
export const databaseIdentifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
export const databaseType = z.enum([
  'text',
  'integer',
  'bigint',
  'numeric',
  'boolean',
  'date',
  'timestamptz',
]);
export const databaseCell = z.union([z.string().max(4096), z.boolean(), z.null()]);
export const databaseColumn = z
  .object({ name: databaseIdentifier, type: databaseType, nullable: z.boolean().default(true) })
  .strict();
export const databaseConstraint = z
  .object({
    name: databaseIdentifier,
    kind: z.enum(['primary', 'unique', 'not-null']),
    columns: z.array(databaseIdentifier).min(1).max(8),
  })
  .strict();
export const databaseIndex = z
  .object({
    name: databaseIdentifier,
    columns: z.array(databaseIdentifier).min(1).max(8),
    unique: z.boolean().default(false),
  })
  .strict();
export const databaseTable = z
  .object({
    name: databaseIdentifier,
    columns: z.array(databaseColumn).min(1).max(32),
    constraints: z.array(databaseConstraint).max(32).default([]),
    indexes: z.array(databaseIndex).max(32).default([]),
  })
  .strict();
export const databaseSchema = z
  .object({
    format: z.literal('sakura-database-schema/1'),
    tables: z.array(databaseTable).min(1).max(20),
    encoding: z.literal('UTF8'),
    timezone: z.literal('UTC'),
    collation: z.literal('C'),
  })
  .strict();
export const databaseRows = z
  .object({ table: databaseIdentifier, rows: z.array(z.array(databaseCell).max(32)).max(5000) })
  .strict();
export const databaseDataset = z
  .object({
    format: z.literal('sakura-database-dataset/1'),
    schema: databaseSchema,
    data: z.array(databaseRows).min(1).max(20),
    source: z.enum(['synthetic', 'reviewed-input', 'captured-baseline']),
    generatorSeed: z.string().max(100).nullable(),
  })
  .strict();
export const databaseBackfill = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), value: databaseCell }).strict(),
  z.object({ kind: z.literal('copy'), column: databaseIdentifier }).strict(),
  z.object({ kind: z.literal('lower'), column: databaseIdentifier }).strict(),
  z.object({ kind: z.literal('upper'), column: databaseIdentifier }).strict(),
  z.object({ kind: z.literal('coalesce'), column: databaseIdentifier, fallback: databaseCell }).strict(),
]);
export const databaseOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create-table'), table: databaseTable }).strict(),
  z.object({ kind: z.literal('add-column'), table: databaseIdentifier, column: databaseColumn }).strict(),
  z
    .object({
      kind: z.literal('rename-column'),
      table: databaseIdentifier,
      from: databaseIdentifier,
      to: databaseIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal('convert-column'),
      table: databaseIdentifier,
      column: databaseIdentifier,
      to: databaseType,
      rejectLoss: z.literal(true),
    })
    .strict(),
  z
    .object({ kind: z.literal('drop-column'), table: databaseIdentifier, column: databaseIdentifier })
    .strict(),
  z.object({ kind: z.literal('create-index'), table: databaseIdentifier, index: databaseIndex }).strict(),
  z
    .object({ kind: z.literal('add-constraint'), table: databaseIdentifier, constraint: databaseConstraint })
    .strict(),
  z
    .object({
      kind: z.literal('backfill'),
      table: databaseIdentifier,
      column: databaseIdentifier,
      expression: databaseBackfill,
      onlyNull: z.boolean().default(true),
    })
    .strict(),
]);
export const databaseProgram = z
  .object({
    format: z.literal('sakura-database-program/1'),
    baseline: S.suiteRef,
    baselineDigest: S.suiteDigest,
    operations: z.array(databaseOperation).min(1).max(50),
    resultingSchema: databaseSchema,
    risks: z
      .array(
        z
          .object({
            step: z.number().int().min(0),
            code: z.string().max(80),
            message: z.string().max(1000),
            destructive: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    stopOnError: z.literal(true),
    algorithm: z.literal('postgres-declarations-v1'),
  })
  .strict();
export const databaseUpload = S.suiteScope
  .extend({
    name: S.suiteName,
    text: z.string().max(1024 * 1024),
    format: z.enum(['json', 'csv']).default('json'),
    allowExport: z.boolean().default(false),
  })
  .strict();
export const databaseGenerate = S.suiteScope
  .extend({
    template: z.enum(['add-column-backfill', 'unique-conflict', 'independent-recovery']),
    rows: z.number().int().min(2).max(1000).default(20),
    seed: z.string().min(1).max(100).default('database-v1'),
  })
  .strict();
export const databasePin = S.suiteScope.extend({ source: S.suiteRef, reviewed: z.literal(true) }).strict();
export const databaseImportRows = S.suiteScope
  .extend({
    source: S.suiteRef,
    schema: databaseSchema,
    table: databaseIdentifier,
    nullToken: z.literal('\\N').default('\\N'),
  })
  .strict();
export const databaseCompile = S.suiteScope
  .extend({ schema: S.suiteRef, operations: z.array(databaseOperation).min(1).max(50) })
  .strict();
export const databaseSelect = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const databaseCompare = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict();
export const databaseSnapshot = z
  .object({
    format: z.literal('sakura-database-snapshot/1'),
    schema: databaseSchema,
    data: z.array(databaseRows).max(20),
    rowCounts: z.record(databaseIdentifier, z.number().int().min(0)),
    digest: S.suiteDigest,
    algorithm: z.literal('postgres-canonical-rows-v1'),
    coverage: z.literal('complete'),
    postgresVersion: z.string().max(200),
    databaseIdentity: z.string().min(1).max(200),
  })
  .strict();
export const databaseStep = z
  .object({
    sequence: z.number().int().min(0).max(49),
    operation: databaseOperation,
    state: z.enum(['observed', 'failed', 'unknown', 'not-started']),
    intentDigest: S.suiteDigest,
    beforeDigest: S.suiteDigest.nullable(),
    afterDigest: S.suiteDigest.nullable(),
    durationMs: z.number().min(0),
    sqlState: z.string().max(10).nullable(),
    error: z.string().max(1000).nullable(),
    transaction: z.literal('per-operation'),
  })
  .strict();
export const databaseWorkerInput = z
  .object({
    format: z.literal('sakura-database-worker/1'),
    mode: z.enum(['rehearse', 'restore']),
    dataset: databaseDataset,
    operations: z.array(databaseOperation).max(50),
    expectedBaselineDigest: S.suiteDigest.nullable(),
    deadline: z.iso.datetime(),
    lockTimeoutMs: z.number().int().min(100).max(5000).default(2000),
    statementTimeoutMs: z.number().int().min(100).max(30000).default(10000),
  })
  .strict();
export const databaseWorkerResult = z
  .object({
    format: z.literal('sakura-database-result/1'),
    state: z.enum(['completed', 'failed', 'interrupted']),
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    baseline: databaseSnapshot.nullable(),
    after: databaseSnapshot.nullable(),
    steps: z.array(databaseStep).max(50),
    recovery: z
      .object({
        expectedDigest: S.suiteDigest,
        actualDigest: S.suiteDigest,
        confirmed: z.boolean(),
        kind: z.literal('canonical-logical-baseline'),
      })
      .strict()
      .nullable(),
    cleanup: z.enum(['confirmed', 'unknown']),
    error: z.string().max(1000).nullable(),
    tool: z.literal('postgres-declarations-v1'),
  })
  .strict();
export const databaseFixturePrepare = S.suiteScope
  .extend({
    source: S.suiteRef,
    image: z.object({ assetId: S.suiteDigest, digest: S.suiteDigest }).strict(),
    name: S.suiteName.default('PostgreSQL 独立副本'),
  })
  .strict();
export const databaseRunPreview = S.suiteScope
  .extend({ fixture: S.suiteRef, changes: S.suiteRef, confirmDestructive: z.boolean().default(false) })
  .strict();
export const databaseRunAction = databaseSelect('run');
export const databaseRecovery = S.suiteScope
  .extend({ run: S.suiteRef, image: z.object({ assetId: S.suiteDigest, digest: S.suiteDigest }).strict() })
  .strict();
export const databaseReportInput = S.suiteScope
  .extend({
    run: S.suiteRef,
    checks: S.suiteRef,
    recovery: S.suiteRef.nullable().default(null),
    summary: z.string().min(1).max(4000),
    unresolved: z.array(z.string().min(1).max(1000)).max(30).default([]),
  })
  .strict();
export type DatabaseSchema = z.infer<typeof databaseSchema>;
export type DatabaseDataset = z.infer<typeof databaseDataset>;
export type DatabaseOperation = z.infer<typeof databaseOperation>;
export type DatabaseProgram = z.infer<typeof databaseProgram>;
export type DatabaseSnapshot = z.infer<typeof databaseSnapshot>;
export type DatabaseWorkerResult = z.infer<typeof databaseWorkerResult>;
export const databasePinned = z
  .object({
    format: z.literal('sakura-database-pinned/1'),
    source: S.suiteRef,
    dataset: databaseDataset,
    digest: S.suiteDigest,
    reviewed: z.literal(true),
    authorship: z.enum(['synthetic', 'human-reviewed']),
  })
  .strict();
export const databaseValidated = z
  .object({
    format: z.literal('sakura-database-validated/1'),
    source: S.suiteRef,
    schema: databaseSchema,
    digest: S.suiteDigest,
    rows: z.number().int().min(0).max(5000),
    declaredOnly: z.literal(true),
  })
  .strict();
export const databaseFixture = z
  .object({
    format: z.literal('sakura-database-fixture/1'),
    planId: S.suiteId,
    source: S.suiteRef,
    changes: S.suiteRef.nullable(),
    parentFixture: S.suiteRef.nullable(),
    mode: z.enum(['baseline', 'rehearse', 'restore']),
    executionPlan: suiteExecutionPlan,
    sessionId: S.suiteId,
    session: suiteExecutionReceipt.nullable(),
    result: databaseWorkerResult.nullable(),
    localExecution: z.literal(true),
    dispatchIntent: S.suiteDigest,
  })
  .strict();
export const databaseRun = z
  .object({
    format: z.literal('sakura-database-run/1'),
    fixture: S.suiteRef,
    changes: S.suiteRef.nullable(),
    mode: z.enum(['rehearse', 'restore']),
    restores: S.suiteRef.nullable(),
  })
  .strict();
export const databaseCheck = z
  .object({
    format: z.literal('sakura-database-check/1'),
    run: S.suiteRef,
    fixture: S.suiteRef,
    outcome: z.enum(['passed', 'failed', 'inconclusive']),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
    coverage: z.literal('complete-selected-data'),
    baselineDigest: S.suiteDigest.nullable(),
    afterDigest: S.suiteDigest.nullable(),
    totalSteps: z.number().int().min(0).max(50),
    observedSteps: z.number().int().min(0).max(50),
    failedSteps: z.number().int().min(0).max(50),
    unknownSteps: z.number().int().min(0).max(50),
    findings: z.array(z.string().max(1000)).max(60),
    recovery: databaseWorkerResult.shape.recovery,
    sourceClaimOnly: z.boolean(),
  })
  .strict();
export const databaseRehearsal = z
  .object({
    format: z.literal('sakura-database-rehearsal/1'),
    run: S.suiteRef,
    recovery: S.suiteRef.nullable(),
    check: S.suiteRef.nullable(),
    stage: z.enum(['running', 'review', 'recovering']),
    intentOnly: z.literal(false),
  })
  .strict();
export const databaseReport = z
  .object({
    format: z.literal('sakura-database-report/1'),
    run: S.suiteRef,
    check: S.suiteRef,
    recovery: S.suiteRef.nullable(),
    summary: z.string().max(4000),
    unresolved: z.array(z.string().max(1000)).max(30),
    assessment: databaseCheck,
    sealedBy: S.suiteId,
    sourceTrust: z.literal('local-original-provider'),
    restoreKind: z.literal('canonical-logical-baseline'),
    notProductionApproval: z.literal(true),
  })
  .strict();
export const databaseWorkbenchRequest = z
  .object({
    workspaceId: S.suiteId.optional(),
    cursor: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const databaseWorkbenchTemplate = z
  .object({
    id: databaseGenerate.shape.template,
    name: S.suiteName,
    description: z.string().max(1000),
    operations: z.array(databaseOperation).max(50),
    suggestedOnly: z.literal(true),
    automaticExecution: z.literal(false),
  })
  .strict();
export const databaseWorkbenchTemplates = z.array(databaseWorkbenchTemplate).length(3);
export const databaseWorkbenchView = z
  .object({
    workspaces: z.array(S.suiteWorkspace).max(50),
    workspace: S.suiteWorkspace.nullable(),
    domains: z
      .array(
        z
          .object({
            id: z.string().max(40),
            records: z
              .array(
                z
                  .object({
                    reference: S.suiteRef,
                    name: S.suiteName,
                    state: S.suiteRecord.shape.state,
                    kind: S.suiteRecord.shape.kind,
                    origin: S.suiteRecord.shape.origin,
                    summary: S.suiteJson,
                  })
                  .strict(),
              )
              .max(20),
            next: z.number().int().min(0).nullable(),
          })
          .strict(),
      )
      .max(9),
    capacity: z
      .object({
        used: z.number().int().min(0),
        reserved: z.number().int().min(0),
        limit: z.number().int().positive(),
        metadataLimit: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();

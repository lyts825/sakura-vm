/** HTTP 使用独立领域判别输入与严格输出；内部证据提交不公开。 Strict public domain HTTP schemas. */
import { z } from 'zod';
import { imageUploadSchema, imageAssetSchema } from './image-assets.ts';
import * as I from './integration-lab.ts';
import {
  integrationBundleSchema,
  integrationImportSchema,
  integrationUploadSchema,
} from './integration-exchange.ts';
export const integrationDomains = [
  'specs',
  'environments',
  'fixtures',
  'mocks',
  'scenarios',
  'assertions',
  'runners',
  'load',
  'reports',
  'exchange',
  'workbench',
] as const;
export type IntegrationDomain = (typeof integrationDomains)[number];
const action = <T extends string, S extends z.ZodRawShape>(name: T, shape: S) =>
  z.object({ action: z.literal(name), ...shape }).strict();
const definitionActions = <T extends z.ZodType>(content: T) =>
  [
    action('save', { ...I.saveBase.shape, content }),
    action('get', { ref: I.ilRef }),
    action('seal', { ref: I.ilRef }),
    action('archive', { ref: I.ilRef }),
  ] as const;
const compare = action('compare', { before: I.ilRef, after: I.ilRef });
const apply = action('apply', { planId: z.uuid(), digest: I.ilDigest, approveWrites: z.boolean() });
export const integrationRequestSchemas = {
  specs: z.union([
    ...definitionActions(I.httpContractSchema),
    action('create-workspace', { name: I.ilName }),
    compare,
  ]),
  environments: z.union([
    action('application-targets', {}),
    ...definitionActions(I.environmentSchema),
    action('versions', { ref: I.ilRef }),
    action('revoke', { ref: I.ilRef }),
  ]),
  fixtures: z.union([
    ...definitionActions(I.fixtureSchema),
    action('import', {
      name: I.ilName,
      format: z.enum(['json', 'csv']),
      text: z.string().max(50 * 1024 ** 2),
      redact: z.array(I.ilId).max(100),
    }),
    action('generate', {
      name: I.ilName,
      seed: z.number().int().min(0).max(0xffffffff),
      rows: z.number().int().min(1).max(10000),
    }),
  ]),
  mocks: z.union(definitionActions(I.mockSchema)),
  scenarios: z.union([...definitionActions(I.scenarioSchema), action('compile', { ref: I.ilRef })]),
  assertions: z.union(definitionActions(I.assertionSchema)),
  runners: z.union([
    action('images', {}),
    action('image-uploads', {}),
    action(
      'image-begin',
      imageUploadSchema.pick({ digest: true, bytes: true, distro: true, architecture: true, source: true })
        .shape,
    ),
    action('image-append', {
      id: z.uuid(),
      offset: z.number().int().nonnegative(),
      data: z.string().max(700000),
    }),
    action('image-finish', { id: z.uuid() }),
    action('image-discard', { id: z.uuid() }),
    action('preview', { input: I.runPreviewSchema }),
    apply,
    ...(['inspect', 'cancel', 'recover'] as const).map((name) => action(name, { id: z.uuid() })),
    action('verify-effect', {
      id: z.uuid(),
      evidenceDigest: I.ilDigest,
      conclusion: z.enum(['confirmed-applied', 'confirmed-not-applied', 'unresolved']),
    }),
  ]),
  load: z.union([...definitionActions(I.loadProfileSchema), action('preview', { ref: I.ilRef }), apply]),
  reports: z.union([
    action('get', { id: z.uuid() }),
    action('seal', { runId: z.uuid() }),
    action('compare', { before: z.uuid(), after: z.uuid() }),
    action('cleanup-plan', {}),
    action('cleanup', { digest: I.ilDigest }),
  ]),
  exchange: z.union([
    action('upload-begin', {
      name: I.ilName,
      bytes: z
        .number()
        .int()
        .positive()
        .max(256 * 1024 ** 2),
      digest: I.ilDigest,
      contentType: z.literal('application/zip'),
    }),
    action('upload-append', {
      id: z.uuid(),
      offset: z.number().int().nonnegative(),
      data: z.string().max(700000),
    }),
    action('upload-complete', { id: z.uuid() }),
    action('upload-discard', { id: z.uuid() }),
    action('uploads', {}),
    action('export', {
      scenario: I.ilRef,
      mock: I.ilRef.nullable(),
      assertions: I.ilRef,
      reports: z.array(z.uuid()).max(100),
    }),
    action('quarantine', { bundle: integrationBundleSchema }),
    action('accept', { id: z.uuid(), digest: I.ilDigest }),
  ]),
  workbench: action('create', {
    name: I.ilName,
    template: z.enum(['order-demo', 'pagination', 'contract-change']),
  }),
};
const envelope = <T extends z.ZodType>(value: T) => z.object({ result: value }).strict();
const def = <T extends z.ZodType>(value: T, extra: z.ZodType[] = []) => ({
  view: envelope(z.array(I.revisionSchema(value))),
  act: envelope(z.union([I.revisionSchema(value), ...extra])),
});
const templateSchema = z
  .object({ id: z.enum(['order-demo', 'pagination', 'contract-change']), name: I.ilName })
  .strict();
const workbenchResult = z
  .object({
    workspace: I.workspaceSchema,
    scenario: I.ilRef.nullable(),
    mock: I.ilRef.nullable(),
    assertions: I.ilRef.nullable(),
    comparison: I.comparisonSchema.nullable(),
  })
  .strict();
export const integrationResponseSchemas = {
  specs: {
    view: envelope(
      z
        .object({
          workspaces: z.array(I.workspaceSchema),
          definitions: z.array(I.revisionSchema(I.httpContractSchema)),
          comparisons: z.array(I.comparisonSchema),
        })
        .strict(),
    ),
    act: envelope(z.union([I.revisionSchema(I.httpContractSchema), I.workspaceSchema, I.comparisonSchema])),
  },
  environments: def(I.environmentSchema, [
    z
      .object({
        available: z.boolean(),
        targets: z.array(
          z
            .object({
              appId: z.uuid(),
              name: z.string(),
              revision: z.number().int().positive(),
              identityDigest: I.ilDigest,
            })
            .strict(),
        ),
      })
      .strict(),
    z.record(z.string(), z.string()),
    z.object({ revoked: z.literal(true) }).strict(),
  ]),
  fixtures: def(I.fixtureSchema),
  mocks: def(I.mockSchema),
  scenarios: def(I.scenarioSchema, [z.object({ digest: I.ilDigest, order: z.array(I.ilId) }).strict()]),
  assertions: def(I.assertionSchema),
  runners: {
    view: envelope(z.object({ runs: z.array(I.runSchema), plans: z.array(I.runPlanSchema) }).strict()),
    act: envelope(
      z.union([
        I.runSchema,
        I.runPlanSchema,
        imageUploadSchema,
        imageAssetSchema,
        z.array(imageUploadSchema),
        z.array(imageAssetSchema),
        z.object({ discarded: z.literal(true) }).strict(),
      ]),
    ),
  },
  load: def(I.loadProfileSchema, [I.runPlanSchema, I.runSchema]),
  reports: {
    view: envelope(z.array(I.reportSchema)),
    act: envelope(
      z.union([
        I.reportSchema,
        z
          .object({
            comparable: z.boolean(),
            reasons: z.array(z.string()),
            before: I.reportSchema,
            after: I.reportSchema,
          })
          .strict(),
        z.object({ digest: I.ilDigest, ids: z.array(z.uuid()), protected: z.array(z.uuid()) }).strict(),
        z.object({ removed: z.number().int().nonnegative() }).strict(),
      ]),
    ),
  },
  exchange: {
    view: envelope(z.array(integrationImportSchema)),
    act: envelope(
      z.union([
        integrationBundleSchema,
        integrationImportSchema,
        integrationUploadSchema,
        z.array(integrationUploadSchema),
      ]),
    ),
  },
  workbench: {
    view: envelope(
      z.union([
        z.array(templateSchema),
        z
          .object({
            workspace: I.workspaceSchema,
            runs: z.array(I.runSchema),
            reports: z.array(I.reportSchema),
          })
          .strict(),
      ]),
    ),
    act: envelope(workbenchResult),
  },
};
export const integrationQuerySchema = z.object({ workspaceId: z.uuid().optional() }).strict();

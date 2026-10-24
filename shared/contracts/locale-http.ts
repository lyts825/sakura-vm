/** 本地化的逐方法 HTTP 请求、响应和读写策略。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
import * as L from './locale-studio.ts';
import { captureRequestSchema } from './files-capture.ts';
import {
  suiteMethod as method,
  suiteEmpty,
  suiteCapacity,
  suiteControls as controls,
  suiteMaterialMethods,
  suiteExchangeMethods,
} from './suite-http.ts';
const select = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const localeHttpSchemas = {
  catalogs: {
    ...suiteMaterialMethods(),
    upload: method(
      S.suiteScope
        .extend({
          name: S.suiteName,
          text: z.string().max(1024 * 1024),
          allowExport: z.boolean().default(false),
        })
        .strict(),
      S.suiteRecord,
    ),
    importJson: method(L.localeImport, S.suiteRecord),
    compare: method(L.localeCompare, S.suiteRecord),
    planCapture: method(
      S.suiteScope
        .extend({ request: captureRequestSchema, allowExport: z.boolean().default(false) })
        .strict(),
      S.suitePlan,
    ),
    capture: method(S.suiteApproval, z.array(S.suiteRecord).max(1000)),
  },
  contexts: {
    ...controls(),
    attach: method(L.localeContextAttach, S.suiteRecord),
    inspect: method(select('contexts'), S.suiteRecord, true),
  },
  terminology: {
    ...controls(L.localeTerminology),
    validate: method(
      select('terminology'),
      z.object({ valid: z.boolean(), conflicts: z.array(z.string()).max(10000) }).strict(),
      true,
    ),
    lookup: method(
      select('terminology')
        .extend({ text: z.string().max(16384) })
        .strict(),
      z.array(L.localeTerm).max(5000),
      true,
    ),
  },
  translations: {
    applyDelta: method(L.localeDelta, S.suiteRecord),
    ...controls(),
    revise: method(L.localeRevise, S.suiteRecord),
    markStale: method(select('translation').extend({ catalog: S.suiteRef }).strict(), S.suiteRecord),
    suggestFromMemory: method(
      select('catalog')
        .extend({
          terminology: S.suiteRef,
          language: L.localeLanguage,
          keys: z.array(L.localeKey).min(1).max(100),
        })
        .strict(),
      z
        .object({
          language: L.localeLanguage,
          candidates: z
            .array(
              z
                .object({
                  key: L.localeKey,
                  text: L.localeText,
                  translation: S.suiteRef,
                  reviewReceipt: S.suiteRef,
                  acceptedAutomatically: z.literal(false),
                })
                .strict(),
            )
            .max(500),
          provenance: z.literal('local-single-owner-review'),
        })
        .strict(),
      true,
    ),
  },
  checks: {
    ...controls(),
    evaluate: method(L.localeCheckInput, S.suiteRecord),
    explain: method(
      select('check').extend({ key: L.localeKey.optional() }).strict(),
      z
        .object({
          total: z.number().int().min(0),
          translated: z.number().int().min(0),
          result: z.enum(['passed', 'failed']),
          findings: z.array(L.localeFinding).max(100000),
        })
        .strict(),
      true,
    ),
  },
  previews: {
    ...controls(),
    render: method(L.localePreviewInput, S.suiteRecord),
    compare: method(L.localeCompare, S.suiteRecord),
  },
  reviews: {
    ...controls(),
    open: method(L.localeReviewOpen, S.suiteRecord),
    decide: method(L.localeDecision, S.suiteRecord),
    recheck: method(
      select('review'),
      z.object({ valid: z.boolean(), reviewer: S.suiteId, singleOwnerReview: z.literal(true) }).strict(),
      true,
    ),
  },
  releases: {
    ...controls(),
    active: method(S.suiteScope, S.suiteRecord.nullable(), true),
    preview: method(L.localeReleaseInput, S.suitePlan),
    publishLocal: method(S.suiteApproval, S.suiteRecord),
    previewRollback: method(select('release'), S.suitePlan),
    rollback: method(S.suiteApproval, S.suiteRecord),
    makePatch: method(select('release'), S.suiteRecord),
  },
  exchange: suiteExchangeMethods(),
  workbench: {
    ...controls(),
    templates: method(
      suiteEmpty,
      z.array(z.object({ id: z.string(), name: z.string(), description: z.string() }).strict()).max(10),
      true,
    ),
    createExample: method(
      z
        .object({ name: S.suiteName, template: z.enum(['app-text', 'error-messages', 'source-update']) })
        .strict(),
      z.object({ workspace: S.suiteWorkspace, example: S.suiteRecord }).strict(),
    ),
    runChecks: method(
      L.localeCheckInput
        .extend({ width: z.enum(['320', '768', '1280']).default('320'), pseudo: z.boolean().default(false) })
        .strict(),
      z
        .object({ run: S.suiteRecord, check: S.suiteRecord, preview: S.suiteRecord, review: S.suiteRecord })
        .strict(),
    ),
    view: method(
      z.object({ workspaceId: S.suiteId.optional() }).strict(),
      z
        .object({
          workspaces: z.array(S.suiteWorkspace).max(50),
          workspace: S.suiteWorkspace.nullable(),
          capacity: suiteCapacity.nullable(),
          domains: z
            .array(
              z
                .object({
                  id: z.string(),
                  records: z.array(S.suiteRecord).max(10),
                  error: z.string().nullable(),
                })
                .strict(),
            )
            .max(9),
        })
        .strict(),
      true,
    ),
  },
} as const;
export type LocaleDomain = keyof typeof localeHttpSchemas;
export const localeHttpRequests = Object.fromEntries(
  Object.entries(localeHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, schema]) => [`locale-${domain}.${method}`, schema.request]),
  ),
);
export const localeHttpResponses = Object.fromEntries(
  Object.entries(localeHttpSchemas).flatMap(([domain, methods]) =>
    Object.entries(methods).map(([method, schema]) => [`locale-${domain}.${method}`, schema.response]),
  ),
);

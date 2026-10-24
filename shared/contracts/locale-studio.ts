/** 本地化目录、译文、质量结果与发布的固定数据协议。 */
import { z } from 'zod';
import * as S from './suite-common.ts';
export const localeLanguage = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/);
export const localeKey = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u);
export const localeText = z.string().max(16384);
export const localeEntry = z
  .object({
    key: localeKey,
    text: localeText,
    digest: S.suiteDigest,
    placeholders: z
      .array(
        z
          .object({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), count: z.number().int().positive() })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export const localeCatalog = z
  .object({
    format: z.literal('sakura-locale-catalog/1'),
    language: localeLanguage,
    role: z.enum(['source', 'target']),
    source: S.suiteRef,
    sourceDigest: S.suiteDigest,
    bytes: z
      .number()
      .int()
      .min(0)
      .max(32 * 1024 ** 2),
    entries: z.array(localeEntry).max(50000),
  })
  .strict();
export const localeImport = S.suiteScope
  .extend({ source: S.suiteRef, language: localeLanguage, role: z.enum(['source', 'target']) })
  .strict();
export const localeCompare = S.suiteScope.extend({ before: S.suiteRef, after: S.suiteRef }).strict();
export const localeContextItem = z
  .object({
    key: localeKey,
    description: z.string().max(4000),
    location: z.string().max(1000),
    maxGraphemes: z.number().int().positive().max(100000).nullable(),
    screenshot: S.suiteRef.nullable(),
  })
  .strict();
export const localeContexts = z
  .object({ catalog: S.suiteRef, items: z.array(localeContextItem).max(50000) })
  .strict();
export const localeContextAttach = S.suiteScope.extend(localeContexts.shape).strict();
export const localeTerm = z
  .object({
    source: z.string().min(1).max(240),
    target: z.string().min(1).max(240),
    forbidden: z.array(z.string().min(1).max(240)).max(20),
  })
  .strict();
export const localeTerminology = z
  .object({
    language: localeLanguage,
    domain: z.string().min(1).max(120),
    terms: z.array(localeTerm).max(5000),
  })
  .strict();
export const localeTranslationItem = z
  .object({ key: localeKey, text: localeText, sourceDigest: S.suiteDigest, stale: z.boolean() })
  .strict();
export const localeTranslation = z
  .object({
    format: z.literal('sakura-locale-translations/1'),
    catalog: S.suiteRef,
    language: localeLanguage,
    terminology: S.suiteRef,
    contexts: S.suiteRef.nullable(),
    items: z.array(localeTranslationItem).max(50000),
    provenance: z.enum(['manual', 'catalog-import', 'memory-candidate']),
  })
  .strict();
export const localeRevise = S.suiteScope
  .extend({
    id: S.suiteId.optional(),
    expectedRevision: S.suiteDigest.optional(),
    name: S.suiteName,
    catalog: S.suiteRef,
    language: localeLanguage,
    terminology: S.suiteRef,
    contexts: S.suiteRef.nullable(),
    items: z.array(z.object({ key: localeKey, text: localeText }).strict()).max(50000),
    targetCatalog: S.suiteRef.optional(),
  })
  .strict();
export const localeDelta = S.suiteScope
  .extend({
    translation: S.suiteRef,
    terminology: S.suiteRef.optional(),
    contexts: S.suiteRef.nullable().optional(),
    items: z.array(z.object({ key: localeKey, text: localeText }).strict()).max(50),
    remove: z.array(localeKey).max(50).default([]),
  })
  .strict()
  .refine((value) => value.items.length + value.remove.length > 0, '至少修改或移除一个键');
export const localeFinding = z
  .object({
    id: S.suiteDigest,
    key: localeKey,
    code: z.enum(['missing', 'stale', 'placeholder', 'term', 'forbidden', 'length']),
    severity: z.enum(['error', 'warning']),
    message: z.string().max(1000),
  })
  .strict();
export const localeCheck = z
  .object({
    format: z.literal('sakura-locale-check/1'),
    catalog: S.suiteRef,
    translation: S.suiteRef,
    terminology: S.suiteRef,
    contexts: S.suiteRef.nullable(),
    language: localeLanguage,
    total: z.number().int().min(0),
    translated: z.number().int().min(0),
    findings: z.array(localeFinding).max(100000),
    result: z.enum(['passed', 'failed']),
    measurement: z.literal('unicode-graphemes'),
  })
  .strict();
export const localeCheckInput = S.suiteScope
  .extend({ catalog: S.suiteRef, translation: S.suiteRef })
  .strict();
export const localePreviewInput = S.suiteScope
  .extend({
    check: S.suiteRef,
    width: z.enum(['320', '768', '1280']),
    pseudo: z.boolean(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().positive().max(100).default(100),
  })
  .strict();
export const localePreview = z
  .object({
    format: z.literal('sakura-locale-preview/1'),
    check: S.suiteRef,
    catalog: S.suiteRef,
    translation: S.suiteRef,
    language: localeLanguage,
    direction: z.enum(['ltr', 'rtl']),
    width: z.enum(['320', '768', '1280']),
    pseudo: z.boolean(),
    measurement: z.literal('estimate'),
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    items: z
      .array(
        z
          .object({
            key: localeKey,
            source: localeText,
            text: z.string().max(40000),
            graphemes: z.number().int().min(0),
            estimatedLines: z.number().int().min(1),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const localeReview = z
  .object({
    format: z.literal('sakura-locale-review/1'),
    check: S.suiteRef,
    preview: S.suiteRef,
    status: z.enum(['open', 'accepted', 'rejected']),
    note: z.string().max(4000),
    acknowledged: z.array(S.suiteDigest).max(100000),
    reviewer: S.suiteId,
    singleOwnerReview: z.literal(true),
  })
  .strict();
export const localeReviewOpen = S.suiteScope.extend({ check: S.suiteRef, preview: S.suiteRef }).strict();
export const localeDecision = S.suiteScope
  .extend({
    review: S.suiteRef,
    decision: z.enum(['accept', 'reject']),
    note: z.string().trim().min(1).max(4000),
    acknowledged: z.array(S.suiteDigest).max(100000),
  })
  .strict();
export const localeReleaseInput = S.suiteScope
  .extend({
    catalog: S.suiteRef,
    translations: z.array(S.suiteRef).min(1).max(19),
    reviews: z.array(S.suiteRef).min(1).max(19),
    fallback: z.enum(['reject', 'source']),
  })
  .strict();
export const localeReleaseFile = z
  .object({
    path: z.string().regex(/^[a-zA-Z0-9-]+\.json$/),
    language: localeLanguage,
    bytes: z.number().int().min(0),
    digest: S.suiteDigest,
    text: z.string().max(2 * 1024 ** 2),
    originalDigest: S.suiteDigest.nullable(),
    fallbackKeys: z.array(localeKey).max(50000),
  })
  .strict();
export const localeRelease = z
  .object({
    format: z.literal('sakura-locale-release/1'),
    catalog: S.suiteRef,
    translations: z.array(S.suiteRef).max(19),
    reviews: z.array(S.suiteRef).max(19),
    fallback: z.enum(['reject', 'source']),
    files: z.array(localeReleaseFile).min(1).max(20),
    activationSequence: z.number().int().positive(),
    previous: S.suiteRef.nullable(),
    rollbackOf: S.suiteRef.nullable(),
  })
  .strict();
export const localeMemoryInput = S.suiteScope
  .extend({ translation: S.suiteRef, review: S.suiteRef })
  .strict();
export type LocaleLanguage = z.infer<typeof localeLanguage>;

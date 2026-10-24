/** 每个 HTTP 方法独立输入输出，不提供全包万能动作。 Explicit per-domain HTTP request/response schemas. */
import { z } from 'zod';
import * as K from './knowledge-studio.ts';
import { captureRequestSchema, captureRefreshSchema } from './files-capture.ts';
import { ownerDomainRoutes, http } from '../plugin-protocol.ts';
const empty = z.object({}).strict(),
  scope = K.scopeSchema,
  pin = K.pinSchema,
  token = scope.extend({ token: K.kid }).strict(),
  object = scope.extend({ id: K.kid }).strict(),
  revision = object.extend({ expectedRevision: z.number().int().positive() }).strict();
const capacity = z
  .object({
    used: z.number().int().min(0),
    reserved: z.number().int().min(0),
    totalLimit: z.number().int().positive(),
    recoveryReserve: z.number().int().min(0),
  })
  .strict();
const method = (request: z.ZodType, response: z.ZodType, read = false) => ({ request, response, read });
export const knowledgeHttpSchemas = {
  sources: {
    createSpace: method(z.object({ name: z.string().min(1).max(120) }).strict(), K.spaceSchema),
    listSpaces: method(empty, z.array(K.spaceSchema).max(20), true),
    space: method(scope, K.spaceSchema, true),
    revokeSpace: method(
      scope.extend({ expectedRevision: z.number().int().positive(), revoked: z.boolean() }).strict(),
      K.spaceSchema,
    ),
    listSources: method(scope, z.array(K.sourceSchema).max(50000), true),
    getSource: method(pin, K.sourceSchema, true),
    upload: method(
      scope
        .extend({
          name: z.string().min(1).max(240),
          format: K.formatSchema,
          data: z.string().max(12 * 1024 ** 2),
          policy: K.policySchema,
          sourceId: K.kid.optional(),
          expectedRevision: z.number().int().positive().optional(),
        })
        .strict(),
      K.sourceSchema,
    ),
    redact: method(
      pin
        .extend({
          ranges: z
            .array(z.object({ start: z.number().int().min(0), end: z.number().int().positive() }).strict())
            .min(1)
            .max(1000),
          name: z.string().min(1).max(240),
          policy: K.policySchema,
        })
        .strict(),
      K.sourceSchema,
    ),
    planCapture: method(
      scope
        .extend({
          request: captureRequestSchema,
          policy: K.policySchema,
          refresh: captureRefreshSchema.optional(),
        })
        .strict(),
      K.planSchema,
    ),
    capture: method(token, z.array(K.sourceSchema).max(2000)),
    read: method(
      pin,
      z.object({ source: K.sourceSchema, data: z.string().max(24 * 1024 ** 2) }).strict(),
      true,
    ),
    verify: method(pin, z.object({ digest: K.digest, bytes: z.number().int().min(0) }).strict(), true),
    planPolicy: method(
      object
        .extend({
          expectedRevision: z.number().int().positive(),
          policy: K.policySchema,
          revoked: z.boolean(),
        })
        .strict(),
      K.planSchema,
    ),
    applyPolicy: method(token, K.sourceSchema),
    capacity: method(scope, capacity, true),
    planCleanup: method(scope, K.planSchema),
    cleanup: method(
      token,
      z.object({ removed: z.array(K.kid), protected: z.array(K.kid), pending: z.array(K.kid) }).strict(),
    ),
  },
  extract: {
    plan: method(scope.extend({ sources: z.array(K.refSchema).min(1).max(2000) }).strict(), K.planSchema),
    run: method(token, z.array(K.extractionSchema).max(2000)),
    get: method(pin, K.extractionSchema, true),
    list: method(scope, z.array(K.extractionSchema).max(10000), true),
    jobs: method(scope, z.array(K.jobSchema).max(10000), true),
    cancel: method(object, K.jobSchema),
  },
  index: {
    plan: method(scope.extend({ extractions: z.array(K.refSchema).min(1).max(2000) }).strict(), K.planSchema),
    build: method(token, K.indexSchema),
    search: method(
      scope
        .extend({
          query: z.string().min(1).max(500),
          generation: K.refSchema.optional(),
          limit: z.number().int().min(1).max(50),
        })
        .strict(),
      K.searchSchema,
      true,
    ),
    coverage: method(
      scope,
      z
        .object({ indexed: z.number().int().min(0), omitted: z.number().int().min(0), stale: z.boolean() })
        .strict(),
      true,
    ),
    jobs: method(scope, z.array(K.jobSchema).max(10000), true),
    cancel: method(object, K.jobSchema),
  },
  evidence: {
    create: method(
      scope
        .extend({ extraction: K.refSchema, start: z.number().int().min(0), end: z.number().int().positive() })
        .strict(),
      K.citationSchema,
    ),
    inspect: method(pin, K.citationSchema, true),
    check: method(pin, K.checkSchema, true),
    migrate: method(
      pin.extend({ target: K.refSchema }).strict(),
      z
        .object({
          candidates: z
            .array(
              z
                .object({
                  start: z.number().int().min(0),
                  end: z.number().int().positive(),
                  locator: z.string().max(240),
                })
                .strict(),
            )
            .max(100000),
          ambiguous: z.boolean(),
        })
        .strict(),
      true,
    ),
    list: method(scope, z.array(K.citationSchema).max(10000), true),
  },
  entries: {
    create: method(scope.extend(K.entryContentSchema.shape).strict(), K.entrySchema),
    revise: method(revision.extend(K.entryContentSchema.shape).strict(), K.entrySchema),
    readPinned: method(pin, K.entrySchema, true),
    list: method(scope, z.array(K.entrySchema).max(10000), true),
    compare: method(
      object.extend({ left: z.number().int().positive(), right: z.number().int().positive() }).strict(),
      z.object({ left: K.entrySchema, right: K.entrySchema }).strict(),
      true,
    ),
    archive: method(revision, K.entrySchema),
  },
  documents: {
    templates: method(
      empty,
      z
        .array(
          z.object({ id: K.templateSchema, headings: z.array(z.string()), revision: z.literal(1) }).strict(),
        )
        .length(4),
      true,
    ),
    create: method(scope.extend(K.documentContentSchema.shape).strict(), K.documentSchema),
    revise: method(revision.extend(K.documentContentSchema.shape).strict(), K.documentSchema),
    readPinned: method(pin, K.documentSchema, true),
    list: method(scope, z.array(K.documentSchema).max(10000), true),
    compare: method(
      object.extend({ left: z.number().int().positive(), right: z.number().int().positive() }).strict(),
      z.object({ left: K.documentSchema, right: K.documentSchema }).strict(),
      true,
    ),
    archive: method(revision, K.documentSchema),
  },
  reviews: {
    open: method(scope.extend({ document: K.refSchema }).strict(), K.reviewSchema),
    readPinned: method(pin, K.reviewSchema, true),
    decide: method(
      revision
        .extend({
          decision: z.enum(['accepted', 'changes-requested', 'revoked']),
          acknowledgements: z.array(z.string().max(120)).max(10000),
          note: z.string().min(1).max(8000),
        })
        .strict(),
      K.reviewSchema,
    ),
    recheck: method(pin, K.reviewSchema, true),
    list: method(scope, z.array(K.reviewSchema).max(10000), true),
  },
  publish: {
    plan: method(scope.extend({ document: K.refSchema, review: K.refSchema }).strict(), K.planSchema),
    apply: method(token, K.publicationSchema),
    read: method(scope.extend({ id: K.kid.optional() }).strict(), K.publicationSchema, true),
    withdraw: method(object.extend({ reason: z.string().min(1).max(2000) }).strict(), K.publicationSchema),
    rollback: method(object, K.planSchema),
    list: method(
      scope,
      z
        .array(
          z
            .object({
              id: K.kid,
              revision: z.number().int().positive(),
              document: K.refSchema,
              withdrawn: z.boolean(),
              active: z.boolean(),
            })
            .strict(),
        )
        .max(10000),
      true,
    ),
  },
  exchange: {
    planExport: method(
      scope
        .extend({ document: K.refSchema, review: K.refSchema, mode: z.enum(['reading', 'handover']) })
        .strict(),
      K.planSchema,
    ),
    export: method(
      token,
      z.object({ id: K.kid, digest: K.digest, mode: z.enum(['reading', 'handover']) }).strict(),
    ),
    download: method(object, K.bundleSchema, true),
    inspectImport: method(z.object({ bundle: K.bundleSchema }).strict(), K.quarantineSchema),
    acceptImport: method(
      z.object({ id: K.kid, name: z.string().min(1).max(120), acceptUnverified: z.literal(true) }).strict(),
      K.quarantineSchema,
    ),
    imports: method(empty, z.array(K.quarantineSchema).max(10000), true),
    discardImport: method(z.object({ id: K.kid }).strict(), K.quarantineSchema),
  },
  workbench: {
    view: method(
      scope,
      z
        .object({
          space: K.spaceSchema,
          sources: z.array(K.sourceSchema),
          entries: z.array(K.entrySchema),
          documents: z.array(K.documentSchema),
          reviews: z.array(K.reviewSchema),
          jobs: z.array(K.jobSchema),
          capacity,
        })
        .strict(),
      true,
    ),
    preferences: method(
      scope.extend({ step: z.string().min(1).max(80) }).strict(),
      scope.extend({ step: z.string().max(80) }).strict(),
    ),
    example: method(
      z.object({ name: z.string().min(1).max(120), template: K.templateSchema }).strict(),
      z.object({ space: K.spaceSchema, sources: z.array(K.sourceSchema) }).strict(),
    ),
  },
} as const;
export type KnowledgeDomain = keyof typeof knowledgeHttpSchemas;
export const knowledgeHttpRequests: Record<string, z.ZodType> = {};
export const knowledgeHttpResponses: Record<string, z.ZodType> = {};
for (const [domain, methods] of Object.entries(knowledgeHttpSchemas))
  for (const [name, schema] of Object.entries(methods)) {
    knowledgeHttpRequests[`knowledge-${domain}.${name}`] = schema.request;
    knowledgeHttpResponses[`knowledge-${domain}.${name}`] = schema.response;
  }
export function knowledgeRoutes(domain: KnowledgeDomain) {
  return Object.entries(knowledgeHttpSchemas[domain]).map(([id, schema]) => {
    const path = `/api/knowledge-${domain}/${id}`,
      policy = ownerDomainRoutes(path)![schema.read ? 0 : 1].policy;
    return {
      id,
      path,
      method: 'POST' as const,
      handler: 'route' as const,
      status: 200,
      policy: { ...policy, mutating: !schema.read },
    };
  });
}
export function knowledgeHttp(domain: KnowledgeDomain) {
  return [http(`/api/knowledge-${domain}`, ['POST'])];
}

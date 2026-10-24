/** 知识领域的严格数据契约。 Strict, versioned knowledge DTOs; no executable payloads. */
import { z } from 'zod';
export const kid = z.string().uuid();
export const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const purposeSchema = z.enum(['read', 'index', 'cite', 'publish', 'export']);
export const scopeSchema = z.object({ spaceId: kid }).strict();
export const refSchema = z.object({ id: kid, revision: z.number().int().positive() }).strict();
export const pinSchema = scopeSchema.extend({ ...refSchema.shape, purpose: purposeSchema }).strict();
export const dependencySchema = refSchema
  .extend({ digest, policyRevision: z.number().int().positive() })
  .strict();
export const policySchema = z
  .object({
    read: z.boolean(),
    index: z.boolean(),
    cite: z.boolean(),
    publish: z.boolean(),
    export: z.boolean(),
  })
  .strict();
export const defaultPolicy = { read: true, index: true, cite: true, publish: true, export: false };
export const formatSchema = z.enum(['text', 'markdown', 'json', 'csv', 'html']);
export const baseSchema = scopeSchema
  .extend({
    ...refSchema.shape,
    digest,
    createdAt: z.string().datetime(),
    actor: z.string().min(1).max(200),
    dependencies: z.array(dependencySchema).max(2000),
  })
  .strict();
export const spaceSchema = z
  .object({
    id: kid,
    name: z.string().min(1).max(120),
    createdAt: z.string().datetime(),
    actor: z.string().max(200),
    revoked: z.boolean(),
    quarantined: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();
export const sourceSchema = baseSchema
  .extend({
    name: z.string().min(1).max(240),
    format: formatSchema,
    bytes: z
      .number()
      .int()
      .min(0)
      .max(16 * 1024 ** 2),
    blobId: kid,
    origin: z.enum(['upload', 'project', 'import', 'redacted']),
    originDigest: digest.optional(),
    policy: policySchema,
    policyRevision: z.number().int().positive(),
    revoked: z.boolean(),
    sensitive: z.array(z.string().max(200)).max(100),
    redactions: z
      .array(z.object({ start: z.number().int().min(0), end: z.number().int().positive() }).strict())
      .max(1000),
  })
  .strict();
export const blockSchema = z
  .object({
    text: z.string().max(8192),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    line: z.number().int().positive(),
    locator: z.string().max(240),
  })
  .strict();
export const extractionSchema = baseSchema
  .extend({
    source: refSchema,
    sourceDigest: digest,
    parser: z.literal('sakura-text/1'),
    textDigest: digest,
    blocks: z.array(blockSchema).max(100000),
    warnings: z.array(z.string().max(240)).max(100),
  })
  .strict();
export const citationSchema = baseSchema
  .extend({
    source: refSchema,
    extraction: refSchema,
    sourceDigest: digest,
    textDigest: digest,
    quote: z.string().min(1).max(8192),
    quoteDigest: digest,
    start: z.number().int().min(0),
    end: z.number().int().positive(),
    locator: z.string().max(240),
  })
  .strict();
export const checkSchema = z
  .object({
    citation: refSchema,
    integrity: z.enum(['verified', 'mismatch', 'unavailable']),
    permission: z.enum(['allowed', 'revoked', 'unknown']),
    currency: z.enum(['current', 'updated', 'unknown']),
    authenticity: z.literal('unverified'),
    reason: z.string().max(500),
  })
  .strict();
export const assertionSchema = z
  .object({
    text: z.string().min(1).max(32768),
    kind: z.enum(['fact', 'judgment', 'procedure', 'unverified']),
    applicability: z.string().min(1).max(4000),
    supports: z.array(refSchema).max(200),
    conflicts: z.array(refSchema).max(200),
    resolution: z.string().max(4000),
    verification: z.string().max(4000),
  })
  .strict();
export const entryContentSchema = z
  .object({ title: z.string().min(1).max(240), assertions: z.array(assertionSchema).min(1).max(100) })
  .strict();
export const entrySchema = baseSchema.extend({ ...entryContentSchema.shape, archived: z.boolean() }).strict();
export const templateSchema = z.enum(['handover', 'operations', 'decision', 'glossary']);
export const sectionSchema = z
  .object({
    heading: z.string().min(1).max(240),
    text: z.string().max(200000),
    entries: z.array(refSchema).max(500),
    citations: z.array(refSchema).max(500),
  })
  .strict();
export const documentContentSchema = z
  .object({
    title: z.string().min(1).max(240),
    template: templateSchema,
    applicability: z.string().min(1).max(4000),
    sections: z.array(sectionSchema).min(1).max(100),
  })
  .strict();
export const documentSchema = baseSchema
  .extend({ ...documentContentSchema.shape, templateRevision: z.literal(1), archived: z.boolean() })
  .strict();
export const issueSchema = z
  .object({
    id: z.string().min(1).max(120),
    kind: z.enum([
      'integrity',
      'permission',
      'conflict',
      'unverified',
      'sensitive',
      'image',
      'template',
      'scope',
    ]),
    message: z.string().max(2000),
    blocking: z.boolean(),
  })
  .strict();
export const reviewSchema = baseSchema
  .extend({
    document: refSchema,
    documentDigest: digest,
    rules: z.literal('knowledge-review/1'),
    issues: z.array(issueSchema).max(10000),
    decision: z.enum(['open', 'accepted', 'changes-requested', 'revoked', 'imported']),
    acknowledgements: z.array(z.string().max(120)).max(10000),
    note: z.string().max(8000),
    mode: z.literal('single-owner'),
  })
  .strict();
export const renderSchema = z
  .object({
    title: z.string().max(240),
    markdown: z.string().max(4 * 1024 ** 2),
    html: z.string().max(8 * 1024 ** 2),
    digest,
    warnings: z.array(z.string().max(500)).max(2000),
  })
  .strict();
export const publicationSchema = baseSchema
  .extend({
    document: refSchema,
    review: refSchema,
    renderer: z.literal('knowledge-safe/1'),
    output: renderSchema,
    withdrawn: z.boolean(),
    reason: z.string().max(2000),
  })
  .strict();
export const planSchema = z
  .object({
    token: kid,
    spaceId: kid,
    expiresAt: z.string().datetime(),
    digest,
    summary: z.array(z.string().max(2000)).max(10000),
  })
  .strict();
export const jobSchema = z
  .object({
    id: kid,
    spaceId: kid,
    kind: z.string().max(80),
    state: z.enum(['running', 'ready', 'failed', 'cancelled', 'interrupted', 'cleanup-pending']),
    createdAt: z.string().datetime(),
    error: z.string().max(2000),
    resultId: kid.optional(),
  })
  .strict();
export const indexRowSchema = z
  .object({
    extraction: refSchema,
    source: refSchema,
    sourceDigest: digest,
    block: blockSchema,
    terms: z.array(z.string().max(128)).max(10000),
  })
  .strict();
export const indexSchema = baseSchema
  .extend({
    tokenizer: z.literal('unicode-cjk/1'),
    extractions: z.array(refSchema).max(2000),
    rows: z.array(indexRowSchema).max(100000),
    active: z.boolean(),
    omitted: z.array(kid).max(2000),
  })
  .strict();
export const searchSchema = z
  .object({
    generation: refSchema,
    hits: z
      .array(
        z
          .object({ source: refSchema, extraction: refSchema, block: blockSchema, score: z.number() })
          .strict(),
      )
      .max(50),
    truncated: z.boolean(),
    coverage: z.object({ indexed: z.number().int(), omitted: z.number().int(), stale: z.boolean() }).strict(),
  })
  .strict();
export const capacitySchema = z
  .object({
    token: kid,
    spaceId: kid.nullable(),
    bytes: z.number().int().min(0),
    owner: z.string().max(240),
    operationId: z.string().max(200),
    slot: z.string().max(120).optional(),
    state: z.enum(['reserved', 'committed', 'recovery-required']),
    actual: z.number().int().min(0),
    objects: z.number().int().min(0),
    kind: z.enum(['metadata', 'blob', 'temporary']),
  })
  .strict();
export const blobSchema = z
  .object({
    id: kid,
    spaceId: kid,
    digest,
    bytes: z.number().int().min(0),
    kind: z.enum(['source', 'derived']),
    dependencies: z.array(dependencySchema).max(2000),
    owner: z.string().max(240),
    holds: z.array(z.string().max(240)).max(10000),
    state: z.enum(['ready', 'retiring', 'cleanup-pending']),
    reservation: kid,
  })
  .strict();
export const bundleFileSchema = z
  .object({
    path: z.string().min(1).max(240),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 ** 2),
    sha256: digest,
    data: z.string().max(90 * 1024 ** 2),
  })
  .strict();
export const bundleSchema = z
  .object({
    format: z.literal('sakura-knowledge/1'),
    id: kid,
    mode: z.enum(['reading', 'handover']),
    canonical: z.literal('sorted-keys-utf8/1'),
    files: z.array(bundleFileSchema).min(3).max(5000),
    manifestDigest: digest,
  })
  .strict();
export const quarantineSchema = z
  .object({
    id: kid,
    digest,
    state: z.enum(['checked', 'rejected', 'accepted']),
    mode: z.enum(['reading', 'handover']).optional(),
    issues: z.array(z.string().max(2000)).max(1000),
    createdAt: z.string().datetime(),
    spaceId: kid.optional(),
    mapping: z.record(z.string(), kid),
    identity: z.literal('unverified'),
  })
  .strict();
export type Purpose = z.infer<typeof purposeSchema>;
export type Ref = z.infer<typeof refSchema>;
export type Pin = z.infer<typeof pinSchema>;
export type Dependency = z.infer<typeof dependencySchema>;
export type Policy = z.infer<typeof policySchema>;
export type Space = z.infer<typeof spaceSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type EvidenceCheck = z.infer<typeof checkSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type Document = z.infer<typeof documentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Rendered = z.infer<typeof renderSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Index = z.infer<typeof indexSchema>;
export type Search = z.infer<typeof searchSchema>;
export type Capacity = z.infer<typeof capacitySchema>;
export type BlobReceipt = z.infer<typeof blobSchema>;
export type Bundle = z.infer<typeof bundleSchema>;
export type Quarantine = z.infer<typeof quarantineSchema>;
export const knowledgeTemplates = {
  handover: ['目的', '目录', '环境', '关键入口', '运行步骤', '已知问题', '接手检查'],
  operations: ['触发条件', '前提', '操作', '预期结果', '失败处理', '停止条件'],
  decision: ['问题', '约束', '候选方案', '决定', '依据', '影响', '复议条件'],
  glossary: ['术语', '定义', '适用范围', '引用', '待核实项'],
} as const;

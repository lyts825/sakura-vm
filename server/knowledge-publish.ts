/** 认证阅读与原子活跃指针。 Authenticated reading; stage complete output before switching the pointer. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeEvidenceV1,
  KnowledgeEntriesV1,
  KnowledgeDocumentsV1,
  KnowledgeReviewsV1,
  KnowledgePublishV1,
} from './service-contracts/knowledge-studio.ts';
import {
  base,
  ref,
  hash,
  fail,
  KnowledgeStore,
  KnowledgePlans,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
import { collectDocument, renderDocument } from './knowledge-render.ts';
const rowSchema = K.publicationSchema.extend({ active: z.boolean() }).strict();
const planPayload = z
  .object({
    document: K.refSchema,
    review: K.refSchema,
    documentDigest: K.digest,
    reviewDigest: K.digest,
    dependencies: z.array(K.dependencySchema),
    expectedActive: K.kid.nullable(),
    rollback: K.kid.optional(),
  })
  .strict();
export class KnowledgePublish implements KnowledgePublishV1 {
  private store: KnowledgeStore<z.infer<typeof rowSchema>>;
  private plans: KnowledgePlans;
  constructor(
    meta: PluginMetadata,
    plans: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private documents: KnowledgeDocumentsV1,
    private entries: KnowledgeEntriesV1,
    private evidence: KnowledgeEvidenceV1,
    private reviews: KnowledgeReviewsV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, rowSchema, auth, sources);
    this.plans = new KnowledgePlans(plans, auth, sources);
  }
  async plan(input: { spaceId: string; document: K.Ref; review: K.Ref }) {
    const p = K.scopeSchema.extend({ document: K.refSchema, review: K.refSchema }).strict().parse(input),
      d = await this.documents.readPinned({ spaceId: p.spaceId, ...p.document, purpose: 'publish' }),
      r = await this.reviews.recheck({ spaceId: p.spaceId, ...p.review, purpose: 'publish' });
    if (d.digest !== r.documentDigest || d.id !== r.document.id || d.revision !== r.document.revision)
      fail('REVIEW_STALE', '审阅不属于该固定文稿');
    const active = (await this.store.list(p.spaceId)).find((r) => r.active);
    const c = await collectDocument(d, 'publish', this.entries, this.evidence),
      output = renderDocument(d, c.entries, c.citations);
    return this.plans.create(
      p.spaceId,
      {
        document: ref(d),
        review: ref(r),
        documentDigest: d.digest,
        reviewDigest: r.digest,
        dependencies: r.dependencies,
        expectedActive: active?.id ?? null,
      },
      [d.title, `输出摘要 ${output.digest}`, ...output.warnings],
    );
  }
  async apply(input: { spaceId: string; token: string }, signal?: AbortSignal) {
    const p = await this.plans.consume(input.spaceId, input.token, planPayload);
    signal?.throwIfAborted();
    const d = await this.documents.readPinned({ spaceId: input.spaceId, ...p.document, purpose: 'publish' }),
      r = await this.reviews.recheck({ spaceId: input.spaceId, ...p.review, purpose: 'publish' });
    if (d.digest !== p.documentDigest || r.digest !== p.reviewDigest) fail('REVIEW_STALE', '计划输入改变');
    const collected = await collectDocument(d, 'publish', this.entries, this.evidence),
      output = renderDocument(d, collected.entries, collected.citations);
    const content = {
      document: p.document,
      review: p.review,
      renderer: 'knowledge-safe/1' as const,
      output,
      withdrawn: false,
      reason: '',
    };
    const row = { ...base(input.spaceId, content, p.dependencies), ...content, active: true };
    await this.store.change(
      input.spaceId,
      (rows) => {
        if ((rows.find((v) => v.spaceId === input.spaceId && v.active)?.id ?? null) !== p.expectedActive)
          fail('REVISION_CONFLICT', '活跃发布已改变');
        for (const v of rows) if (v.spaceId === input.spaceId) v.active = false;
        rows.push(row);
      },
      false,
      async () => {
        signal?.throwIfAborted();
        await this.reviews.recheck({ spaceId: input.spaceId, ...p.review, purpose: 'publish' });
        await this.sources.check({
          spaceId: input.spaceId,
          dependencies: p.dependencies,
          purpose: 'publish',
          exactPolicy: true,
        });
      },
    );
    const { active, ...result } = row;
    return result;
  }
  async read(input: { spaceId: string; id?: string }) {
    const p = K.scopeSchema.extend({ id: K.kid.optional() }).strict().parse(input),
      rows = await this.store.list(p.spaceId),
      row = rows.find((v) => (p.id ? v.id === p.id : v.active));
    if (!row || row.withdrawn) fail('PUBLICATION_WITHDRAWN', '发布不存在或已撤回', 404);
    await this.reviews.recheck({ spaceId: p.spaceId, ...row.review, purpose: 'publish' });
    await this.sources.check({
      spaceId: p.spaceId,
      dependencies: row.dependencies,
      purpose: 'publish',
      exactPolicy: true,
    });
    if (hash({ markdown: row.output.markdown, html: row.output.html }) !== row.output.digest)
      fail('CITATION_MISMATCH', '发布输出损坏');
    const { active, ...r } = row;
    return r;
  }
  async withdraw(input: { spaceId: string; id: string; reason: string }) {
    const p = K.scopeSchema
      .extend({ id: K.kid, reason: z.string().min(1).max(2000) })
      .strict()
      .parse(input);
    return this.store.change(
      p.spaceId,
      (rows) => {
        const row = rows.find((v) => v.id === p.id && v.spaceId === p.spaceId);
        if (!row) fail('KNOWLEDGE_NOT_FOUND', '发布不存在', 404);
        row.withdrawn = true;
        row.active = false;
        row.reason = p.reason;
        const { active, ...result } = row;
        return result;
      },
      true,
    );
  }
  async rollback(input: { spaceId: string; id: string }) {
    const publication = await this.read(input);
    return this.plan({ spaceId: input.spaceId, document: publication.document, review: publication.review });
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    await this.sources.space(p);
    return (await this.store.list(p.spaceId)).map((r) => ({
      id: r.id,
      revision: r.revision,
      document: r.document,
      withdrawn: r.withdrawn,
      active: r.active,
    }));
  }
  close() {
    return this.store.close();
  }
}

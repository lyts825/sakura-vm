/** 四种模板与固定章节引用。 Four templates and immutable child revision references. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeEvidenceV1,
  KnowledgeEntriesV1,
  KnowledgeDocumentsV1,
  KnowledgeCreateDocument,
} from './service-contracts/knowledge-studio.ts';
import { base, hash, fail, uniqueDeps, KnowledgeStore, type KnowledgeAuthorize } from './knowledge-store.ts';
export class KnowledgeDocuments implements KnowledgeDocumentsV1 {
  private store: KnowledgeStore<K.Document>;
  constructor(
    meta: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private entries: KnowledgeEntriesV1,
    private evidence: KnowledgeEvidenceV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.documentSchema, auth, sources);
  }
  async templates() {
    await this.store.authorize();
    return Object.entries(K.knowledgeTemplates).map(([id, headings]) => ({
      id: id as K.Document['template'],
      headings: [...headings],
      revision: 1 as const,
    }));
  }
  private async dependencies(spaceId: string, sections: K.Document['sections'], purpose: K.Purpose) {
    const deps: K.Dependency[] = [];
    let count = 0;
    for (const s of sections) {
      count += s.entries.length + s.citations.length;
      if (count > 2000) fail('EXTRACT_LIMIT', '文稿引用超过 2000 项', 413);
      for (const entry of s.entries)
        deps.push(...(await this.entries.readPinned({ spaceId, ...entry, purpose })).dependencies);
      for (const cite of s.citations)
        deps.push(...(await this.evidence.inspect({ spaceId, ...cite, purpose })).dependencies);
    }
    return uniqueDeps(deps);
  }
  private async save(
    input: KnowledgeCreateDocument & { id?: string; expectedRevision?: number },
    archived = false,
  ) {
    const p = K.scopeSchema
      .extend({
        ...K.documentContentSchema.shape,
        id: K.kid.optional(),
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input);
    if (Buffer.byteLength(JSON.stringify(p)) > 2 * 1024 ** 2) fail('EXTRACT_LIMIT', '文稿超过 2 MiB', 413);
    await this.sources.space({ spaceId: p.spaceId });
    const dependencies = await this.dependencies(p.spaceId, p.sections, 'cite');
    const content = {
      title: p.title,
      template: p.template,
      applicability: p.applicability,
      sections: p.sections,
      templateRevision: 1 as const,
      archived,
    };
    const row: K.Document = {
      ...base(p.spaceId, content, dependencies, p.id, (p.expectedRevision ?? 0) + 1),
      ...content,
    };
    await this.store.append(row, p.expectedRevision ?? 0, async () => {
      await this.sources.check({ spaceId: p.spaceId, dependencies, purpose: 'cite', exactPolicy: true });
    });
    return row;
  }
  create(input: KnowledgeCreateDocument) {
    return this.save(input);
  }
  revise(input: KnowledgeCreateDocument & { id: string; expectedRevision: number }) {
    return this.save(input);
  }
  async readPinned(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      r = await this.store.get(p);
    if (
      hash({
        title: r.title,
        template: r.template,
        applicability: r.applicability,
        sections: r.sections,
        templateRevision: r.templateRevision,
        archived: r.archived,
      }) !== r.digest
    )
      fail('CITATION_MISMATCH', '文稿摘要不符');
    const deps = await this.dependencies(p.spaceId, r.sections, p.purpose);
    if (
      hash(deps.map(({ policyRevision, ...d }) => d)) !==
      hash(r.dependencies.map(({ policyRevision, ...d }) => d))
    )
      fail('CITATION_MISMATCH', '文稿依赖集合不完整');
    await this.sources.check({ spaceId: p.spaceId, dependencies: r.dependencies, purpose: p.purpose });
    return r;
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    await this.sources.space(p);
    const out: K.Document[] = [];
    for (const r of await this.store.list(p.spaceId)) {
      try {
        await this.sources.check({ spaceId: p.spaceId, dependencies: r.dependencies, purpose: 'read' });
        out.push(r);
      } catch (e) {
        if ((e as { code?: string }).code !== 'SOURCE_USE_REVOKED') throw e;
      }
    }
    return out;
  }
  async compare(input: { spaceId: string; id: string; left: number; right: number }) {
    return {
      left: await this.readPinned({
        spaceId: input.spaceId,
        id: input.id,
        revision: input.left,
        purpose: 'read',
      }),
      right: await this.readPinned({
        spaceId: input.spaceId,
        id: input.id,
        revision: input.right,
        purpose: 'read',
      }),
    };
  }
  async archive(input: { spaceId: string; id: string; expectedRevision: number }) {
    const r = await this.readPinned({
      spaceId: input.spaceId,
      id: input.id,
      revision: input.expectedRevision,
      purpose: 'read',
    });
    return this.save(
      {
        ...input,
        ...K.documentContentSchema.parse({
          title: r.title,
          template: r.template,
          applicability: r.applicability,
          sections: r.sections,
        }),
      },
      true,
    );
  }
  close() {
    return this.store.close();
  }
}

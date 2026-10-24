/** 固定陈述、支持与反证及并发修订。 Pinned assertions, counter-evidence and compare-and-swap revisions. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeEvidenceV1,
  KnowledgeEntriesV1,
  KnowledgeCreateEntry,
} from './service-contracts/knowledge-studio.ts';
import {
  base,
  ref,
  hash,
  fail,
  uniqueDeps,
  KnowledgeStore,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
export class KnowledgeEntries implements KnowledgeEntriesV1 {
  private store: KnowledgeStore<K.Entry>;
  constructor(
    meta: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private evidence: KnowledgeEvidenceV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.entrySchema, auth, sources);
  }
  private async save(
    input: KnowledgeCreateEntry & { id?: string; expectedRevision?: number },
    archived = false,
  ) {
    const p = K.scopeSchema
      .extend({
        ...K.entryContentSchema.shape,
        id: K.kid.optional(),
        expectedRevision: z.number().int().positive().optional(),
      })
      .strict()
      .parse(input);
    if (Buffer.byteLength(JSON.stringify(p)) > 128 * 1024) fail('EXTRACT_LIMIT', '条目超过 128 KiB', 413);
    await this.sources.space({ spaceId: p.spaceId });
    const deps: K.Dependency[] = [];
    for (const a of p.assertions)
      for (const c of [...a.supports, ...a.conflicts])
        deps.push(
          ...(await this.evidence.inspect({ spaceId: p.spaceId, ...c, purpose: 'cite' })).dependencies,
        );
    const content = { title: p.title, assertions: p.assertions, archived };
    const row: K.Entry = {
      ...base(p.spaceId, content, uniqueDeps(deps), p.id, (p.expectedRevision ?? 0) + 1),
      ...content,
    };
    await this.store.append(row, p.expectedRevision ?? 0, async () => {
      await this.sources.check({
        spaceId: p.spaceId,
        dependencies: row.dependencies,
        purpose: 'cite',
        exactPolicy: true,
      });
    });
    return row;
  }
  create(input: KnowledgeCreateEntry) {
    return this.save(input);
  }
  revise(input: KnowledgeCreateEntry & { id: string; expectedRevision: number }) {
    return this.save(input);
  }
  async readPinned(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      r = await this.store.get(p);
    if (hash({ title: r.title, assertions: r.assertions, archived: r.archived }) !== r.digest)
      fail('CITATION_MISMATCH', '条目摘要不符');
    const deps: K.Dependency[] = [];
    for (const a of r.assertions)
      for (const c of [...a.supports, ...a.conflicts])
        deps.push(
          ...(await this.evidence.inspect({ spaceId: p.spaceId, ...c, purpose: p.purpose })).dependencies,
        );
    if (
      hash(uniqueDeps(deps).map(({ policyRevision, ...d }) => d)) !==
      hash(r.dependencies.map(({ policyRevision, ...d }) => d))
    )
      fail('CITATION_MISMATCH', '条目依赖集合不完整');
    await this.sources.check({ spaceId: p.spaceId, dependencies: r.dependencies, purpose: p.purpose });
    return r;
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    await this.sources.space(p);
    const out: K.Entry[] = [];
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
    return this.save({ ...input, title: r.title, assertions: r.assertions }, true);
  }
  close() {
    return this.store.close();
  }
}

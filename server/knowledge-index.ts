/** 影子索引及撤权前置过滤。 Shadow generations; permission filtering precedes scoring. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeIndexV1,
  KnowledgeSourcesV1,
  KnowledgeExtractV1,
} from './service-contracts/knowledge-studio.ts';
import {
  base,
  hash,
  ref,
  uniqueDeps,
  KnowledgeStore,
  KnowledgePlans,
  fail,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
import { KnowledgeJobs } from './knowledge-jobs.ts';
import { computeKnowledge } from './knowledge-compute.ts';
export class KnowledgeIndex implements KnowledgeIndexV1 {
  private store: KnowledgeStore<K.Index>;
  private plans: KnowledgePlans;
  private tasks: KnowledgeJobs;
  constructor(
    meta: PluginMetadata,
    plans: PluginMetadata,
    jobs: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private extract: KnowledgeExtractV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.indexSchema, auth, sources);
    this.plans = new KnowledgePlans(plans, auth, sources);
    this.tasks = new KnowledgeJobs(jobs, auth, sources);
  }
  async plan(input: { spaceId: string; extractions: K.Ref[] }) {
    const p = K.scopeSchema
      .extend({ extractions: z.array(K.refSchema).min(1).max(2000) })
      .strict()
      .parse(input);
    const extractions = [];
    for (const selected of p.extractions)
      extractions.push(await this.extract.get({ spaceId: p.spaceId, ...selected, purpose: 'index' }));
    const current = (await this.store.list(p.spaceId)).find((r) => r.active);
    return this.plans.create(
      p.spaceId,
      {
        extractions: p.extractions,
        dependencies: uniqueDeps(extractions.flatMap((e) => e.dependencies)),
        expectedActive: current?.id ?? null,
      },
      extractions.map((e) => `${e.source.id}@${e.source.revision}: ${e.blocks.length} 块`),
    );
  }
  async build(input: { spaceId: string; token: string }, signal?: AbortSignal) {
    const p = await this.plans.consume(
      input.spaceId,
      input.token,
      z
        .object({
          extractions: z.array(K.refSchema),
          dependencies: z.array(K.dependencySchema),
          expectedActive: K.kid.nullable(),
        })
        .strict(),
    );
    return this.tasks.run(
      input.spaceId,
      'index',
      async (active) => {
        const rows: K.Index['rows'] = [];
        for (const selected of p.extractions) {
          const extraction = await this.extract.get({
            spaceId: input.spaceId,
            ...selected,
            purpose: 'index',
          });
          for (let offset = 0; offset < extraction.blocks.length; offset += 256) {
            active.throwIfAborted();
            const blocks = extraction.blocks.slice(offset, offset + 256);
            const terms = await computeKnowledge<string[][]>('index', async () => ({ blocks }), active);
            rows.push(
              ...blocks.map((block, i) => ({
                block,
                terms: terms[i],
                source: extraction.source,
                sourceDigest: extraction.sourceDigest,
                extraction: ref(extraction),
              })),
            );
            if (rows.length > 100000) fail('EXTRACT_LIMIT', '索引超过 100000 个块', 413);
          }
        }
        const sources = await this.sources.listSources({ spaceId: input.spaceId });
        const omitted = [
          ...new Set(
            sources
              .filter((s) => !p.dependencies.some((d) => d.id === s.id && d.revision === s.revision))
              .map((s) => s.id),
          ),
        ];
        const row: K.Index = {
          ...base(input.spaceId, { rows, extractions: p.extractions }, p.dependencies),
          tokenizer: 'unicode-cjk/1',
          extractions: p.extractions,
          rows,
          active: true,
          omitted,
        };
        await this.store.change(
          input.spaceId,
          (records) => {
            if (
              (records.find((r) => r.active && r.spaceId === input.spaceId)?.id ?? null) !== p.expectedActive
            )
              fail('REVISION_CONFLICT', '活跃索引已改变');
            for (const r of records) if (r.spaceId === input.spaceId) r.active = false;
            records.push(row);
          },
          false,
          async () => {
            active.throwIfAborted();
            await this.sources.check({
              spaceId: input.spaceId,
              dependencies: p.dependencies,
              purpose: 'index',
              exactPolicy: true,
            });
          },
        );
        return row;
      },
      signal,
    );
  }
  private async selected(spaceId: string, generation?: K.Ref) {
    const rows = await this.store.list(spaceId);
    const row = generation
      ? rows.find((r) => r.id === generation.id && r.revision === generation.revision)
      : rows.find((r) => r.active);
    if (!row) fail('INDEX_STALE', '尚未建立所选固定索引');
    if (hash({ rows: row.rows, extractions: row.extractions }) !== row.digest)
      fail('CITATION_MISMATCH', '固定索引摘要损坏');
    return row;
  }
  private async visible(spaceId: string, index: K.Index) {
    const allowed = new Set<string>();
    for (const d of index.dependencies) {
      try {
        await this.sources.check({ spaceId, dependencies: [d], purpose: 'index' });
        allowed.add(`${d.id}:${d.revision}`);
      } catch (e) {
        if ((e as { code?: string }).code !== 'SOURCE_USE_REVOKED') throw e;
      }
    }
    return index.rows.filter((r) => allowed.has(`${r.source.id}:${r.source.revision}`));
  }
  async search(input: { spaceId: string; query: string; generation?: K.Ref; limit: number }) {
    const p = K.scopeSchema
      .extend({
        query: z.string().trim().min(1).max(500),
        generation: K.refSchema.optional(),
        limit: z.number().int().min(1).max(50),
      })
      .strict()
      .parse(input);
    const index = await this.selected(p.spaceId, p.generation),
      visible = await this.visible(p.spaceId, index);
    const [terms] = await computeKnowledge<string[][]>('index', async () => ({
      blocks: [{ text: p.query }],
    }));
    const set = new Set(terms);
    const candidates = visible
      .map((row) => ({
        source: row.source,
        extraction: row.extraction,
        block: row.block,
        score: row.terms.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0),
      }))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || a.source.id.localeCompare(b.source.id) || a.block.start - b.block.start,
      );
    // 只对仍获准集合计分和计数，返回前再次检查。 Recheck every dependency before exposing snippets or counts.
    const again = await this.visible(p.spaceId, index);
    const allowed = new Set(again.map((r) => `${r.source.id}:${r.source.revision}`));
    const safe = candidates.filter((r) => allowed.has(`${r.source.id}:${r.source.revision}`));
    return K.searchSchema.parse({
      generation: ref(index),
      hits: safe.slice(0, p.limit),
      truncated: safe.length > p.limit,
      coverage: await this.coverage(p),
    });
  }
  async coverage(input: { spaceId: string }) {
    const spaceId = K.scopeSchema.parse({ spaceId: input.spaceId }).spaceId;
    const index = await this.selected(spaceId);
    const visible = await this.visible(spaceId, index);
    const available = (await this.sources.listSources({ spaceId })).filter(
      (s) => !s.revoked && s.policy.index,
    );
    const indexed = new Set(visible.map((r) => `${r.source.id}:${r.source.revision}`));
    const latest = new Map<string, K.Source>();
    for (const s of available) if ((latest.get(s.id)?.revision ?? 0) < s.revision) latest.set(s.id, s);
    const omitted = [...latest.values()].filter((s) => !indexed.has(`${s.id}:${s.revision}`)).length;
    return { indexed: indexed.size, omitted, stale: omitted > 0 };
  }
  jobs(input: { spaceId: string }) {
    return this.tasks.list(K.scopeSchema.parse(input).spaceId);
  }
  cancel(input: { spaceId: string; id: string }) {
    return this.tasks.cancel(input.spaceId, input.id);
  }
  async close() {
    await this.tasks.close();
    await this.store.close();
  }
}

/** 固定来源解析与位置映射。 Immutable extraction with original UTF-8 byte locations. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type { KnowledgeSourcesV1, KnowledgeExtractV1 } from './service-contracts/knowledge-studio.ts';
import { base, ref, KnowledgeStore, KnowledgePlans, type KnowledgeAuthorize } from './knowledge-store.ts';
import { KnowledgeJobs } from './knowledge-jobs.ts';
import { computeKnowledge, type ParsedMaterial } from './knowledge-compute.ts';
export class KnowledgeExtract implements KnowledgeExtractV1 {
  private store: KnowledgeStore<K.Extraction>;
  private plans: KnowledgePlans;
  private tasks: KnowledgeJobs;
  constructor(
    meta: PluginMetadata,
    plans: PluginMetadata,
    jobs: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private authorize: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.extractionSchema, authorize, sources);
    this.plans = new KnowledgePlans(plans, authorize, sources);
    this.tasks = new KnowledgeJobs(jobs, authorize, sources);
  }
  async plan(input: { spaceId: string; sources: K.Ref[] }) {
    const p = K.scopeSchema
      .extend({ sources: z.array(K.refSchema).min(1).max(2000) })
      .strict()
      .parse(input);
    const deps = [];
    for (const s of p.sources) {
      const source = await this.sources.getSource({ spaceId: p.spaceId, ...s, purpose: 'read' });
      deps.push({
        id: source.id,
        revision: source.revision,
        digest: source.digest,
        policyRevision: source.policyRevision,
      });
    }
    return this.plans.create(
      p.spaceId,
      { sources: p.sources, dependencies: deps },
      deps.map((d) => `${d.id}@${d.revision} ${d.digest}`),
    );
  }
  async run(input: { spaceId: string; token: string }, signal?: AbortSignal) {
    const p = await this.plans.consume(
      input.spaceId,
      input.token,
      z.object({ sources: z.array(K.refSchema), dependencies: z.array(K.dependencySchema) }).strict(),
    );
    return this.tasks.run(
      input.spaceId,
      'extract',
      async (active) => {
        const output: K.Extraction[] = [];
        for (const selected of p.sources) {
          active.throwIfAborted();
          let source!: K.Source;
          const parsed = await computeKnowledge<ParsedMaterial>(
            'parse',
            async () => {
              const read = await this.sources.read({ spaceId: input.spaceId, ...selected, purpose: 'read' });
              source = read.source;
              return { data: Buffer.from(read.data, 'base64'), format: source.format };
            },
            active,
          );
          const dependencies = p.dependencies.filter(
            (d) => d.id === selected.id && d.revision === selected.revision,
          );
          await this.sources.check({
            spaceId: input.spaceId,
            dependencies,
            purpose: 'read',
            exactPolicy: true,
          });
          const row: K.Extraction = {
            ...base(input.spaceId, parsed, dependencies),
            ...parsed,
            source: ref(source),
            sourceDigest: source.digest,
          };
          await this.sources.retain({
            spaceId: input.spaceId,
            id: source.blobId,
            holder: `extraction:${row.id}`,
          });
          active.throwIfAborted();
          await this.store.append(row, 0, async () => {
            active.throwIfAborted();
            await this.sources.check({
              spaceId: input.spaceId,
              dependencies,
              purpose: 'read',
              exactPolicy: true,
            });
          });
          output.push(row);
        }
        return output;
      },
      signal,
    );
  }
  async get(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      row = await this.store.get(p);
    await this.sources.check({ spaceId: p.spaceId, dependencies: row.dependencies, purpose: p.purpose });
    return row;
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input),
      rows = await this.store.list(p.spaceId),
      out: K.Extraction[] = [];
    for (const row of rows) {
      try {
        out.push(await this.get({ ...p, ...ref(row), purpose: 'read' }));
      } catch (e) {
        if ((e as { code?: string }).code !== 'SOURCE_USE_REVOKED') throw e;
      }
    }
    return out;
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

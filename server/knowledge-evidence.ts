/** 引文四维证明与显式迁移候选。 Citation integrity, permission, currency and unverified authenticity. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeExtractV1,
  KnowledgeEvidenceV1,
} from './service-contracts/knowledge-studio.ts';
import { base, ref, sha, hash, fail, KnowledgeStore, type KnowledgeAuthorize } from './knowledge-store.ts';
import { computeKnowledge, type ParsedMaterial } from './knowledge-compute.ts';
export class KnowledgeEvidence implements KnowledgeEvidenceV1 {
  private store: KnowledgeStore<K.Citation>;
  constructor(
    meta: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private extract: KnowledgeExtractV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.citationSchema, auth, sources);
  }
  async create(input: { spaceId: string; extraction: K.Ref; start: number; end: number }) {
    const p = K.scopeSchema
      .extend({ extraction: K.refSchema, start: z.number().int().min(0), end: z.number().int().positive() })
      .strict()
      .parse(input);
    const e = await this.extract.get({ spaceId: p.spaceId, ...p.extraction, purpose: 'cite' });
    const b = e.blocks.find((b) => b.start === p.start && b.end === p.end);
    if (!b) fail('CITATION_MISMATCH', '请选择完整解析块的原字节区间');
    const content = {
      source: e.source,
      extraction: ref(e),
      sourceDigest: e.sourceDigest,
      textDigest: e.textDigest,
      quote: b.text,
      quoteDigest: sha(b.text),
      start: b.start,
      end: b.end,
      locator: b.locator,
    };
    const row: K.Citation = { ...base(p.spaceId, content, e.dependencies), ...content };
    const s = await this.sources.getSource({ spaceId: p.spaceId, ...e.source, purpose: 'cite' });
    await this.sources.retain({ spaceId: p.spaceId, id: s.blobId, holder: `citation:${row.id}` });
    await this.store.append(row, 0, async () => {
      await this.sources.check({
        spaceId: p.spaceId,
        dependencies: row.dependencies,
        purpose: 'cite',
        exactPolicy: true,
      });
    });
    await this.inspect({ spaceId: p.spaceId, ...ref(row), purpose: 'cite' });
    return row;
  }
  async inspect(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      c = await this.store.get(p);
    await this.sources.check({ spaceId: p.spaceId, dependencies: c.dependencies, purpose: p.purpose });
    const content = {
      source: c.source,
      extraction: c.extraction,
      sourceDigest: c.sourceDigest,
      textDigest: c.textDigest,
      quote: c.quote,
      quoteDigest: c.quoteDigest,
      start: c.start,
      end: c.end,
      locator: c.locator,
    };
    if (hash(content) !== c.digest || sha(c.quote) !== c.quoteDigest)
      fail('CITATION_MISMATCH', '引文摘要损坏');
    const e = await this.extract.get({ spaceId: p.spaceId, ...c.extraction, purpose: p.purpose });
    if (
      e.source.id !== c.source.id ||
      e.source.revision !== c.source.revision ||
      e.sourceDigest !== c.sourceDigest ||
      e.textDigest !== c.textDigest
    )
      fail('CITATION_MISMATCH', '引用关联改变');
    const parsed = await computeKnowledge<ParsedMaterial>('parse', async () => {
      const read = await this.sources.read({ spaceId: p.spaceId, ...c.source, purpose: p.purpose });
      if (read.source.digest !== c.sourceDigest) fail('CITATION_MISMATCH', '原文摘要不符');
      return { data: Buffer.from(read.data, 'base64'), format: read.source.format };
    });
    if (
      parsed.parser !== e.parser ||
      hash(parsed) !== e.digest ||
      parsed.textDigest !== e.textDigest ||
      hash(parsed.blocks) !== hash(e.blocks) ||
      !parsed.blocks.some(
        (b) => b.start === c.start && b.end === c.end && b.text === c.quote && b.locator === c.locator,
      )
    )
      fail('CITATION_MISMATCH', '解析版本、定位或引文不符');
    await this.sources.check({ spaceId: p.spaceId, dependencies: c.dependencies, purpose: p.purpose });
    return c;
  }
  async check(input: K.Pin) {
    const p = K.pinSchema.parse(input);
    await this.store.authorize();
    try {
      const c = await this.inspect(p);
      const all = await this.sources.listSources({ spaceId: p.spaceId });
      return K.checkSchema.parse({
        citation: ref(c),
        integrity: 'verified',
        permission: 'allowed',
        currency: all.some((s) => s.id === c.source.id && s.revision > c.source.revision)
          ? 'updated'
          : 'current',
        authenticity: 'unverified',
        reason: '摘要和固定解析位置通过；不证明陈述真实性',
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'SOURCE_USE_REVOKED' && code !== 'CITATION_MISMATCH' && code !== 'KNOWLEDGE_NOT_FOUND')
        throw error;
      return K.checkSchema.parse({
        citation: ref(p),
        integrity: code === 'CITATION_MISMATCH' ? 'mismatch' : 'unavailable',
        permission: code === 'SOURCE_USE_REVOKED' ? 'revoked' : 'unknown',
        currency: 'unknown',
        authenticity: 'unverified',
        reason: code,
      });
    }
  }
  async migrate(input: K.Pin & { target: K.Ref }) {
    const p = K.pinSchema.extend({ target: K.refSchema }).strict().parse(input);
    const c = await this.inspect({ spaceId: p.spaceId, ...ref(p), purpose: p.purpose });
    const target = await this.extract.get({ spaceId: p.spaceId, ...p.target, purpose: p.purpose });
    const candidates = target.blocks
      .filter((b) => b.text === c.quote)
      .map(({ start, end, locator }) => ({ start, end, locator }));
    return { candidates, ambiguous: candidates.length !== 1 };
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    const out: K.Citation[] = [];
    for (const c of await this.store.list(p.spaceId)) {
      try {
        await this.sources.check({ spaceId: p.spaceId, dependencies: c.dependencies, purpose: 'read' });
        out.push(c);
      } catch (e) {
        if ((e as { code?: string }).code !== 'SOURCE_USE_REVOKED') throw e;
      }
    }
    return out;
  }
  close() {
    return this.store.close();
  }
}

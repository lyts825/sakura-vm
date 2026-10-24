/** 单人分阶段人工审阅，绑定文稿和许可修订。 Human review binds document, evidence and current policies. */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeEvidenceV1,
  KnowledgeEntriesV1,
  KnowledgeDocumentsV1,
  KnowledgeReviewsV1,
} from './service-contracts/knowledge-studio.ts';
import {
  base,
  ref,
  hash,
  fail,
  sensitive,
  KnowledgeStore,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
import { collectDocument, renderDocument } from './knowledge-render.ts';
export class KnowledgeReviews implements KnowledgeReviewsV1 {
  private store: KnowledgeStore<K.Review>;
  constructor(
    meta: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private documents: KnowledgeDocumentsV1,
    private entries: KnowledgeEntriesV1,
    private evidence: KnowledgeEvidenceV1,
    auth: KnowledgeAuthorize,
  ) {
    this.store = new KnowledgeStore(meta, K.reviewSchema, auth, sources);
  }
  async open(input: { spaceId: string; document: K.Ref }) {
    const p = K.scopeSchema.extend({ document: K.refSchema }).strict().parse(input),
      d = await this.documents.readPinned({ spaceId: p.spaceId, ...p.document, purpose: 'read' }),
      collected = await collectDocument(d, 'read', this.entries, this.evidence);
    const issues: K.Review['issues'] = [];
    const add = (kind: K.Review['issues'][number]['kind'], message: string, blocking = false) =>
      issues.push({ id: `${kind}-${issues.length + 1}`, kind, message, blocking });
    for (const heading of K.knowledgeTemplates[d.template])
      if (
        !d.sections.some(
          (s) => s.heading === heading && (s.text.trim() || s.entries.length || s.citations.length),
        )
      )
        add('template', `补充模板章节：${heading}`, true);
    for (const e of collected.entries)
      for (const a of e.assertions) {
        if (a.conflicts.length && !a.resolution.trim())
          add('conflict', `${e.title}：相反依据尚无人工判断`, true);
        else if (a.conflicts.length) add('conflict', `${e.title}：确认人工冲突判断：${a.resolution}`);
        if (a.kind === 'unverified' || (!a.supports.length && !a.verification))
          add('unverified', `${e.title}：待核实陈述需显式接受用途`);
        if (a.kind === 'procedure' && !a.supports.length && !a.verification)
          add('scope', `${e.title}：操作缺少来源或人工验证`, true);
      }
    const rendered = renderDocument(d, collected.entries, collected.citations);
    for (const message of sensitive(rendered.markdown))
      add('sensitive', message + '；请修改或脱敏后重新审阅', true);
    for (const dep of d.dependencies) {
      const s = await this.sources.getSource({ spaceId: p.spaceId, ...ref(dep), purpose: 'read' });
      for (const message of s.sensitive) add('sensitive', `${s.id}：${message}；需选择脱敏副本`, true);
    }
    if (/!\[/.test(JSON.stringify(d.sections))) add('image', '图片未收录；确认仅凭文字可以理解');
    add('scope', `确认适用范围：${d.applicability}`);
    const dependencies = await this.sources.check({
      spaceId: p.spaceId,
      dependencies: d.dependencies,
      purpose: 'read',
    });
    const content = {
      document: ref(d),
      documentDigest: d.digest,
      rules: 'knowledge-review/1' as const,
      issues,
      decision: 'open' as const,
      acknowledgements: [] as string[],
      note: '',
      mode: 'single-owner' as const,
    };
    const row: K.Review = { ...base(p.spaceId, content, dependencies), ...content };
    await this.store.append(row);
    return row;
  }
  private content(r: K.Review) {
    return {
      document: r.document,
      documentDigest: r.documentDigest,
      rules: r.rules,
      issues: r.issues,
      decision: r.decision,
      acknowledgements: r.acknowledgements,
      note: r.note,
      mode: r.mode,
    };
  }
  async readPinned(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      r = await this.store.get(p);
    if (hash(this.content(r)) !== r.digest) fail('CITATION_MISMATCH', '审阅摘要不符');
    await this.sources.check({ spaceId: p.spaceId, dependencies: r.dependencies, purpose: p.purpose });
    const d = await this.documents.readPinned({ spaceId: p.spaceId, ...r.document, purpose: p.purpose });
    if (d.digest !== r.documentDigest) fail('REVIEW_STALE', '文稿摘要与审阅不符');
    return r;
  }
  async decide(input: Parameters<KnowledgeReviewsV1['decide']>[0]) {
    const p = K.scopeSchema
        .extend({
          id: K.kid,
          expectedRevision: z.number().int().positive(),
          decision: z.enum(['accepted', 'changes-requested', 'revoked']),
          acknowledgements: z.array(z.string().max(120)).max(10000),
          note: z.string().min(1).max(8000),
        })
        .strict()
        .parse(input),
      old = await this.readPinned({
        spaceId: p.spaceId,
        id: p.id,
        revision: p.expectedRevision,
        purpose: 'read',
      });
    await this.sources.check({
      spaceId: p.spaceId,
      dependencies: old.dependencies,
      purpose: 'read',
      exactPolicy: true,
    });
    if (
      p.decision === 'accepted' &&
      (old.issues.some((i) => i.blocking) || old.issues.some((i) => !p.acknowledgements.includes(i.id)))
    )
      fail('REVIEW_INCOMPLETE', '先解决阻断问题，并逐项确认审阅清单');
    if (p.acknowledgements.some((id) => !old.issues.some((i) => i.id === id)))
      fail('REVIEW_INCOMPLETE', '确认项不属于此审阅');
    const content = {
      ...this.content(old),
      decision: p.decision,
      acknowledgements: p.acknowledgements,
      note: p.note,
    };
    const row: K.Review = {
      ...base(p.spaceId, content, old.dependencies, p.id, p.expectedRevision + 1),
      ...content,
    };
    await this.store.append(row, p.expectedRevision, async () => {
      await this.sources.check({
        spaceId: p.spaceId,
        dependencies: row.dependencies,
        purpose: 'read',
        exactPolicy: true,
      });
    });
    return row;
  }
  async recheck(input: K.Pin) {
    const p = K.pinSchema.parse(input),
      r = await this.readPinned(p);
    const latest = (await this.store.list(p.spaceId)).filter((v) => v.id === r.id).at(-1);
    if (latest?.revision !== r.revision || r.decision !== 'accepted')
      fail('REVIEW_STALE', '审阅尚未接受、已撤销或已有新决定');
    await this.sources.check({
      spaceId: p.spaceId,
      dependencies: r.dependencies,
      purpose: p.purpose,
      exactPolicy: true,
    });
    await collectDocument(
      await this.documents.readPinned({ spaceId: p.spaceId, ...r.document, purpose: p.purpose }),
      p.purpose,
      this.entries,
      this.evidence,
    );
    return r;
  }
  async list(input: { spaceId: string }) {
    const p = K.scopeSchema.parse(input);
    await this.sources.space(p);
    const out: K.Review[] = [];
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
  close() {
    return this.store.close();
  }
}

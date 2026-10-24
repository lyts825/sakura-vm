/** 白名单离线包与隔离接收；不信任导入身份或审批。 Allowlisted offline bundles and fresh-ID acceptance. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import * as K from '../shared/contracts/knowledge-studio.ts';
import type {
  KnowledgeSourcesV1,
  KnowledgeExtractV1,
  KnowledgeEvidenceV1,
  KnowledgeEntriesV1,
  KnowledgeDocumentsV1,
  KnowledgeReviewsV1,
  KnowledgeExchangeV1,
} from './service-contracts/knowledge-studio.ts';
import {
  base,
  ref,
  canonical,
  sha,
  hash,
  fail,
  sensitive,
  KnowledgeStore,
  KnowledgePlans,
  now,
  type KnowledgeAuthorize,
} from './knowledge-store.ts';
import { collectDocument, renderDocument } from './knowledge-render.ts';
import { computeKnowledge, type ParsedMaterial } from './knowledge-compute.ts';
const MAX = 16 * 1024 ** 2;
const payloadSchema = z
  .object({
    document: K.documentSchema,
    entries: z.array(K.entrySchema).max(2000),
    citations: z.array(K.citationSchema).max(2000),
    extractions: z.array(K.extractionSchema).max(2000),
    sources: z.array(K.sourceSchema).max(2000),
    review: K.reviewSchema,
    missing: z.array(z.string().max(240)).max(2000),
  })
  .strict();
const exportRowSchema = K.baseSchema
  .extend({ mode: z.enum(['reading', 'handover']), bundle: K.bundleSchema })
  .strict();
const quarantineRowSchema = K.quarantineSchema
  .extend({
    spaceId: K.kid,
    revision: z.literal(1),
    bundle: K.bundleSchema.optional(),
    capacityToken: K.kid,
    accepting: z.boolean(),
  })
  .strict();
type QRow = z.infer<typeof quarantineRowSchema>;
const manifest = (bundle: K.Bundle) =>
  bundle.files
    .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
const planPayload = z
  .object({
    document: K.refSchema,
    review: K.refSchema,
    mode: z.enum(['reading', 'handover']),
    documentDigest: K.digest,
    reviewDigest: K.digest,
    dependencies: z.array(K.dependencySchema),
  })
  .strict();
export class KnowledgeExchange implements KnowledgeExchangeV1 {
  private exportsStore: KnowledgeStore<z.infer<typeof exportRowSchema>>;
  private quarantine: KnowledgeStore<QRow>;
  private plans: KnowledgePlans;
  private activeImports = new Set<string>();
  constructor(
    meta: PluginMetadata,
    plans: PluginMetadata,
    quarantine: PluginMetadata,
    private sources: KnowledgeSourcesV1,
    private extract: KnowledgeExtractV1,
    private evidence: KnowledgeEvidenceV1,
    private entries: KnowledgeEntriesV1,
    private documents: KnowledgeDocumentsV1,
    private reviews: KnowledgeReviewsV1,
    private authorize: KnowledgeAuthorize,
  ) {
    this.exportsStore = new KnowledgeStore(meta, exportRowSchema, authorize, sources);
    this.plans = new KnowledgePlans(plans, authorize, sources);
    this.quarantine = new KnowledgeStore(quarantine, quarantineRowSchema, authorize);
  }
  private async prepare(spaceId: string, document: K.Ref, review: K.Ref) {
    const d = await this.documents.readPinned({ spaceId, ...document, purpose: 'export' }),
      r = await this.reviews.recheck({ spaceId, ...review, purpose: 'export' });
    if (r.documentDigest !== d.digest || r.document.id !== d.id || r.document.revision !== d.revision)
      fail('REVIEW_STALE', '导出审阅与文稿不符');
    const collected = await collectDocument(d, 'export', this.entries, this.evidence),
      output = renderDocument(d, collected.entries, collected.citations);
    if (sensitive(output.markdown).length)
      fail('EXPORT_POLICY_CONFLICT', '正文仍有敏感提示，请先脱敏并重新审阅');
    return { d, r, collected, output };
  }
  async planExport(input: { spaceId: string; document: K.Ref; review: K.Ref; mode: K.Bundle['mode'] }) {
    const p = K.scopeSchema
      .extend({ document: K.refSchema, review: K.refSchema, mode: z.enum(['reading', 'handover']) })
      .strict()
      .parse(input);
    const { d, r, output } = await this.prepare(p.spaceId, p.document, p.review);
    return this.plans.create(
      p.spaceId,
      {
        document: p.document,
        review: p.review,
        mode: p.mode,
        documentDigest: d.digest,
        reviewDigest: r.digest,
        dependencies: r.dependencies,
      },
      [
        `${p.mode === 'reading' ? '阅读包' : '可复核交接包'}：${d.title}`,
        '来源身份未认证；下载后不能远程撤回',
        `全文 ${Buffer.byteLength(output.markdown)} B`,
        ...d.dependencies.map((dep) => `${dep.id}@${dep.revision} ${dep.digest}`),
      ],
    );
  }
  async export(input: { spaceId: string; token: string }, signal?: AbortSignal) {
    const p = await this.plans.consume(input.spaceId, input.token, planPayload),
      { d, r, collected, output } = await this.prepare(input.spaceId, p.document, p.review);
    if (d.digest !== p.documentDigest || r.digest !== p.reviewDigest) fail('REVIEW_STALE', '导出输入改变');
    const files: K.Bundle['files'] = [];
    const add = (path: string, bytes: Buffer) => {
      if (files.reduce((n, f) => n + f.bytes, 0) + bytes.length > MAX)
        fail('EXTRACT_LIMIT', '首版单包限制 16 MiB', 413);
      files.push({ path, bytes: bytes.length, sha256: sha(bytes), data: bytes.toString('base64') });
    };
    add('reading/document.html', Buffer.from(output.html));
    add('reading/document.md', Buffer.from(output.markdown));
    const sourceRows: K.Source[] = [],
      extractionRows: K.Extraction[] = [];
    if (p.mode === 'handover') {
      for (const dep of d.dependencies) {
        signal?.throwIfAborted();
        const read = await this.sources.read({ spaceId: input.spaceId, ...ref(dep), purpose: 'export' });
        sourceRows.push({
          ...read.source,
          name: `source-${read.source.id}.${read.source.format === 'markdown' ? 'md' : read.source.format}`,
        });
        add(`sources/${read.source.id}-${read.source.revision}.txt`, Buffer.from(read.data, 'base64'));
      }
      const visited = new Set<string>();
      for (const c of collected.citations) {
        const key = `${c.extraction.id}:${c.extraction.revision}`;
        if (!visited.has(key)) {
          visited.add(key);
          extractionRows.push(
            await this.extract.get({ spaceId: input.spaceId, ...c.extraction, purpose: 'export' }),
          );
        }
      }
    }
    const payload = payloadSchema.parse({
      document: d,
      entries: collected.entries,
      citations: collected.citations,
      extractions: extractionRows,
      sources: sourceRows,
      review: r,
      missing:
        p.mode === 'reading'
          ? d.dependencies.map((dep) => `${dep.id}@${dep.revision}: 未收录原材料，不能复核全文定位`)
          : [],
    });
    add('objects/knowledge.json', Buffer.from(canonical(payload)));
    const bundle: K.Bundle = {
      format: 'sakura-knowledge/1',
      id: randomUUID(),
      mode: p.mode,
      canonical: 'sorted-keys-utf8/1',
      files,
      manifestDigest: '',
    };
    bundle.manifestDigest = hash(manifest(bundle));
    K.bundleSchema.parse(bundle);
    signal?.throwIfAborted();
    const row = { ...base(input.spaceId, bundle, p.dependencies), mode: p.mode, bundle };
    await this.exportsStore.append(row, 0, async () => {
      signal?.throwIfAborted();
      await this.sources.check({
        spaceId: input.spaceId,
        dependencies: p.dependencies,
        purpose: 'export',
        exactPolicy: true,
      });
      await this.reviews.recheck({ spaceId: input.spaceId, ...p.review, purpose: 'export' });
    });
    return { id: row.id, digest: bundle.manifestDigest, mode: p.mode };
  }
  async download(input: { spaceId: string; id: string }) {
    const p = K.scopeSchema.extend({ id: K.kid }).strict().parse(input),
      row = await this.exportsStore.get({ ...p, revision: 1, purpose: 'export' });
    await this.sources.check({
      spaceId: p.spaceId,
      dependencies: row.dependencies,
      purpose: 'export',
      exactPolicy: true,
    });
    if (hash(row.bundle) !== row.digest) fail('BUNDLE_UNVERIFIED', '导出包已损坏');
    await this.authorize();
    return row.bundle;
  }
  /** 只接受无压缩固定清单；不存在解包路径、链接或压缩炸弹执行面。 Validate an uncompressed allowlisted manifest, never extract paths. */
  private async validate(input: unknown) {
    const bundle = K.bundleSchema.parse(input);
    const keys = new Set<string>();
    let total = 0;
    const content = new Map<string, Buffer>();
    for (const f of bundle.files) {
      const key = f.path.normalize('NFC').toLowerCase();
      if (
        keys.has(key) ||
        f.path !== f.path.normalize('NFC') ||
        !/^(reading\/document\.(html|md)|objects\/knowledge\.json|sources\/[a-f0-9-]+-\d+\.txt)$/.test(f.path)
      )
        fail('BUNDLE_UNVERIFIED', '包路径不允许、重复或有 Unicode 冲突');
      keys.add(key);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.data))
        fail('BUNDLE_UNVERIFIED', '包字节编码不规范');
      const bytes = Buffer.from(f.data, 'base64');
      total += bytes.length;
      if (total > MAX || bytes.length !== f.bytes || sha(bytes) !== f.sha256)
        fail('BUNDLE_UNVERIFIED', '包字节大小或摘要不符');
      content.set(f.path, bytes);
    }
    if (hash(manifest(bundle)) !== bundle.manifestDigest) fail('BUNDLE_UNVERIFIED', '清单摘要不符');
    const objectBytes = content.get('objects/knowledge.json');
    if (!objectBytes || !content.has('reading/document.md') || !content.has('reading/document.html'))
      fail('BUNDLE_UNVERIFIED', '缺少固定条目');
    const payload = payloadSchema.parse(JSON.parse(objectBytes!.toString('utf8')));
    if (canonical(payload) !== objectBytes!.toString('utf8'))
      fail('BUNDLE_UNVERIFIED', '元数据不是规范 UTF-8 排序字段格式');
    const expected = new Set(['reading/document.md', 'reading/document.html', 'objects/knowledge.json']);
    const lookup = <T extends K.Ref>(rows: T[], r: K.Ref) => {
      const item = rows.find((v) => v.id === r.id && v.revision === r.revision);
      if (!item) fail('BUNDLE_UNVERIFIED', '引用图缺少固定对象');
      return item;
    };
    const all = [
      payload.document,
      ...payload.entries,
      ...payload.citations,
      ...payload.extractions,
      ...payload.sources,
      payload.review,
    ];
    for (const rows of [payload.entries, payload.citations, payload.extractions, payload.sources])
      if (new Set(rows.map((v) => `${v.id}:${v.revision}`)).size !== rows.length)
        fail('BUNDLE_UNVERIFIED', '对象重复');
    if (all.some((v) => v.spaceId !== payload.document.spaceId)) fail('BUNDLE_UNVERIFIED', '跨空间引用');
    const d = payload.document;
    if (
      hash({
        title: d.title,
        template: d.template,
        applicability: d.applicability,
        sections: d.sections,
        templateRevision: d.templateRevision,
        archived: d.archived,
      }) !== d.digest
    )
      fail('BUNDLE_UNVERIFIED', '文稿内容摘要不符');
    for (const e of payload.entries)
      if (hash({ title: e.title, assertions: e.assertions, archived: e.archived }) !== e.digest)
        fail('BUNDLE_UNVERIFIED', '条目内容摘要不符');
    for (const c of payload.citations)
      if (
        hash({
          source: c.source,
          extraction: c.extraction,
          sourceDigest: c.sourceDigest,
          textDigest: c.textDigest,
          quote: c.quote,
          quoteDigest: c.quoteDigest,
          start: c.start,
          end: c.end,
          locator: c.locator,
        }) !== c.digest
      )
        fail('BUNDLE_UNVERIFIED', '引文对象摘要不符');
    const r = payload.review;
    if (
      r.document.id !== d.id ||
      r.document.revision !== d.revision ||
      r.documentDigest !== d.digest ||
      hash({
        document: r.document,
        documentDigest: r.documentDigest,
        rules: r.rules,
        issues: r.issues,
        decision: r.decision,
        acknowledgements: r.acknowledgements,
        note: r.note,
        mode: r.mode,
      }) !== r.digest
    )
      fail('BUNDLE_UNVERIFIED', '导入审阅引用或摘要不符');
    for (const s of payload.document.sections) {
      for (const e of s.entries) lookup(payload.entries, e);
      for (const c of s.citations) lookup(payload.citations, c);
    }
    for (const e of payload.entries)
      for (const a of e.assertions)
        for (const c of [...a.supports, ...a.conflicts]) lookup(payload.citations, c);
    if (bundle.mode === 'handover') {
      for (const source of payload.sources) {
        const path = `sources/${source.id}-${source.revision}.txt`;
        expected.add(path);
        const bytes = content.get(path);
        if (!bytes || sha(bytes) !== source.digest || bytes.length !== source.bytes)
          fail('BUNDLE_UNVERIFIED', '原材料缺少或摘要不符');
        if (source.revoked || !source.policy.export) fail('BUNDLE_UNVERIFIED', '来源许可声明禁止交接');
      }
      for (const e of payload.extractions) {
        const source = lookup(payload.sources, e.source),
          bytes = content.get(`sources/${source.id}-${source.revision}.txt`)!;
        const parsed = await computeKnowledge<ParsedMaterial>('parse', async () => ({
          data: bytes,
          format: source.format,
        }));
        if (
          e.sourceDigest !== source.digest ||
          e.parser !== parsed.parser ||
          e.textDigest !== parsed.textDigest ||
          hash(e.blocks) !== hash(parsed.blocks)
        )
          fail('BUNDLE_UNVERIFIED', '解析版本或位置映射不符');
      }
      for (const c of payload.citations) {
        const e = lookup(payload.extractions, c.extraction);
        if (
          c.source.id !== e.source.id ||
          c.source.revision !== e.source.revision ||
          c.sourceDigest !== e.sourceDigest ||
          c.textDigest !== e.textDigest ||
          sha(c.quote) !== c.quoteDigest ||
          !e.blocks.some(
            (b) => b.start === c.start && b.end === c.end && b.text === c.quote && b.locator === c.locator,
          )
        )
          fail('BUNDLE_UNVERIFIED', '引文位置或摘要不符');
      }
      for (const d of payload.document.dependencies) {
        const source = lookup(payload.sources, d);
        if (d.digest !== source.digest) fail('BUNDLE_UNVERIFIED', '文稿依赖摘要不符');
      }
    } else if (payload.sources.length || payload.extractions.length)
      fail('BUNDLE_UNVERIFIED', '阅读包不能夹带材料');
    if ([...content.keys()].some((path) => !expected.has(path))) fail('BUNDLE_UNVERIFIED', '存在未声明字节');
    const output = renderDocument(payload.document, payload.entries, payload.citations);
    if (
      output.markdown !== content.get('reading/document.md')!.toString('utf8') ||
      output.html !== content.get('reading/document.html')!.toString('utf8')
    )
      fail('BUNDLE_UNVERIFIED', '阅读内容不同于固定安全渲染');
    return { bundle, payload, content };
  }
  async inspectImport(input: { bundle: unknown }) {
    const request = z.object({ bundle: z.unknown() }).strict().parse(input);
    await this.authorize();
    const length = Buffer.byteLength(JSON.stringify(request.bundle));
    if (length > 24 * 1024 ** 2) fail('BUNDLE_UNVERIFIED', '上传包超过 24 MiB', 413);
    const id = randomUUID(),
      capacity = await this.sources.reserveQuarantine({
        bytes: length * 2 + 8192,
        operationId: randomUUID(),
      });
    let bundle: K.Bundle | undefined,
      issues: string[] = [],
      state: 'checked' | 'rejected' = 'checked';
    try {
      const checked = await this.validate(request.bundle);
      bundle = checked.bundle;
      issues = [
        '完整性通过，来源身份未认证',
        '导入审阅仅供参考；接收后重新审阅才能发布',
        ...checked.payload.missing,
        ...sensitive(checked.content.get('reading/document.md')!.toString('utf8')),
      ];
    } catch (e) {
      state = 'rejected';
      issues = [(e instanceof Error ? e.message : String(e)).slice(0, 2000)];
    }
    const row: QRow = {
      id,
      spaceId: id,
      revision: 1,
      digest: hash(request.bundle),
      state,
      mode: bundle?.mode,
      issues,
      createdAt: now(),
      mapping: {},
      identity: 'unverified',
      bundle,
      capacityToken: capacity.token,
      accepting: false,
    };
    await this.quarantine.append(row);
    await this.sources.settleQuarantine({ token: capacity.token, actual: Buffer.byteLength(canonical(row)) });
    return this.publicQuarantine(row);
  }
  private publicQuarantine(row: QRow): K.Quarantine {
    return K.quarantineSchema.parse({
      id: row.id,
      digest: row.digest,
      state: row.state,
      mode: row.mode,
      issues: row.issues,
      createdAt: row.createdAt,
      spaceId: row.state === 'accepted' ? row.spaceId : undefined,
      mapping: row.mapping,
      identity: 'unverified',
    });
  }
  /** 重启后只恢复状态，不重放接收；原包仍须用户重新检查。 Reconcile interrupted receipts without replay. */
  private async reconcileImports() {
    const rows = await this.quarantine.all();
    const readable = new Set((await this.sources.listSpaces()).map((space) => space.id));
    for (const row of rows) {
      if (!row.accepting || this.activeImports.has(row.id)) continue;
      await this.quarantine.change(
        row.spaceId,
        (current) => {
          const r = current.find((r) => r.id === row.id);
          if (!r?.accepting || this.activeImports.has(r.id)) return;
          r.accepting = false;
          const complete =
            readable.has(r.spaceId) && Object.keys(r.mapping).some((key) => key.startsWith('document:'));
          r.state = complete ? 'accepted' : 'rejected';
          r.issues.push(
            complete
              ? '已核对完整空间与新 ID 映射，补记中断前完成的接收回执。'
              : '原接收进程已结束；保留映射和隔离空间，允许删除原包并重新检查。',
          );
        },
        true,
      );
    }
  }
  async imports() {
    await this.reconcileImports();
    return (await this.quarantine.all()).map((r) => this.publicQuarantine(r));
  }
  async discardImport(input: { id: string }) {
    const p = z.object({ id: K.kid }).strict().parse(input);
    await this.reconcileImports();
    const existing = (await this.quarantine.all()).find((r) => r.id === p.id);
    if (!existing) fail('KNOWLEDGE_NOT_FOUND', '隔离记录不存在', 404);
    if (existing.accepting) fail('KNOWLEDGE_CLEANUP_PENDING', '接收已开始；保留原隔离证据等待恢复');
    const row = await this.quarantine.change(
      existing.spaceId,
      (rows) => {
        const r = rows.find((r) => r.id === p.id)!;
        delete r.bundle;
        if (r.state !== 'accepted') r.state = 'rejected';
        r.issues = ['已删除隔离包字节，保留摘要和接收回执'];
        return r;
      },
      true,
    );
    await this.sources.settleQuarantine({
      token: row.capacityToken,
      actual: Buffer.byteLength(canonical(row)),
    });
    return this.publicQuarantine(row);
  }
  async acceptImport(input: { id: string; name: string; acceptUnverified: boolean }, signal?: AbortSignal) {
    const p = z
      .object({ id: K.kid, name: z.string().min(1).max(120), acceptUnverified: z.literal(true) })
      .strict()
      .parse(input);
    await this.reconcileImports();
    if (this.activeImports.has(p.id)) fail('REVISION_CONFLICT', '该隔离包正在接收');
    this.activeImports.add(p.id);
    try {
      return await this.acceptChecked(p, signal);
    } catch (error) {
      const row = (await this.quarantine.all()).find((r) => r.id === p.id);
      if (row?.accepting && !Object.keys(row.mapping).some((key) => key.startsWith('document:')))
        await this.quarantine.change(
          row.spaceId,
          (rows) => {
            const r = rows.find((r) => r.id === p.id)!;
            r.accepting = false;
            r.state = 'rejected';
            r.issues.push('接收未确认；保留原包和映射，可检查后重新接收。');
          },
          true,
        );
      throw error;
    } finally {
      this.activeImports.delete(p.id);
    }
  }
  private async acceptChecked(
    input: { id: string; name: string; acceptUnverified: boolean },
    signal?: AbortSignal,
  ) {
    const p = z
      .object({ id: K.kid, name: z.string().min(1).max(120), acceptUnverified: z.literal(true) })
      .strict()
      .parse(input);
    const old = (await this.quarantine.all()).find((r) => r.id === p.id);
    if (!old || old.state !== 'checked' || !old.bundle || old.accepting)
      fail('BUNDLE_UNVERIFIED', '隔离记录未通过或接收中断，需重新检查原包');
    const checked = await this.validate(old.bundle);
    await this.quarantine.change(
      old.spaceId,
      (rows) => {
        const r = rows.find((r) => r.id === p.id)!;
        if (r.accepting) fail('REVISION_CONFLICT', '接收已开始');
        r.accepting = true;
      },
      true,
    );
    await this.sources.importSpace({ name: p.name }, async (space) => {
      const mapping: Record<string, string> = {},
        sourceMap = new Map<string, K.Source>(),
        extractMap = new Map<string, K.Extraction>(),
        citeMap = new Map<string, K.Citation>(),
        entryMap = new Map<string, K.Entry>();
      const key = (r: K.Ref) => `${r.id}:${r.revision}`;
      try {
        const payload = checked.payload;
        if (checked.bundle.mode === 'handover') {
          for (const source of payload.sources) {
            signal?.throwIfAborted();
            const result = await this.sources.upload({
              spaceId: space.id,
              name: source.name,
              format: source.format,
              data: checked.content.get(`sources/${source.id}-${source.revision}.txt`)!.toString('base64'),
              policy: { ...source.policy, export: false },
            });
            sourceMap.set(key(source), result);
            mapping[`source:${key(source)}`] = result.id;
          }
          for (const e of payload.extractions) {
            const source = sourceMap.get(key(e.source))!;
            const plan = await this.extract.plan({ spaceId: space.id, sources: [ref(source)] }),
              [result] = await this.extract.run({ spaceId: space.id, token: plan.token }, signal);
            extractMap.set(key(e), result);
            mapping[`extraction:${key(e)}`] = result.id;
          }
          for (const c of payload.citations) {
            const e = extractMap.get(key(c.extraction))!;
            const result = await this.evidence.create({
              spaceId: space.id,
              extraction: ref(e),
              start: c.start,
              end: c.end,
            });
            citeMap.set(key(c), result);
            mapping[`citation:${key(c)}`] = result.id;
          }
          for (const e of payload.entries) {
            const result = await this.entries.create({
              spaceId: space.id,
              title: e.title,
              assertions: e.assertions.map((a) => ({
                ...a,
                supports: a.supports.map((c) => ref(citeMap.get(key(c))!)),
                conflicts: a.conflicts.map((c) => ref(citeMap.get(key(c))!)),
              })),
            });
            entryMap.set(key(e), result);
            mapping[`entry:${key(e)}`] = result.id;
          }
        }
        const d = payload.document,
          document = await this.documents.create({
            spaceId: space.id,
            title: d.title,
            template: d.template,
            applicability: d.applicability,
            sections:
              checked.bundle.mode === 'handover'
                ? d.sections.map((s) => ({
                    ...s,
                    entries: s.entries.map((e) => ref(entryMap.get(key(e))!)),
                    citations: s.citations.map((c) => ref(citeMap.get(key(c))!)),
                  }))
                : K.knowledgeTemplates[d.template].map((heading, i) => ({
                    heading,
                    text:
                      i === 0
                        ? '【待核实阅读包，未收录全文证据】\n' +
                          checked.content.get('reading/document.md')!.toString('utf8')
                        : '导入阅读包未提供结构化原材料，请人工补充。',
                    entries: [],
                    citations: [],
                  })),
          });
        mapping[`document:${key(d)}`] = document.id;
        signal?.throwIfAborted();
        await this.authorize();
        await this.quarantine.change(
          old.spaceId,
          (rows) => {
            const r = rows.find((r) => r.id === p.id)!;
            r.state = 'checked';
            r.accepting = true;
            r.spaceId = space.id;
            r.mapping = mapping;
            return r;
          },
          true,
        );
      } catch (error) {
        await this.quarantine.change(
          old.spaceId,
          (rows) => {
            const r = rows.find((r) => r.id === p.id)!;
            r.issues.push('接收中断；新空间保持隔离。重新检查原包可重新接收。');
            r.accepting = false;
            r.state = 'rejected';
            r.mapping = mapping;
          },
          true,
        );
        throw error;
      }
    });
    const accepted = await this.quarantine.change(
      old.spaceId,
      (rows) => {
        const row = rows.find((r) => r.id === p.id)!;
        row.state = 'accepted';
        row.accepting = false;
        return row;
      },
      true,
    );
    return this.publicQuarantine(accepted);
  }
  async close() {
    await this.exportsStore.close();
    await this.quarantine.close();
  }
}

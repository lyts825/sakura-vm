/** 本地化对象各归其插件持有，聚合只调用声明的版本服务。 */
import { z } from 'zod';
import type { PluginMetadata } from './plugin-metadata.ts';
import type { FilesV2 } from './service-contracts/files-v2.ts';
import { resourceContext } from './host-runtime/context.ts';
import { captureRequestSchema } from '../shared/contracts/files-capture.ts';
import * as S from '../shared/contracts/suite-common.ts';
import * as L from '../shared/contracts/locale-studio.ts';
import {
  SuiteStore,
  suiteActor,
  suiteHash,
  suiteSha,
  suiteFail,
  type SuiteAuthorize,
} from './suite-store.ts';
import { SuiteMaterials } from './suite-materials.ts';
import { readSuiteText, computeLocale } from './suite-compute.ts';
import {
  canonicalLocaleLanguage,
  localePlaceholders,
  validateLocaleTerms,
  buildLocaleFile,
} from './suite-locale-analysis.ts';
import type {
  LocaleCatalogsV1,
  LocaleContextsV1,
  LocaleTranslationsV1,
  LocaleChecksV1,
  LocalePreviewsV1,
  LocaleReviewsV1,
} from './service-contracts/locale-studio.ts';
type Port = S.SuiteRecordsV1;
type Peers = Readonly<Record<string, Port>>;
const scope = (p: S.SuiteScope) => ({ workspaceId: p.workspaceId });
const ref = (r: S.SuiteRecord): S.SuiteRef => ({ domain: r.domain, id: r.id, revision: r.revision });
const pin = (s: S.SuiteScope, r: S.SuiteRef): S.SuitePin => ({ ...s, id: r.id, revision: r.revision });
const json = (v: unknown): S.SuiteJson => S.suiteJson.parse(v);
const same = (a: S.SuiteRef, b: S.SuiteRef) =>
  a.domain === b.domain && a.id === b.id && a.revision === b.revision;
const one = <K extends string>(key: K) =>
  S.suiteScope.extend({ [key]: S.suiteRef } as Record<K, typeof S.suiteRef>).strict();
export const localeUploadText = S.suiteScope
  .extend({ name: S.suiteName, text: z.string().max(1024 * 1024), allowExport: z.boolean().default(false) })
  .strict();
export class LocaleCatalogs extends SuiteMaterials {
  constructor(
    meta: PluginMetadata,
    uploads: PluginMetadata,
    auth: SuiteAuthorize,
    private files?: FilesV2,
  ) {
    super('locale-catalogs', meta, uploads, auth, 2 * 1024 ** 3, 32 * 1024 ** 2, [
      'json',
      'text',
      'png',
      'jpeg',
    ]);
  }
  async upload(raw: z.input<typeof localeUploadText>) {
    const p = localeUploadText.parse(raw),
      bytes = Buffer.from(p.text);
    const upload = await this.beginUpload({
      ...scope(p),
      name: p.name,
      format: 'json',
      bytes: bytes.length,
      digest: suiteSha(bytes),
      allowExport: p.allowExport,
    });
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024)
      await this.appendUpload({
        ...scope(p),
        id: upload.id,
        offset,
        data: bytes.subarray(offset, offset + 512 * 1024).toString('base64'),
      });
    return this.finishUpload({ ...scope(p), id: upload.id });
  }
  async importJson(raw: z.infer<typeof L.localeImport>) {
    const p = L.localeImport.parse(raw),
      source = await this.fixed(scope(p), p.source);
    if (source.domain !== this.domain || source.kind !== 'source') suiteFail('LOCALE_SOURCE_REQUIRED');
    const content = await computeLocale<z.infer<typeof L.localeCatalog>>(
      'locale-catalogs',
      'catalog',
      async () => {
        const material = await readSuiteText(this, scope(p), p.source);
        if (!['json', 'text'].includes(material.format)) suiteFail('LOCALE_STRING_MAP_REQUIRED');
        const original = S.suiteMaterial.parse(source.content);
        return {
          text: material.text,
          source: p.source,
          language: p.language,
          role: p.role,
          originalDigest: original.digest,
          originalBytes: original.bytes,
        };
      },
    );
    return this.put(
      {
        ...scope(p),
        name: `${content.language} ${content.role === 'source' ? '源文' : '目标目录'}`,
        content: json(content),
        references: [p.source],
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof L.localeCompare>) {
    const p = L.localeCompare.parse(raw),
      before = L.localeCatalog.parse((await this.fixed(scope(p), p.before)).content),
      after = L.localeCatalog.parse((await this.fixed(scope(p), p.after)).content);
    if (before.language !== after.language || before.role !== after.role)
      suiteFail('LOCALE_CATALOG_MISMATCH');
    const a = new Map(before.entries.map((item) => [item.key, item])),
      b = new Map(after.entries.map((item) => [item.key, item]));
    const added = after.entries.filter((e) => !a.has(e.key)).map((e) => e.key),
      removed = before.entries.filter((e) => !b.has(e.key)).map((e) => e.key);
    const changed = after.entries
      .filter((e) => a.has(e.key) && a.get(e.key)!.digest !== e.digest)
      .map((e) => e.key);
    const removedDigests = new Map<string, string[]>();
    for (const previous of removed) {
      const digest = a.get(previous)!.digest,
        group = removedDigests.get(digest) ?? [];
      if (group.length < 1000) group.push(previous);
      removedDigests.set(digest, group);
    }
    const renameCandidates: { previous: string; next: string }[] = [];
    for (const next of added) {
      for (const previous of removedDigests.get(b.get(next)!.digest) ?? []) {
        if (renameCandidates.length >= 1000) break;
        renameCandidates.push({ previous, next });
      }
      if (renameCandidates.length >= 1000) break;
    }
    return this.put(
      {
        ...scope(p),
        name: '源文目录差异',
        content: {
          before: p.before,
          after: p.after,
          added,
          removed,
          changed,
          renameCandidates,
          renameApplied: false,
        },
        references: [p.before, p.after],
      },
      'result',
      true,
    );
  }
  async planCapture(raw: unknown) {
    const p = S.suiteScope
      .extend({ request: captureRequestSchema, allowExport: z.boolean().default(false) })
      .strict()
      .parse(raw);
    if (!this.files) suiteFail('SUITE_CAPTURE_UNAVAILABLE', '请启用文件插件或上传目录 JSON');
    const plan = await this.files.planCapture({
      ...p.request,
      maxBytes: Math.min(p.request.maxBytes, 32 * 1024 ** 2),
    });
    if (plan.files.some((file) => !file.path.endsWith('.json'))) suiteFail('LOCALE_CAPTURE_JSON_ONLY');
    return this.plan(
      scope(p),
      'capture',
      json({ token: plan.token, files: plan.files, allowExport: p.allowExport }),
      [],
    );
  }
  async capture(raw: S.SuiteApproval) {
    if (!this.files) suiteFail('SUITE_CAPTURE_UNAVAILABLE');
    const plan = await this.consume(raw, 'capture');
    if (plan.state === 'completed') suiteFail('SUITE_PLAN_CONSUMED');
    const input = z
      .object({
        token: S.suiteId,
        files: z.array(
          z.object({ path: z.string(), sha256: S.suiteDigest, bytes: z.number().int().min(0) }).strict(),
        ),
        allowExport: z.boolean(),
      })
      .strict()
      .parse(plan.input);
    const receipt = await this.files.capture({ planToken: input.token }),
      results: S.SuiteRecord[] = [];
    try {
      if (receipt.files.length !== input.files.length) suiteFail('SUITE_CAPTURE_CHANGED');
      for (const file of receipt.files) {
        if (
          !input.files.some(
            (original) =>
              original.path === file.path && original.sha256 === file.sha256 && original.bytes === file.bytes,
          )
        )
          suiteFail('SUITE_CAPTURE_CHANGED');
        const upload = await this.beginUpload({
          workspaceId: plan.workspaceId,
          name: file.path,
          format: 'json',
          bytes: file.bytes,
          digest: file.sha256,
          allowExport: input.allowExport,
        });
        for (let offset = 0; offset < file.bytes;) {
          const part = await this.files.readCaptured(
              receipt.token,
              file.path,
              offset,
              Math.min(512 * 1024, file.bytes - offset),
            ),
            bytes = Buffer.from(part.data, 'base64');
          if (!bytes.length || part.offset !== offset + bytes.length) suiteFail('SUITE_SHORT_READ');
          await this.appendUpload({ workspaceId: plan.workspaceId, id: upload.id, offset, data: part.data });
          offset += bytes.length;
        }
        results.push(await this.finishUpload({ workspaceId: plan.workspaceId, id: upload.id }));
      }
    } finally {
      await this.files.releaseCapture(receipt.token);
    }
    if (results.length) await this.complete(plan, results[0]);
    return results;
  }
}
export class LocaleContexts extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private catalogs: S.SuiteMaterialsV1,
  ) {
    super('locale-contexts', meta, auth, catalogs, { 'locale-catalogs': catalogs });
  }
  async attach(raw: z.infer<typeof L.localeContextAttach>) {
    const p = L.localeContextAttach.parse(raw),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content);
    const keys = new Set(catalog.entries.map((e) => e.key)),
      seen = new Set<string>(),
      references = [p.catalog];
    for (const item of p.items) {
      if (!keys.has(item.key) || seen.has(item.key)) suiteFail('LOCALE_CONTEXT_KEY');
      seen.add(item.key);
      if (item.screenshot) {
        const row = await this.fixed(scope(p), item.screenshot),
          material = S.suiteMaterial.parse(row.content);
        if (
          row.kind !== 'source' ||
          !['png', 'jpeg'].includes(material.format) ||
          material.bytes > 8 * 1024 ** 2
        )
          suiteFail('LOCALE_SCREENSHOT_FORMAT');
        const lease = await this.catalogs.openRead(pin(scope(p), item.screenshot));
        try {
          const chunk = await this.catalogs.readLease({
            ...scope(p),
            id: lease.id,
            offset: 0,
            length: Math.min(512 * 1024, Math.max(1, material.bytes)),
          });
          const bytes = Buffer.from(chunk.data, 'base64');
          let width = 0,
            height = 0;
          if (
            material.format === 'png' &&
            bytes.length >= 33 &&
            bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
            bytes.toString('ascii', 12, 16) === 'IHDR'
          ) {
            width = bytes.readUInt32BE(16);
            height = bytes.readUInt32BE(20);
          }
          if (material.format === 'jpeg' && bytes[0] === 255 && bytes[1] === 216) {
            for (let i = 2; i + 9 < bytes.length;) {
              if (bytes[i] !== 255) break;
              const marker = bytes[i + 1];
              if (marker === 0xd9 || marker === 0xda) break;
              if (marker === 0xff) {
                i++;
                continue;
              }
              const length = bytes.readUInt16BE(i + 2);
              if (length < 2 || i + 2 + length > bytes.length) break;
              if ([0xc0, 0xc1, 0xc2].includes(marker)) {
                height = bytes.readUInt16BE(i + 5);
                width = bytes.readUInt16BE(i + 7);
                break;
              }
              i += length + 2;
            }
          }
          if (!width || !height || width * height > 16000000) suiteFail('LOCALE_SCREENSHOT_DIMENSIONS');
        } finally {
          await this.catalogs.closeRead({ ...scope(p), id: lease.id });
        }
        references.push(item.screenshot);
      }
    }
    return this.put(
      {
        ...scope(p),
        name: '文案使用上下文',
        content: json({ catalog: p.catalog, items: p.items }),
        references,
      },
      'result',
      true,
    );
  }
  async inspect(raw: S.SuiteScope & { contexts: S.SuiteRef }) {
    const p = one('contexts').parse(raw);
    return this.fixed(scope(p), p.contexts);
  }
}
export class LocaleTerminology extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, root: S.SuiteMaterialsV1) {
    super('locale-terminology', meta, auth, root, { 'locale-catalogs': root }, L.localeTerminology);
  }
  override async save(raw: S.SuiteSave) {
    const content = L.localeTerminology.parse(raw.content);
    content.language = canonicalLocaleLanguage(content.language);
    const result = validateLocaleTerms(content);
    if (!result.valid) suiteFail('LOCALE_TERM_CONFLICT', result.conflicts.join('；'));
    return super.save({ ...raw, content: json(content) });
  }
  async validate(raw: S.SuiteScope & { terminology: S.SuiteRef }) {
    const p = one('terminology').parse(raw);
    return validateLocaleTerms((await this.fixed(scope(p), p.terminology)).content);
  }
  async lookup(raw: S.SuiteScope & { terminology: S.SuiteRef; text: string }) {
    const p = one('terminology')
        .extend({ text: z.string().max(16384) })
        .strict()
        .parse(raw),
      terms = L.localeTerminology.parse((await this.fixed(scope(p), p.terminology)).content);
    return terms.terms.filter((term) => p.text.includes(term.source));
  }
}
export class LocaleTranslations extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, root: S.SuiteMaterialsV1, peers: Peers) {
    super('locale-translations', meta, auth, root, peers);
  }
  async applyDelta(raw: z.input<typeof L.localeDelta>) {
    const p = L.localeDelta.parse(raw),
      row = await this.fixed(scope(p), p.translation),
      before = L.localeTranslation.parse(row.content),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), before.catalog)).content),
      terminology = p.terminology ?? before.terminology,
      contexts = p.contexts === undefined ? before.contexts : p.contexts,
      terms = L.localeTerminology.parse((await this.fixed(scope(p), terminology)).content);
    if (catalog.role !== 'source' || catalog.language === before.language)
      suiteFail('LOCALE_TRANSLATION_SOURCE');
    if (terms.language !== before.language || !validateLocaleTerms(terms).valid)
      suiteFail('LOCALE_TERM_LANGUAGE');
    const references = [...row.references];
    if (!references.some((reference) => same(reference, terminology))) references.push(terminology);
    if (contexts) {
      const context = L.localeContexts.parse((await this.fixed(scope(p), contexts)).content);
      if (!same(context.catalog, before.catalog)) suiteFail('LOCALE_CONTEXT_MISMATCH');
      if (!references.some((reference) => same(reference, contexts))) references.push(contexts);
    }
    const source = new Map(catalog.entries.map((item) => [item.key, item])),
      items = new Map(before.items.map((item) => [item.key, item])),
      seen = new Set<string>();
    for (const item of p.items) {
      if (!source.has(item.key) || seen.has(item.key)) suiteFail('LOCALE_TRANSLATION_KEY');
      seen.add(item.key);
      localePlaceholders(item.text);
      items.set(item.key, { ...item, sourceDigest: source.get(item.key)!.digest, stale: false });
    }
    for (const key of p.remove) {
      if (seen.has(key) || !items.has(key)) suiteFail('LOCALE_TRANSLATION_KEY');
      seen.add(key);
      items.delete(key);
    }
    return this.put(
      {
        ...scope(p),
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        content: json(
          L.localeTranslation.parse({
            ...before,
            terminology,
            contexts,
            provenance: 'manual',
            items: catalog.entries.flatMap((entry) =>
              items.has(entry.key) ? [items.get(entry.key)!] : [],
            ),
          }),
        ),
        references,
      },
      'result',
      true,
    );
  }
  async revise(raw: z.infer<typeof L.localeRevise>) {
    const p = L.localeRevise.parse(raw),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content),
      language = canonicalLocaleLanguage(p.language);
    if (catalog.role !== 'source' || catalog.language === language) suiteFail('LOCALE_TRANSLATION_SOURCE');
    const terms = L.localeTerminology.parse((await this.fixed(scope(p), p.terminology)).content);
    if (terms.language !== language || !validateLocaleTerms(terms).valid) suiteFail('LOCALE_TERM_LANGUAGE');
    const references = [p.catalog, p.terminology];
    if (p.contexts) {
      const context = L.localeContexts.parse((await this.fixed(scope(p), p.contexts)).content);
      if (!same(context.catalog, p.catalog)) suiteFail('LOCALE_CONTEXT_MISMATCH');
      references.push(p.contexts);
    }
    let items = p.items;
    if (p.targetCatalog) {
      if (items.length) suiteFail('LOCALE_TRANSLATION_INPUT_CONFLICT');
      const target = L.localeCatalog.parse((await this.fixed(scope(p), p.targetCatalog)).content);
      if (target.role !== 'target' || target.language !== language) suiteFail('LOCALE_TARGET_LANGUAGE');
      items = target.entries.map(({ key, text }) => ({ key, text }));
      references.push(p.targetCatalog);
    }
    const keys = new Map(catalog.entries.map((e) => [e.key, e])),
      seen = new Set<string>();
    const content = L.localeTranslation.parse({
      format: 'sakura-locale-translations/1',
      catalog: p.catalog,
      language,
      terminology: p.terminology,
      contexts: p.contexts,
      provenance: p.targetCatalog ? 'catalog-import' : 'manual',
      items: items.map((item) => {
        if (!keys.has(item.key) || seen.has(item.key)) suiteFail('LOCALE_TRANSLATION_KEY');
        seen.add(item.key);
        localePlaceholders(item.text);
        return { ...item, sourceDigest: keys.get(item.key)!.digest, stale: false };
      }),
    });
    return this.put(
      {
        ...scope(p),
        id: p.id,
        expectedRevision: p.expectedRevision,
        name: p.name,
        content: json(content),
        references,
      },
      'result',
      true,
    );
  }
  async markStale(raw: S.SuiteScope & { translation: S.SuiteRef; catalog: S.SuiteRef }) {
    const p = one('translation').extend({ catalog: S.suiteRef }).strict().parse(raw),
      row = await this.fixed(scope(p), p.translation),
      old = L.localeTranslation.parse(row.content),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content);
    const source = L.localeCatalog.parse((await this.fixed(scope(p), old.catalog)).content);
    if (catalog.language !== source.language || catalog.role !== 'source')
      suiteFail('LOCALE_CATALOG_MISMATCH');
    const keys = new Map(catalog.entries.map((e) => [e.key, e.digest]));
    return this.put(
      {
        ...scope(p),
        name: row.name + ' · 源文更新',
        content: json({
          ...old,
          catalog: p.catalog,
          contexts: null,
          items: old.items
            .filter((item) => keys.has(item.key))
            .map((item) => ({ ...item, stale: item.stale || keys.get(item.key) !== item.sourceDigest })),
        }),
        references: [p.translation, p.catalog, old.terminology],
      },
      'result',
      true,
    );
  }
  async remember(raw: z.infer<typeof L.localeMemoryInput>) {
    const p = L.localeMemoryInput.parse(raw),
      consumer = resourceContext()?.serviceConsumerPluginInstanceId;
    if (
      !consumer ||
      !/^official:locale-reviews(?::|$)/.test(consumer) ||
      p.review.domain !== 'locale-reviews'
    )
      suiteFail('LOCALE_MEMORY_CONSUMER', '只有原审阅服务可以登记已接受记忆', 403);
    const translation = await this.fixed(scope(p), p.translation),
      content = L.localeTranslation.parse(translation.content);
    if (content.items.some((item) => item.stale)) suiteFail('LOCALE_STALE_MEMORY');
    return this.put(
      {
        ...scope(p),
        name: '已审阅翻译记忆',
        content: json({
          format: 'sakura-locale-memory/1',
          translation: p.translation,
          reviewReceipt: p.review,
          language: content.language,
        }),
        references: [p.translation],
      },
      'result',
      true,
    );
  }
  async suggestFromMemory(
    raw: S.SuiteScope & { catalog: S.SuiteRef; terminology: S.SuiteRef; language: string; keys: string[] },
  ) {
    const p = one('catalog')
        .extend({
          terminology: S.suiteRef,
          language: L.localeLanguage,
          keys: z.array(L.localeKey).min(1).max(100),
        })
        .strict()
        .parse(raw),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content),
      language = canonicalLocaleLanguage(p.language);
    const terms = L.localeTerminology.parse((await this.fixed(scope(p), p.terminology)).content);
    if (terms.language !== language) suiteFail('LOCALE_TERM_LANGUAGE');
    const wanted = new Map(
      catalog.entries.filter((e) => p.keys.includes(e.key)).map((e) => [e.key, e.digest]),
    );
    if (wanted.size !== new Set(p.keys).size) suiteFail('LOCALE_TRANSLATION_KEY');
    const candidates: {
      key: string;
      text: string;
      translation: S.SuiteRef;
      reviewReceipt: S.SuiteRef;
      acceptedAutomatically: false;
    }[] = [];
    let cursor = 0,
      examined = 0;
    do {
      const page = await this.list({ ...scope(p), cursor, limit: 100 });
      for (const row of page.items) {
        if (++examined > 10000) suiteFail('LOCALE_MEMORY_SCAN_LIMIT', '翻译记忆数量超限，请缩小空间');
        if (
          row.origin !== 'local' ||
          !row.content ||
          typeof row.content !== 'object' ||
          Array.isArray(row.content) ||
          row.content.format !== 'sakura-locale-memory/1' ||
          row.content.language !== language
        )
          continue;
        const memory = z
          .object({
            format: z.literal('sakura-locale-memory/1'),
            translation: S.suiteRef,
            reviewReceipt: S.suiteRef,
            language: L.localeLanguage,
          })
          .strict()
          .parse(row.content);
        const translation = L.localeTranslation.parse(
          (await this.fixed(scope(p), memory.translation)).content,
        );
        const memoryTerms = L.localeTerminology.parse(
          (await this.fixed(scope(p), translation.terminology)).content,
        );
        if (memoryTerms.domain !== terms.domain) continue;
        for (const item of translation.items)
          if (!item.stale && wanted.get(item.key) === item.sourceDigest && candidates.length < 500)
            candidates.push({
              key: item.key,
              text: item.text,
              translation: memory.translation,
              reviewReceipt: memory.reviewReceipt,
              acceptedAutomatically: false,
            });
      }
      if (page.next === null) break;
      cursor = page.next;
    } while (true);
    return { language, candidates, provenance: 'local-single-owner-review' as const };
  }
}
export class LocaleChecks extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, root: S.SuiteMaterialsV1, peers: Peers) {
    super('locale-checks', meta, auth, root, peers);
  }
  async evaluate(raw: z.infer<typeof L.localeCheckInput>) {
    const p = L.localeCheckInput.parse(raw),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content),
      translation = L.localeTranslation.parse((await this.fixed(scope(p), p.translation)).content);
    if (!same(translation.catalog, p.catalog)) suiteFail('LOCALE_CATALOG_MISMATCH');
    const terminology = L.localeTerminology.parse(
        (await this.fixed(scope(p), translation.terminology)).content,
      ),
      contexts = translation.contexts
        ? L.localeContexts.parse((await this.fixed(scope(p), translation.contexts)).content)
        : null;
    if (terminology.language !== translation.language || !validateLocaleTerms(terminology).valid)
      suiteFail('LOCALE_TERM_LANGUAGE');
    if (contexts && !same(contexts.catalog, p.catalog)) suiteFail('LOCALE_CONTEXT_MISMATCH');
    const content = await computeLocale<z.infer<typeof L.localeCheck>>(
      'locale-checks',
      'checks',
      async () => ({
        catalog,
        translation,
        terminology,
        contexts,
        references: { catalog: p.catalog, translation: p.translation },
      }),
    );
    return this.put(
      {
        ...scope(p),
        name: `${translation.language} 文案检查`,
        content: json(content),
        references: [
          p.catalog,
          p.translation,
          translation.terminology,
          ...(translation.contexts ? [translation.contexts] : []),
        ],
      },
      'result',
      true,
    );
  }
  async explain(raw: S.SuiteScope & { check: S.SuiteRef; key?: string }) {
    const p = one('check').extend({ key: L.localeKey.optional() }).strict().parse(raw),
      check = L.localeCheck.parse((await this.fixed(scope(p), p.check)).content);
    return {
      total: check.total,
      translated: check.translated,
      result: check.result,
      findings: check.findings.filter((f) => !p.key || f.key === p.key),
    };
  }
}
export class LocalePreviews extends SuiteStore {
  constructor(meta: PluginMetadata, auth: SuiteAuthorize, root: S.SuiteMaterialsV1, peers: Peers) {
    super('locale-previews', meta, auth, root, peers);
  }
  async render(raw: z.input<typeof L.localePreviewInput>) {
    const p = L.localePreviewInput.parse(raw),
      check = L.localeCheck.parse((await this.fixed(scope(p), p.check)).content),
      catalog = L.localeCatalog.parse((await this.fixed(scope(p), check.catalog)).content),
      translation = L.localeTranslation.parse((await this.fixed(scope(p), check.translation)).content);
    if (p.offset > catalog.entries.length) suiteFail('LOCALE_PREVIEW_OFFSET');
    const content = await computeLocale<z.infer<typeof L.localePreview>>(
      'locale-previews',
      'preview',
      async () => ({ preview: p, check, catalog, translation }),
    );
    return this.put(
      {
        ...scope(p),
        name: `${translation.language} 固定组件预览`,
        content: json(content),
        references: [p.check, check.catalog, check.translation],
      },
      'result',
      true,
    );
  }
  async compare(raw: z.infer<typeof L.localeCompare>) {
    const p = L.localeCompare.parse(raw),
      before = L.localePreview.parse((await this.fixed(scope(p), p.before)).content),
      after = L.localePreview.parse((await this.fixed(scope(p), p.after)).content);
    return this.put(
      {
        ...scope(p),
        name: '固定预览比较',
        content: json({
          before: p.before,
          after: p.after,
          sameWindow:
            before.offset === after.offset && before.width === after.width && before.pseudo === after.pseudo,
          beforeItems: before.items,
          afterItems: after.items,
          measurement: 'estimate',
        }),
        references: [p.before, p.after],
      },
      'result',
      true,
    );
  }
}
export class LocaleReviews extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Peers,
    private translations: LocaleTranslationsV1,
  ) {
    super('locale-reviews', meta, auth, root, peers);
  }
  async open(raw: z.infer<typeof L.localeReviewOpen>) {
    const p = L.localeReviewOpen.parse(raw),
      check = L.localeCheck.parse((await this.fixed(scope(p), p.check)).content),
      preview = L.localePreview.parse((await this.fixed(scope(p), p.preview)).content);
    if (
      !same(preview.check, p.check) ||
      !same(preview.translation, check.translation) ||
      !same(preview.catalog, check.catalog)
    )
      suiteFail('LOCALE_REVIEW_INPUT');
    return this.put(
      {
        ...scope(p),
        name: `${check.language} 文案审阅`,
        content: json({
          format: 'sakura-locale-review/1',
          check: p.check,
          preview: p.preview,
          status: 'open',
          note: '',
          acknowledged: [],
          reviewer: suiteActor(),
          singleOwnerReview: true,
        }),
        references: [p.check, p.preview],
      },
      'review',
      true,
    );
  }
  async decide(raw: z.infer<typeof L.localeDecision>) {
    const p = L.localeDecision.parse(raw),
      row = await this.fixed(scope(p), p.review),
      review = L.localeReview.parse(row.content);
    if (review.status !== 'open') suiteFail('LOCALE_REVIEW_ALREADY_DECIDED');
    const check = L.localeCheck.parse((await this.fixed(scope(p), review.check)).content),
      ids = new Set(check.findings.map((f) => f.id));
    if (new Set(p.acknowledged).size !== p.acknowledged.length || p.acknowledged.some((id) => !ids.has(id)))
      suiteFail('LOCALE_REVIEW_FINDING');
    if (p.decision === 'accept') {
      if (check.findings.some((f) => f.severity === 'error' && f.code !== 'missing'))
        suiteFail('LOCALE_REVIEW_BLOCKED', '先修复过期译文、占位符、术语和禁用词问题');
      if (check.findings.some((f) => !p.acknowledged.includes(f.id)))
        suiteFail('LOCALE_REVIEW_ACKNOWLEDGMENT', '须逐项确认缺项和长度建议');
    }
    const result = await this.put(
      {
        ...scope(p),
        id: row.id,
        expectedRevision: row.revision,
        name: row.name,
        content: json({
          ...review,
          status: p.decision === 'accept' ? 'accepted' : 'rejected',
          note: p.note,
          acknowledged: p.acknowledged,
          reviewer: suiteActor(),
        }),
        references: row.references,
      },
      'review',
      true,
    );
    if (p.decision === 'accept' && check.result === 'passed')
      await this.translations.remember({ ...scope(p), translation: check.translation, review: ref(result) });
    return result;
  }
  async recheck(raw: S.SuiteScope & { review: S.SuiteRef }) {
    const p = one('review').parse(raw),
      review = L.localeReview.parse((await this.fixed(scope(p), p.review)).content),
      check = L.localeCheck.parse((await this.fixed(scope(p), review.check)).content),
      preview = L.localePreview.parse((await this.fixed(scope(p), review.preview)).content);
    return {
      valid:
        review.status === 'accepted' &&
        same(preview.check, review.check) &&
        !check.findings.some((f) => f.severity === 'error' && f.code !== 'missing') &&
        check.findings.every((f) => review.acknowledged.includes(f.id)),
      reviewer: review.reviewer,
      singleOwnerReview: true as const,
    };
  }
}
export class LocaleReleases extends SuiteStore {
  private releaseTail: Promise<unknown> = Promise.resolve();
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    root: S.SuiteMaterialsV1,
    peers: Peers,
    private reviews: LocaleReviewsV1,
  ) {
    super('locale-releases', meta, auth, root, peers);
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.releaseTail.then(work);
    this.releaseTail = pending.catch(() => {});
    return pending;
  }
  async active(raw: S.SuiteScope): Promise<S.SuiteRecord | null> {
    const p = S.suiteScope.parse(raw);
    let cursor = 0,
      active: S.SuiteRecord | null = null,
      sequence = 0;
    do {
      const page = await this.list({ ...p, cursor, limit: 100 });
      for (const row of page.items) {
        const parsed = L.localeRelease.safeParse(row.content);
        if (
          row.origin === 'local' &&
          row.state === 'sealed' &&
          parsed.success &&
          parsed.data.activationSequence > sequence
        ) {
          active = row;
          sequence = parsed.data.activationSequence;
        }
      }
      if (page.next === null) break;
      cursor = page.next;
    } while (true);
    return active;
  }
  private async prepare(p: z.infer<typeof L.localeReleaseInput>) {
    const catalog = L.localeCatalog.parse((await this.fixed(scope(p), p.catalog)).content);
    if (catalog.role !== 'source' || p.translations.length !== p.reviews.length)
      suiteFail('LOCALE_RELEASE_INPUT');
    const languages = new Set([catalog.language]),
      files = [buildLocaleFile(catalog.language, catalog.entries, catalog.sourceDigest)],
      references = [p.catalog, ...p.translations, ...p.reviews];
    const decisions = new Map<string, z.infer<typeof L.localeCheck>>();
    for (const reference of p.reviews) {
      const review = L.localeReview.parse((await this.fixed(scope(p), reference)).content);
      if (!(await this.reviews.recheck({ ...scope(p), review: reference })).valid)
        suiteFail('LOCALE_REVIEW_REQUIRED');
      const check = L.localeCheck.parse((await this.fixed(scope(p), review.check)).content);
      if (!same(check.catalog, p.catalog) || decisions.has(suiteHash(check.translation)))
        suiteFail('LOCALE_REVIEW_INPUT');
      decisions.set(suiteHash(check.translation), check);
      references.push(review.check);
    }
    for (const reference of p.translations) {
      const row = await this.fixed(scope(p), reference),
        translation = L.localeTranslation.parse(row.content),
        check = decisions.get(suiteHash(reference));
      if (
        !check ||
        !same(translation.catalog, p.catalog) ||
        languages.has(translation.language) ||
        translation.items.some((item) => item.stale)
      )
        suiteFail('LOCALE_RELEASE_TRANSLATION');
      languages.add(translation.language);
      const map = new Map(translation.items.map((item) => [item.key, item])),
        fallbackKeys: string[] = [];
      const entries = catalog.entries.map((entry) => {
        const item = map.get(entry.key);
        if (!item?.text.trim()) {
          if (p.fallback === 'reject') suiteFail('LOCALE_RELEASE_MISSING', `缺少译文：${entry.key}`);
          fallbackKeys.push(entry.key);
          return { key: entry.key, text: entry.text };
        }
        if (item.sourceDigest !== entry.digest) suiteFail('LOCALE_STALE_TRANSLATION');
        return { key: entry.key, text: item.text };
      });
      let originalDigest: string | null = null;
      for (const dependency of row.references.filter(
        (r) => r.domain === 'locale-catalogs' && !same(r, p.catalog),
      )) {
        const original = L.localeCatalog.safeParse((await this.fixed(scope(p), dependency)).content);
        if (
          original.success &&
          original.data.role === 'target' &&
          original.data.language === translation.language
        )
          originalDigest = original.data.sourceDigest;
      }
      files.push(buildLocaleFile(translation.language, entries, originalDigest, fallbackKeys));
    }
    if (files.reduce((bytes, file) => bytes + file.bytes, 0) > 8 * 1024 ** 2)
      suiteFail('LOCALE_RELEASE_BYTES', '本版本语言文件总额最多 8 MiB', 413);
    return {
      catalog: p.catalog,
      translations: p.translations,
      reviews: p.reviews,
      fallback: p.fallback,
      files,
      references,
    };
  }
  async preview(raw: z.infer<typeof L.localeReleaseInput>) {
    const p = L.localeReleaseInput.parse(raw),
      result = await this.prepare(p),
      active = await this.active(scope(p));
    return this.plan(
      scope(p),
      'publish-local',
      json({ input: p, files: result.files, previous: active ? ref(active) : null }),
      result.references,
    );
  }
  async publishLocal(raw: S.SuiteApproval) {
    return this.serial(async () => {
      const plan = await this.consume(raw, 'publish-local'),
        s = { workspaceId: plan.workspaceId };
      if (plan.state === 'completed' && plan.result) return this.get(pin(s, plan.result));
      const p = z
          .object({
            input: L.localeReleaseInput,
            files: z.array(L.localeReleaseFile).max(20),
            previous: S.suiteRef.nullable(),
          })
          .strict()
          .parse(plan.input),
        active = await this.active(s);
      if (suiteHash(active ? ref(active) : null) !== suiteHash(p.previous))
        suiteFail('LOCALE_ACTIVE_CHANGED');
      const result = await this.prepare(p.input);
      if (suiteHash(result.files) !== suiteHash(p.files)) suiteFail('LOCALE_RELEASE_CHANGED');
      const content = L.localeRelease.parse({
        catalog: p.input.catalog,
        translations: p.input.translations,
        reviews: p.input.reviews,
        fallback: p.input.fallback,
        files: result.files,
        activationSequence: active ? L.localeRelease.parse(active.content).activationSequence + 1 : 1,
        previous: p.previous,
        rollbackOf: null,
        format: 'sakura-locale-release/1',
      });
      const record = await this.put(
        {
          ...s,
          name: `本机语言版本 ${content.activationSequence}`,
          content: json(content),
          references: [...result.references, ...(p.previous ? [p.previous] : [])],
        },
        'result',
        true,
      );
      await this.complete(plan, record);
      return record;
    });
  }
  async previewRollback(raw: S.SuiteScope & { release: S.SuiteRef }) {
    const p = one('release').parse(raw),
      release = await this.fixed(scope(p), p.release),
      content = L.localeRelease.parse(release.content),
      active = await this.active(scope(p));
    if (!active || same(ref(active), p.release)) suiteFail('LOCALE_ROLLBACK_TARGET');
    await this.prepare({
      ...scope(p),
      catalog: content.catalog,
      translations: content.translations,
      reviews: content.reviews,
      fallback: content.fallback,
    });
    return this.plan(scope(p), 'rollback', json({ release: p.release, previous: ref(active) }), [
      p.release,
      ref(active),
    ]);
  }
  async rollback(raw: S.SuiteApproval) {
    return this.serial(async () => {
      const plan = await this.consume(raw, 'rollback'),
        s = { workspaceId: plan.workspaceId };
      if (plan.state === 'completed' && plan.result) return this.get(pin(s, plan.result));
      const p = z.object({ release: S.suiteRef, previous: S.suiteRef }).strict().parse(plan.input),
        active = await this.active(s);
      if (!active || !same(ref(active), p.previous)) suiteFail('LOCALE_ACTIVE_CHANGED');
      const target = L.localeRelease.parse((await this.fixed(s, p.release)).content);
      const prepared = await this.prepare({
        ...s,
        catalog: target.catalog,
        translations: target.translations,
        reviews: target.reviews,
        fallback: target.fallback,
      });
      if (suiteHash(prepared.files) !== suiteHash(target.files)) suiteFail('LOCALE_RELEASE_CHANGED');
      const record = await this.put(
        {
          ...s,
          name: '本机语言版本回退',
          content: json({
            ...target,
            activationSequence: L.localeRelease.parse(active.content).activationSequence + 1,
            previous: p.previous,
            rollbackOf: p.release,
          }),
          references: [p.release, p.previous, ...prepared.references],
        },
        'result',
        true,
      );
      await this.complete(plan, record);
      return record;
    });
  }
  async makePatch(raw: S.SuiteScope & { release: S.SuiteRef }) {
    const p = one('release').parse(raw),
      release = L.localeRelease.parse((await this.fixed(scope(p), p.release)).content);
    return this.put(
      {
        ...scope(p),
        name: '待审阅语言补丁',
        content: json({
          format: 'sakura-locale-patch/1',
          release: p.release,
          applied: false,
          files: release.files.map((file) => ({
            path: file.path,
            expectedDigest: file.originalDigest,
            digest: file.digest,
            bytes: file.bytes,
            text: file.text,
            operation: file.originalDigest ? 'replace' : 'create',
          })),
        }),
        references: [p.release],
      },
      'result',
      true,
    );
  }
  override async archive(raw: S.SuitePin) {
    return this.serial(async () => {
      const p = S.suitePin.parse(raw),
        active = await this.active(scope(p));
      if (active && same(ref(active), { domain: this.domain, id: p.id, revision: p.revision }))
        suiteFail('LOCALE_ACTIVE_PROTECTED', '当前本机版本不能归档');
      return super.archive(p);
    });
  }
  override async close() {
    await this.releaseTail;
    await super.close();
  }
}
type WorkbenchPorts = {
  catalogs: LocaleCatalogsV1;
  contexts: LocaleContextsV1;
  terminology: Port;
  translations: LocaleTranslationsV1;
  checks: LocaleChecksV1;
  previews: LocalePreviewsV1;
  reviews: LocaleReviewsV1;
  releases: Port;
  exchange: Port;
};
const templates = [
  { id: 'app-text', name: '应用文案', description: '固定源文、中文译文、占位符和术语。' },
  { id: 'error-messages', name: '错误消息', description: '缺失参数的译文会阻止接受和发布。' },
  { id: 'source-update', name: '源文更新', description: '源文修订变化后，旧译文保留并标为过期。' },
] as const;
export class LocaleWorkbench extends SuiteStore {
  constructor(
    meta: PluginMetadata,
    auth: SuiteAuthorize,
    private ports: WorkbenchPorts,
  ) {
    super(
      'locale-workbench',
      meta,
      auth,
      ports.catalogs,
      Object.fromEntries(Object.entries(ports).map(([id, port]) => ['locale-' + id, port])),
    );
  }
  async templates() {
    await this.access();
    return templates.map((template) => ({ ...template }));
  }
  async createExample(raw: { name: string; template: 'app-text' | 'error-messages' | 'source-update' }) {
    const p = z
        .object({ name: S.suiteName, template: z.enum(['app-text', 'error-messages', 'source-update']) })
        .strict()
        .parse(raw),
      workspace = await this.ports.catalogs.createWorkspace({ name: p.name }),
      s = { workspaceId: workspace.id };
    const source = await this.ports.catalogs.upload({
      ...s,
      name: 'en.json',
      text: JSON.stringify({
        'app.title': 'Workspace',
        'hello.user': 'Hello, {user}',
        'error.retry': 'Try again, {user}',
      }),
      allowExport: true,
    });
    const original = await this.ports.catalogs.importJson({
      ...s,
      source: ref(source),
      language: 'en',
      role: 'source',
    });
    const contexts = await this.ports.contexts.attach({
      ...s,
      catalog: ref(original),
      items: [
        { key: 'app.title', description: '导航标题', location: '主页面', maxGraphemes: 12, screenshot: null },
      ],
    });
    const terms = await this.ports.terminology.save({
      ...s,
      name: '应用中文术语',
      content: {
        language: 'zh-CN',
        domain: 'application',
        terms: [{ source: 'Workspace', target: '工作空间', forbidden: ['工作场所'] }],
      },
      references: [ref(original)],
    });
    await this.ports.terminology.seal({ ...s, id: terms.id, revision: terms.revision });
    let translation = await this.ports.translations.revise({
      ...s,
      name: '中文文案',
      catalog: ref(original),
      language: 'zh-CN',
      terminology: ref(terms),
      contexts: ref(contexts),
      items: [
        { key: 'app.title', text: '工作空间' },
        { key: 'hello.user', text: '你好，{user}' },
        { key: 'error.retry', text: p.template === 'error-messages' ? '请重试' : '请重试，{user}' },
      ],
    });
    let catalog = original;
    if (p.template === 'source-update') {
      const update = await this.ports.catalogs.upload({
        ...s,
        name: 'en-updated.json',
        text: JSON.stringify({
          'app.title': 'Workspace',
          'hello.user': 'Welcome back, {user}',
          'error.retry': 'Try again, {user}',
        }),
        allowExport: true,
      });
      catalog = await this.ports.catalogs.importJson({
        ...s,
        source: ref(update),
        language: 'en',
        role: 'source',
      });
      translation = await this.ports.translations.markStale({
        ...s,
        translation: ref(translation),
        catalog: ref(catalog),
      });
    }
    const example = await this.put(
      {
        ...s,
        name: '合成本地化样例',
        content: json({
          format: 'sakura-locale-example/1',
          template: p.template,
          catalog: ref(catalog),
          translation: ref(translation),
          terminology: ref(terms),
          contexts: p.template === 'source-update' ? null : ref(contexts),
          synthetic: true,
        }),
        references: [ref(catalog), ref(translation), ref(terms), ref(contexts)],
      },
      'result',
      true,
    );
    return { workspace, example };
  }
  async runChecks(
    raw: S.SuiteScope & {
      catalog: S.SuiteRef;
      translation: S.SuiteRef;
      width?: '320' | '768' | '1280';
      pseudo?: boolean;
    },
  ) {
    const p = L.localeCheckInput
      .extend({ width: z.enum(['320', '768', '1280']).default('320'), pseudo: z.boolean().default(false) })
      .strict()
      .parse(raw);
    const check = await this.ports.checks.evaluate({
        ...scope(p),
        catalog: p.catalog,
        translation: p.translation,
      }),
      preview = await this.ports.previews.render({
        ...scope(p),
        check: ref(check),
        width: p.width,
        pseudo: p.pseudo,
        offset: 0,
        limit: 100,
      }),
      review = await this.ports.reviews.open({ ...scope(p), check: ref(check), preview: ref(preview) });
    const run = await this.put(
      {
        ...scope(p),
        name: '文案检查步骤',
        content: json({
          catalog: p.catalog,
          translation: p.translation,
          check: ref(check),
          preview: ref(preview),
          review: ref(review),
          completed: true,
          approved: false,
        }),
        references: [p.catalog, p.translation, ref(check), ref(preview), ref(review)],
      },
      'result',
      true,
    );
    return { run, check, preview, review };
  }
  async view(raw: { workspaceId?: string }) {
    const p = z.object({ workspaceId: S.suiteId.optional() }).strict().parse(raw),
      workspaces = await this.ports.catalogs.listWorkspaces();
    if (!p.workspaceId) return { workspaces, workspace: null, capacity: null, domains: [] };
    const s = { workspaceId: p.workspaceId },
      workspace = await this.ports.catalogs.workspace(s),
      domains: { id: string; records: S.SuiteRecord[]; error: string | null }[] = [];
    for (const [id, port] of Object.entries(this.ports)) {
      try {
        domains.push({ id, records: (await port.list({ ...s, limit: 10 })).items, error: null });
      } catch (error) {
        domains.push({ id, records: [], error: error instanceof Error ? error.message : '领域读取失败' });
      }
    }
    return { workspaces, workspace, capacity: await this.ports.catalogs.capacity(s), domains };
  }
}

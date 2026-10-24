/** 本地化交接的独立核验工具；复算内容，不承认外来的人工批准。 */
import * as L from '../shared/contracts/locale-studio.ts';
import * as S from '../shared/contracts/suite-common.ts';
import { verifySuiteGraph, offlineKey, offlineHash, offlineSha } from './suite-offline.ts';
import {
  parseLocaleCatalog,
  evaluateLocale,
  renderLocale,
  buildLocaleFile,
  verifyLocalePatch,
} from './suite-locale-analysis.ts';
const domains = [
  'catalogs',
  'contexts',
  'terminology',
  'translations',
  'checks',
  'previews',
  'reviews',
  'releases',
].map((domain) => 'locale-' + domain);
export { verifyLocalePatch };
export function verifyLocaleBundle(bytes: Uint8Array) {
  const graph = verifySuiteGraph(bytes, 'sakura-localization-studio/1', domains, 'locale-catalogs');
  const recomputed: { reference: S.SuiteRef; check: string; equal: boolean }[] = [];
  const check = (row: S.SuiteRecord, name: string, value: unknown) => {
    const equal = offlineHash(row.content) === offlineHash(value);
    recomputed.push({
      reference: { domain: row.domain, id: row.id, revision: row.revision },
      check: name,
      equal,
    });
    if (!equal) throw new Error('LOCALE_VERIFY_RECOMPUTATION:' + offlineKey(row));
  };
  for (const row of graph.rows) {
    const catalog = L.localeCatalog.safeParse(row.content);
    if (row.domain === 'locale-catalogs' && catalog.success) {
      const source = graph.get(catalog.data.source, row),
        material = graph.materials.get(offlineKey(source));
      if (!material) throw new Error('LOCALE_VERIFY_CATALOG_SOURCE');
      check(
        row,
        'locale-catalog/1',
        parseLocaleCatalog({
          source: catalog.data.source,
          language: catalog.data.language,
          role: catalog.data.role,
          text: new TextDecoder('utf-8', { fatal: true }).decode(material),
          originalDigest: offlineSha(material),
          originalBytes: material.length,
        }),
      );
    } else if (row.domain === 'locale-checks' && L.localeCheck.safeParse(row.content).success) {
      const content = L.localeCheck.parse(row.content),
        catalog = L.localeCatalog.parse(graph.get(content.catalog, row).content),
        translation = L.localeTranslation.parse(graph.get(content.translation, row).content);
      const terminology = L.localeTerminology.parse(graph.get(content.terminology, row).content),
        contexts = content.contexts ? L.localeContexts.parse(graph.get(content.contexts, row).content) : null;
      check(
        row,
        'locale-checks/1',
        evaluateLocale({
          catalog,
          translation,
          terminology,
          contexts,
          references: { catalog: content.catalog, translation: content.translation },
        }),
      );
    } else if (row.domain === 'locale-previews' && L.localePreview.safeParse(row.content).success) {
      const content = L.localePreview.parse(row.content),
        checks = L.localeCheck.parse(graph.get(content.check, row).content),
        catalog = L.localeCatalog.parse(graph.get(content.catalog, row).content),
        translation = L.localeTranslation.parse(graph.get(content.translation, row).content);
      check(
        row,
        'locale-fixed-preview/1',
        renderLocale({
          preview: {
            workspaceId: row.workspaceId,
            check: content.check,
            width: content.width,
            pseudo: content.pseudo,
            offset: content.offset,
            limit: content.items.length || 1,
          },
          check: checks,
          catalog,
          translation,
        }),
      );
    } else if (row.domain === 'locale-releases' && L.localeRelease.safeParse(row.content).success) {
      const release = L.localeRelease.parse(row.content),
        catalog = L.localeCatalog.parse(graph.get(release.catalog, row).content);
      const files = [buildLocaleFile(catalog.language, catalog.entries, catalog.sourceDigest)],
        languages = new Set([catalog.language]);
      for (const reference of release.translations) {
        const translationRow = graph.get(reference, row),
          translation = L.localeTranslation.parse(translationRow.content),
          map = new Map(translation.items.map((item) => [item.key, item])),
          fallbackKeys: string[] = [];
        if (
          languages.has(translation.language) ||
          offlineKey(translation.catalog) !== offlineKey(release.catalog)
        )
          throw new Error('LOCALE_VERIFY_RELEASE_LANGUAGE');
        languages.add(translation.language);
        const entries = catalog.entries.map((entry) => {
          const item = map.get(entry.key);
          if (!item?.text.trim()) {
            if (release.fallback !== 'source') throw new Error('LOCALE_VERIFY_MISSING');
            fallbackKeys.push(entry.key);
            return { key: entry.key, text: entry.text };
          }
          if (item.stale || item.sourceDigest !== entry.digest) throw new Error('LOCALE_VERIFY_STALE');
          return { key: entry.key, text: item.text };
        });
        let originalDigest: string | null = null;
        for (const dependency of translationRow.references.filter(
          (ref) => ref.domain === 'locale-catalogs' && offlineKey(ref) !== offlineKey(release.catalog),
        )) {
          const original = L.localeCatalog.safeParse(graph.get(dependency, translationRow).content);
          if (
            original.success &&
            original.data.role === 'target' &&
            original.data.language === translation.language
          )
            originalDigest = original.data.sourceDigest;
        }
        files.push(buildLocaleFile(translation.language, entries, originalDigest, fallbackKeys));
      }
      if (offlineHash(files) !== offlineHash(release.files)) throw new Error('LOCALE_VERIFY_RELEASE_FILES');
      recomputed.push({
        reference: { domain: row.domain, id: row.id, revision: row.revision },
        check: 'locale-language-files/1',
        equal: true,
      });
    } else if (
      row.domain === 'locale-releases' &&
      row.content &&
      typeof row.content === 'object' &&
      !Array.isArray(row.content) &&
      row.content.format === 'sakura-locale-patch/1'
    ) {
      const patch = row.content as {
          release: S.SuiteRef;
          files: {
            path: string;
            text: string;
            bytes: number;
            digest: string;
            expectedDigest: string | null;
            operation: string;
          }[];
        },
        release = L.localeRelease.parse(graph.get(patch.release, row).content);
      if (
        patch.files.length !== release.files.length ||
        patch.files.some(
          (file, index) =>
            file.path !== release.files[index].path ||
            file.text !== release.files[index].text ||
            file.bytes !== Buffer.byteLength(file.text) ||
            file.digest !== offlineSha(file.text) ||
            file.expectedDigest !== release.files[index].originalDigest ||
            file.operation !== (file.expectedDigest ? 'replace' : 'create'),
        )
      )
        throw new Error('LOCALE_VERIFY_PATCH');
      recomputed.push({
        reference: { domain: row.domain, id: row.id, revision: row.revision },
        check: 'locale-patch-manifest/1',
        equal: true,
      });
    }
  }
  return {
    format: 'sakura-localization-studio/1',
    byteIntegrity: 'verified',
    sourceAuthentication: 'unauthenticated',
    objects: graph.rows.length,
    materials: graph.materials.size,
    manifestDigest: graph.manifestDigest,
    recomputed,
    notRecomputed: [
      '人工审阅和用途批准',
      '当前来源许可',
      '目标应用的字体、布局和交互',
      '原项目的当前文件摘要；应用补丁前须另行核对',
    ],
  };
}

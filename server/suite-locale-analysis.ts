/** 只处理固定输入的本地化计算；不执行模板、HTML、脚本或外部资源。 */
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import * as L from '../shared/contracts/locale-studio.ts';
import * as S from '../shared/contracts/suite-common.ts';
import { parseSuiteJson } from '../shared/suite-json.ts';
import { AppError } from '../shared/errors.ts';
function localeFail(code: string): never {
  throw new AppError('本地化材料不受支持或超出限制：' + code, 400, code);
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const encoder = new TextEncoder();
export function canonicalLocaleLanguage(raw: string): string {
  const input = L.localeLanguage.parse(raw);
  let language: string;
  try {
    language = new Intl.Locale(input).toString();
  } catch {
    return localeFail('LOCALE_LANGUAGE');
  }
  return L.localeLanguage.parse(language);
}
export function localePlaceholders(text: string): z.infer<typeof L.localeEntry>['placeholders'] {
  if (encoder.encode(text).length > 16384) localeFail('LOCALE_VALUE_BYTES');
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))
    localeFail('LOCALE_UNICODE');
  if (/<\/?[a-z][^>]*>/i.test(text)) localeFail('LOCALE_HTML_UNSUPPORTED');
  const placeholders = new Map<string, number>();
  const remainder = text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, name: string) => {
    placeholders.set(name, (placeholders.get(name) ?? 0) + 1);
    return '';
  });
  if (/[{}]/.test(remainder)) localeFail('LOCALE_EXPRESSION_UNSUPPORTED');
  return [...placeholders].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
}
export function parseLocaleCatalog(input: {
  text: string;
  language: string;
  role: 'source' | 'target';
  source: S.SuiteRef;
  originalDigest?: string;
  originalBytes?: number;
}): z.infer<typeof L.localeCatalog> {
  const bytes = encoder.encode(input.text).length;
  if (bytes > 32 * 1024 ** 2) localeFail('LOCALE_INPUT_BYTES');
  const value = parseSuiteJson(input.text, 32 * 1024 ** 2);
  if (!value || typeof value !== 'object' || Array.isArray(value)) localeFail('LOCALE_STRING_MAP_REQUIRED');
  const entries = Object.entries(value);
  if (entries.length > 50000) localeFail('LOCALE_KEY_LIMIT');
  return L.localeCatalog.parse({
    format: 'sakura-locale-catalog/1',
    language: canonicalLocaleLanguage(input.language),
    role: input.role,
    source: input.source,
    sourceDigest: input.originalDigest ?? digest(input.text),
    bytes: input.originalBytes ?? bytes,
    entries: entries
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, text]) => {
        L.localeKey.parse(key);
        if (key !== key.normalize('NFC') || typeof text !== 'string')
          localeFail('LOCALE_STRING_MAP_REQUIRED');
        return { key, text, digest: digest(text), placeholders: localePlaceholders(text) };
      }),
  });
}
export function localeGraphemes(text: string): number {
  let count = 0;
  for (const _segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count++;
  return count;
}
export function validateLocaleTerms(raw: unknown): { valid: boolean; conflicts: string[] } {
  const terms = L.localeTerminology.parse(raw),
    seen = new Map<string, string>(),
    conflicts: string[] = [];
  for (const term of terms.terms) {
    const key = term.source.normalize('NFC');
    if (seen.has(key)) conflicts.push(`重复术语：${term.source}`);
    if (term.forbidden.includes(term.target)) conflicts.push(`目标术语同时列入禁用词：${term.source}`);
    seen.set(key, term.target);
  }
  return { valid: conflicts.length === 0, conflicts };
}
export function evaluateLocale(input: {
  catalog: z.infer<typeof L.localeCatalog>;
  translation: z.infer<typeof L.localeTranslation>;
  terminology: z.infer<typeof L.localeTerminology>;
  contexts: z.infer<typeof L.localeContexts> | null;
  references: { catalog: S.SuiteRef; translation: S.SuiteRef };
}): z.infer<typeof L.localeCheck> {
  const { catalog, translation, terminology, contexts, references } = input;
  const translated = new Map(translation.items.map((item) => [item.key, item]));
  const contextual = new Map(contexts?.items.map((item) => [item.key, item]) ?? []);
  const findings: z.infer<typeof L.localeFinding>[] = [];
  const finding = (
    key: string,
    code: z.infer<typeof L.localeFinding>['code'],
    message: string,
    severity: 'error' | 'warning' = 'error',
  ) => {
    if (findings.length >= 100000) localeFail('LOCALE_FINDING_LIMIT');
    findings.push({ id: digest(JSON.stringify([key, code, message])), key, code, severity, message });
  };
  for (const source of catalog.entries) {
    const item = translated.get(source.key);
    if (!item || !item.text.trim()) {
      finding(source.key, 'missing', '没有目标译文；发布时须拒绝缺项或明确回退源文');
      continue;
    }
    if (item.sourceDigest !== source.digest || item.stale)
      finding(source.key, 'stale', '译文对应的源文已经变化');
    if (JSON.stringify(source.placeholders) !== JSON.stringify(localePlaceholders(item.text)))
      finding(source.key, 'placeholder', '占位符名称或出现次数不同');
    for (const term of terminology.terms) {
      if (source.text.includes(term.source) && !item.text.includes(term.target))
        finding(source.key, 'term', `应使用术语：${term.target}`);
      for (const forbidden of term.forbidden)
        if (item.text.includes(forbidden)) finding(source.key, 'forbidden', `包含禁用词：${forbidden}`);
    }
    const max = contextual.get(source.key)?.maxGraphemes;
    if (max !== null && max !== undefined && localeGraphemes(item.text) > max)
      finding(source.key, 'length', `超过建议的 ${max} 个用户感知字符`, 'warning');
  }
  return L.localeCheck.parse({
    format: 'sakura-locale-check/1',
    ...references,
    terminology: translation.terminology,
    contexts: translation.contexts,
    language: translation.language,
    total: catalog.entries.length,
    translated: catalog.entries.filter((entry) => translated.get(entry.key)?.text.trim()).length,
    findings,
    result: findings.some((f) => f.severity === 'error') ? 'failed' : 'passed',
    measurement: 'unicode-graphemes',
  });
}
export function pseudolocalize(text: string): string {
  const accent: Record<string, string> = {
    a: 'á',
    e: 'ë',
    i: 'ï',
    o: 'ö',
    u: 'ü',
    A: 'Á',
    E: 'Ë',
    I: 'Ï',
    O: 'Ö',
    U: 'Ü',
  };
  const parts = text.split(/(\{[A-Za-z_][A-Za-z0-9_]*\})/g);
  return (
    '［' +
    parts
      .map((part) =>
        /^\{/.test(part)
          ? part
          : part.replace(/[aeiouAEIOU]/g, (letter) => accent[letter]) +
            '·'.repeat(Math.ceil(localeGraphemes(part) * 0.3)),
      )
      .join('') +
    '］'
  );
}
export function renderLocale(input: {
  preview: z.infer<typeof L.localePreviewInput>;
  check: z.infer<typeof L.localeCheck>;
  catalog: z.infer<typeof L.localeCatalog>;
  translation: z.infer<typeof L.localeTranslation>;
}): z.infer<typeof L.localePreview> {
  const { preview, check, catalog, translation } = input;
  const translated = new Map(translation.items.map((item) => [item.key, item.text]));
  return L.localePreview.parse({
    format: 'sakura-locale-preview/1',
    check: preview.check,
    catalog: check.catalog,
    translation: check.translation,
    language: translation.language,
    direction: /^(ar|fa|he|ur|ps|dv)(-|$)/i.test(translation.language) ? 'rtl' : 'ltr',
    width: preview.width,
    pseudo: preview.pseudo,
    measurement: 'estimate',
    total: catalog.entries.length,
    offset: preview.offset,
    items: catalog.entries.slice(preview.offset, preview.offset + preview.limit).map((entry) => {
      const text = preview.pseudo ? pseudolocalize(entry.text) : translated.get(entry.key) || entry.text;
      const graphemes = localeGraphemes(text);
      return {
        key: entry.key,
        source: entry.text,
        text,
        graphemes,
        estimatedLines: Math.max(1, Math.ceil((graphemes * 10) / (Number(preview.width) - 64))),
      };
    }),
  });
}
export function buildLocaleFile(
  language: string,
  entries: { key: string; text: string }[],
  originalDigest: string | null,
  fallbackKeys: string[] = [],
): z.infer<typeof L.localeReleaseFile> {
  const canonicalLanguage = canonicalLocaleLanguage(language);
  const text =
    JSON.stringify(Object.fromEntries(entries.map((item) => [item.key, item.text])), null, 2) + '\n';
  const bytes = encoder.encode(text).length;
  if (bytes > 2 * 1024 ** 2) localeFail('LOCALE_RELEASE_FILE_LIMIT');
  return L.localeReleaseFile.parse({
    path: canonicalLanguage + '.json',
    language: canonicalLanguage,
    text,
    bytes,
    digest: digest(text),
    originalDigest,
    fallbackKeys,
  });
}
export function verifyLocalePatch(input: {
  base: string | null;
  expectedDigest: string | null;
  text: string;
  digest: string;
}): { valid: boolean; conflict: boolean } {
  if (
    encoder.encode(input.text).length > 2 * 1024 ** 2 ||
    (input.base && encoder.encode(input.base).length > 32 * 1024 ** 2)
  )
    localeFail('LOCALE_PATCH_LIMIT');
  const conflict =
    input.expectedDigest === null
      ? input.base !== null
      : input.base === null || digest(input.base) !== input.expectedDigest;
  return { valid: !conflict && digest(input.text) === input.digest, conflict };
}

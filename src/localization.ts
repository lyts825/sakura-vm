export type LocalePreferences = {
  language: 'zh-CN' | 'zh-TW';
  timeZone: string;
  numberLocale: 'zh-CN' | 'en-US' | 'de-DE';
};
const storageKey = 'sakura-locale';
const ignored = 'pre, code, script, style, textarea, [contenteditable], [data-locale-ignore], .cm-editor, .xterm';

function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
export function validTimeZone(value: string) {
  if (value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
  catch { return false; }
}
export function readLocalePreferences(): LocalePreferences {
  const fallback: LocalePreferences = { language: 'zh-CN', timeZone: browserTimeZone(), numberLocale: 'zh-CN' };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      language: saved.language === 'zh-TW' ? 'zh-TW' : 'zh-CN',
      timeZone: typeof saved.timeZone === 'string' && validTimeZone(saved.timeZone)
        ? saved.timeZone : fallback.timeZone,
      numberLocale: saved.numberLocale === 'en-US' || saved.numberLocale === 'de-DE'
        ? saved.numberLocale : 'zh-CN',
    };
  } catch { return fallback; }
}
export function saveLocalePreferences(value: LocalePreferences) {
  if (!['zh-CN', 'zh-TW'].includes(value.language) ||
      !['zh-CN', 'en-US', 'de-DE'].includes(value.numberLocale) || !validTimeZone(value.timeZone))
    throw new Error('语言或区域格式无效');
  localStorage.setItem(storageKey, JSON.stringify(value));
}
export function formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}) {
  const preferences = readLocalePreferences();
  return new Date(value).toLocaleString(preferences.language, { ...options, timeZone: preferences.timeZone });
}
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(readLocalePreferences().numberLocale, options).format(value);
}
export function formatDecimal(value: number, digits: number) {
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function timeZoneOptions() {
  const current = readLocalePreferences().timeZone;
  const available = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['UTC', current, ...available])].sort();
}

/** Converts known UI phrases while leaving editors, terminal output and marked names untouched. */
export async function installLanguagePack(root: HTMLElement) {
  const language = readLocalePreferences().language;
  document.documentElement.lang = language;
  if (language !== 'zh-TW') return () => {};
  const [{ default: pack }, { default: fragments }] = await Promise.all([
    import('./locales/zh-TW.json'), import('./locales/zh-TW-fragments.json'),
  ]);
  const dictionary = pack as Record<string, string>;
  const dynamic = fragments as { prefix: [string, string][]; suffix: [string, string][] };
  const lastText = new WeakMap<Text, string>();
  const lastAttribute = new WeakMap<Element, Map<string, string>>();
  const translate = (source: string) => {
    const trimmed = source.trim();
    const translated = dictionary[trimmed];
    if (translated && translated !== trimmed) return source.replace(trimmed, translated);
    let result = source;
    for (const [before, after] of dynamic.prefix)
      if (result.startsWith(before)) { result = after + result.slice(before.length); break; }
    for (const [before, after] of dynamic.suffix)
      if (result.endsWith(before)) { result = result.slice(0, -before.length) + after; break; }
    return result;
  };
  const excluded = (element: Element | null) => !!element?.closest(ignored);
  const updateText = (node: Text) => {
    if (excluded(node.parentElement) || node.data === lastText.get(node)) return;
    const translated = translate(node.data);
    if (translated !== node.data) { lastText.set(node, translated); node.data = translated; }
  };
  const updateElement = (element: Element) => {
    if (excluded(element)) return;
    let last = lastAttribute.get(element);
    if (!last) { last = new Map(); lastAttribute.set(element, last); }
    for (const attribute of ['aria-label', 'placeholder', 'title', 'alt']) {
      const current = element.getAttribute(attribute);
      if (!current || current === last.get(attribute)) continue;
      const translated = translate(current);
      if (translated !== current) { last.set(attribute, translated); element.setAttribute(attribute, translated); }
    }
  };
  const updateTree = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { updateText(node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (excluded(element)) return;
    updateElement(element);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.nodeType === Node.TEXT_NODE) updateText(walker.currentNode as Text);
      else updateElement(walker.currentNode as Element);
    }
  };
  updateTree(root);
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === 'characterData') updateText(change.target as Text);
      else if (change.type === 'attributes') updateElement(change.target as Element);
      else for (const node of change.addedNodes) updateTree(node);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title', 'alt'] });
  return () => observer.disconnect();
}

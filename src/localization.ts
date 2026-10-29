/**
 * 模块职责（中文）：管理语言和区域偏好、日期/数字格式与语言包 DOM 替换，保留不应翻译的输入和代码内容。
 * Module responsibility (English): Managing locale preferences and DOM language replacement while protecting editor content.
 * 详细范围（中文）：公开入口包括 LocalePreferences, validTimeZone, readLocalePreferences, saveLocalePreferences, formatDateTime, formatNumber, formatDecimal, timeZoneOptions, installLanguagePack；职责覆盖管理区域偏好与 DOM 语言包替换并保护编辑器内容，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include LocalePreferences, validTimeZone, readLocalePreferences, saveLocalePreferences, formatDateTime, formatNumber, formatDecimal, timeZoneOptions, installLanguagePack. The scope covers Managing locale preferences and DOM language replacement while protecting editor content. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export type LocalePreferences = {
  language: 'zh-CN' | 'zh-TW';
  timeZone: string;
  numberLocale: 'zh-CN' | 'en-US' | 'de-DE';
};
const storageKey = 'sakura-locale';
const ignored = 'pre, code, script, style, textarea, [contenteditable], [data-locale-ignore], .cm-editor, .xterm';
const defaultFormatOptions = Object.freeze({});
const timeZoneValidity = new Map<string, boolean>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** 中文：只缓存固定字符串键，最多保留 32 项；构造失败不写入。 English: Cache fixed string keys with at most 32 entries; failed construction is never stored. */
function cached<T>(cache: Map<string, T>, key: string, create: () => T): T {
  if (cache.has(key)) return cache.get(key)!;
  const value = create();
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

/**
 * 中文：读取浏览器解析出的 IANA 时区，Intl 不可用或失败时回退 UTC。
 * English: Read the browser-resolved IANA time zone, falling back to UTC if Intl is unavailable/fails.
 */
function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
}
/**
 * 中文：先限制时区文本长度与字符，再由 Intl 尝试构造校验；不支持的时区返回 false。
 * English: Bound time-zone length/characters then validate by constructing Intl; unsupported zones return false.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
export function validTimeZone(value: string) {
  if (value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  const validate = () => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
    catch { return false; }
  };
  return typeof value === 'string' ? cached(timeZoneValidity, value, validate) : validate();
}
/**
 * 中文：从存储恢复受支持语言、时区和数字区域，各字段独立回退；存储或 JSON 故障使用浏览器时区和默认中文。
 * English: Restore supported language/time-zone/number locale with independent field fallbacks; storage/JSON failure uses browser time zone and default Chinese.
 * 中文：结果：包含 language、timeZone、numberLocale 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing language, timeZone, numberLocale for caller state reads/operations
 */
export function readLocalePreferences(): LocalePreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return {
      language: saved.language === 'zh-TW' ? 'zh-TW' : 'zh-CN',
      timeZone: typeof saved.timeZone === 'string' && validTimeZone(saved.timeZone)
        ? saved.timeZone : browserTimeZone(),
      numberLocale: saved.numberLocale === 'en-US' || saved.numberLocale === 'de-DE'
        ? saved.numberLocale : 'zh-CN',
    };
  } catch { return { language: 'zh-CN', timeZone: browserTimeZone(), numberLocale: 'zh-CN' }; }
}
/**
 * 中文：验证全部区域偏好后一次持久化；不支持语言、格式或时区抛错供设置页显示。
 * English: Validate all locale preferences before one persistence write; unsupported language/format/zone throws for settings feedback.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 * 中文：拒绝原因：语言或区域格式无效。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 语言或区域格式无效. These errors reach the direct caller or this function's catch handler
 */
export function saveLocalePreferences(value: LocalePreferences) {
  if (!['zh-CN', 'zh-TW'].includes(value.language) ||
      !['zh-CN', 'en-US', 'de-DE'].includes(value.numberLocale) || !validTimeZone(value.timeZone))
    throw new Error('语言或区域格式无效');
  localStorage.setItem(storageKey, JSON.stringify(value));
}
/**
 * 中文：把日期值按当前语言和时区格式化，调用者其他显示选项保留，偏好时区具有最终优先级。
 * English: Format dates using current language/time zone, retaining caller presentation options with the preferred zone taking final precedence.
 * 中文：输入：value：待校验、转换或保存的输入值；options：本次连接、传输或显示配置（缺省 {}）
 * English: Inputs: value: input value to validate/transform/save; options: connection/transport/presentation configuration (default {})
 */
export function formatDateTime(value: Date | string | number, options: Intl.DateTimeFormatOptions = defaultFormatOptions) {
  const preferences = readLocalePreferences();
  const date = new Date(value);
  // 中文：仅复用未传选项的格式；显式选项及无效日期沿用原生路径，保留 getter、默认值和错误语义。
  // English: Reuse only omitted options; explicit options and invalid dates retain native getter/default/error semantics.
  if (options !== defaultFormatOptions || Number.isNaN(date.getTime()))
    return date.toLocaleString(preferences.language, { ...options, timeZone: preferences.timeZone });
  return cached(dateFormats, `${preferences.language}:${preferences.timeZone}`, () => new Intl.DateTimeFormat(
    preferences.language, { timeZone: preferences.timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric' },
  )).format(date.getTime());
}
/**
 * 中文：按当前数字区域及调用者精度/单位选项格式化数值。
 * English: Format numbers with the current number locale and caller precision/unit options.
 * 中文：输入：value：待校验、转换或保存的输入值；options：本次连接、传输或显示配置（缺省 {}）
 * English: Inputs: value: input value to validate/transform/save; options: connection/transport/presentation configuration (default {})
 */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = defaultFormatOptions) {
  const locale = readLocalePreferences().numberLocale;
  const formatter = options === defaultFormatOptions
    ? cached(numberFormats, locale, () => new Intl.NumberFormat(locale))
    : new Intl.NumberFormat(locale, options);
  return formatter.format(value);
}
/**
 * 中文：复用固定小数位数的区域格式；其他精度值交给原生转换，保留小数点与分组规则。
 * English: Reuse fixed-precision regional formats and retain native coercion for other precision values, preserving decimal/grouping rules.
 * 中文：输入：value：待校验、转换或保存的输入值；digits：签名所示 number 业务值
 * English: Inputs: value: input value to validate/transform/save; digits: the number domain value in the signature
 */
export function formatDecimal(value: number, digits: number) {
  // 中文：缓存调用方不能修改的固定精度选项；其余值继续由 Intl 按原规则转换或拒绝。
  // English: Cache private fixed-precision options; Intl continues coercing or rejecting all other values.
  if (Number.isInteger(digits) && digits >= 0 && digits <= 20) {
    const locale = readLocalePreferences().numberLocale;
    return cached(numberFormats, `${locale}:${digits}`, () => new Intl.NumberFormat(locale,
      { minimumFractionDigits: digits, maximumFractionDigits: digits })).format(value);
  }
  return formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/**
 * 中文：合并 UTC、当前选择与 Intl 支持的时区，去重排序；旧浏览器仍保留当前选择。
 * English: Deduplicate/sort UTC, current selection and Intl-supported zones, retaining the current selection on older browsers.
 */
export function timeZoneOptions() {
  const current = readLocalePreferences().timeZone;
  const available = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set(['UTC', current, ...available])].sort();
}

/** Converts known UI phrases while leaving editors, terminal output and marked names untouched. */
/**
 * 中文：按偏好设置文档语言，繁体时懒加载完整/动态词条并观察 DOM 变化；弱引用记录已译值防止循环，排除编辑器、代码和用户输入，返回 observer 清理。
 * English: Set document language and lazily load full/dynamic translations for traditional Chinese, observing DOM changes. Weak references track translated values to prevent loops, exclude editors/code/user input and return observer cleanup.
 * 中文：输入：root：需要挂载或观察的 DOM 根
 * English: Inputs: root: DOM root to mount/observe
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 * 中文：设计：等待期间身份或版本可能改变，完成后按捕获代次比较再采用结果，避免旧上下文覆盖新状态
 * English: Design: identity/version may change while awaiting; compare captured generations before adopting completion to avoid old context replacing new state
 */
export async function installLanguagePack(root: HTMLElement) {
  const language = readLocalePreferences().language;
  document.documentElement.lang = language;
  if (language !== 'zh-TW') return () => {};
  const [{ default: pack }, { default: fragments }] = await Promise.all([
    import('./locales/zh-TW.json'), import('./locales/zh-TW-fragments.json'),
  ]);
  const dictionary = pack as Record<string, string>;
  const dynamic = fragments as { prefix: [string, string][]; suffix: [string, string][] };
  // 记录本模块刚写入的译文，MutationObserver 再看到同一值时跳过，避免由翻译自身触发循环。
  const lastText = new WeakMap<Text, string>();
  const lastAttribute = new WeakMap<Element, Map<string, string>>();
  /**
   * 中文：先按去空白后的完整词条替换，未命中时最多应用一个前缀和一个后缀规则，保留文本原有外侧空白。
   * English: Try the trimmed full-text dictionary first; otherwise apply at most one prefix and one suffix rule, retaining surrounding whitespace.
   * 中文：输入：source：输入内容或捕获画面
   * English: Inputs: source: source content/captured frame
   */
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
  /**
   * 中文：检查元素或祖先是否属于禁止翻译区域，保护代码、终端和用户内容。
   * English: Check whether an element/ancestor belongs to excluded regions, protecting code/terminals/user content.
   * 中文：输入：element：当前检查或更新的元素
   * English: Inputs: element: element being checked/updated
   */
  const excluded = (element: Element | null) => !!element?.closest(ignored);
  /**
   * 中文：跳过排除区域和已记录译文，仅在译文不同才修改 Text 并登记，避免 observer 自触发循环。
   * English: Skip excluded regions/already-recorded translations; change and record Text only when different to avoid observer feedback loops.
   * 中文：输入：node：需要遍历或更新的 DOM 节点
   * English: Inputs: node: DOM node to traverse/update
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const updateText = (node: Text) => {
    if (excluded(node.parentElement) || node.data === lastText.get(node)) return;
    const translated = translate(node.data);
    if (translated !== node.data) { lastText.set(node, translated); node.data = translated; }
  };
  /**
   * 中文：仅翻译 aria-label、placeholder、title 和 alt，按元素/属性记录已译值，不改控件实际值。
   * English: Translate only aria-label/placeholder/title/alt, recording values by element/attribute without changing control values.
   * 中文：输入：element：当前检查或更新的元素
   * English: Inputs: element: element being checked/updated
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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
  /**
   * 中文：对单文本节点直接更新，对允许元素用 TreeWalker 遍历元素和文本；非元素/文本及排除区域跳过。
   * English: Update individual text nodes directly and traverse allowed elements/text with TreeWalker, skipping other node kinds/excluded regions.
   * 中文：输入：node：需要遍历或更新的 DOM 节点
   * English: Inputs: node: DOM node to traverse/update
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
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

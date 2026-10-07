/**
 * 模块职责（中文）：定义工作区快捷键、上下文和保留键校验，保存用户映射并规范化键盘事件。
 * Module responsibility (English): Normalizing keys, validating conflicts and persisting shortcuts per workspace.
 * 详细范围（中文）：公开入口包括 shortcutCommands, ShortcutId, ShortcutMap, ShortcutPreferences, normalizeShortcut, shortcutContext, effectiveShortcuts, validateShortcuts, readShortcuts, saveShortcuts, watchShortcuts, eventShortcut, shortcutInputTarget；职责覆盖规范化按键、校验冲突并按工作区保存快捷键，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include shortcutCommands, ShortcutId, ShortcutMap, ShortcutPreferences, normalizeShortcut, shortcutContext, effectiveShortcuts, validateShortcuts, readShortcuts, saveShortcuts, watchShortcuts, eventShortcut, shortcutInputTarget. The scope covers Normalizing keys, validating conflicts and persisting shortcuts per workspace. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
export const shortcutCommands = [
  { id: 'palette', name: '命令面板', defaultKey: 'Mod+K' },
  { id: 'search', name: '筛选实例', defaultKey: '/' },
  { id: 'workspace', name: '工作空间', defaultKey: '' },
  { id: 'terminal', name: '当前实例终端', defaultKey: '' },
  { id: 'files', name: '当前实例文件', defaultKey: '' },
  { id: 'project', name: '当前项目', defaultKey: '' },
  { id: 'tasks', name: '后台任务', defaultKey: '' },
  { id: 'settings', name: '系统设置', defaultKey: '' },
  { id: 'theme', name: '切换主题', defaultKey: '' },
  { id: 'focus', name: '切换专注模式', defaultKey: '' },
] as const;
export type ShortcutId = (typeof shortcutCommands)[number]['id'];
export type ShortcutMap = Partial<Record<ShortcutId, string>>;
export type ShortcutPreferences = { version: 1; global: ShortcutMap; projects: Record<string, ShortcutMap> };
const storageKey = 'sakura-shortcuts-v1';
const changed = 'sakura-shortcuts-changed';
const ids = new Set<string>(shortcutCommands.map((command) => command.id));
const defaults = Object.fromEntries(
  shortcutCommands.map((command) => [command.id, command.defaultKey]),
) as Record<ShortcutId, string>;
const reserved = new Set([
  'Mod+A',
  'Mod+C',
  'Mod+V',
  'Mod+X',
  'Mod+Z',
  'Mod+Y',
  'Mod+S',
  'Mod+F',
  'Mod+H',
  'Mod+J',
  'Mod+L',
  'Mod+N',
  'Mod+O',
  'Mod+P',
  'Mod+R',
  'Mod+T',
  'Mod+W',
  'Mod+U',
  'Mod+Shift+N',
  'Mod+Shift+T',
  'Mod+Shift+W',
  'Mod+Shift+R',
  'Mod+Shift+I',
  'Mod+Shift+J',
  'Mod+Shift+C',
  'Mod+Shift+V',
  'Mod+Shift+Z',
]);

/**
 * 中文：统一 Ctrl/Cmd 等别名为 Mod 并规范顺序，允许空值和单独斜杠；拒绝重复修饰键、无效组合及浏览器/编辑器保留键。
 * English: Normalize Ctrl/Cmd aliases to Mod/order, allow empty/slash-only bindings and reject duplicate modifiers, invalid combinations and reserved browser/editor keys.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 * 中文：拒绝原因：使用 Mod+字母/数字，可加 Shift；单键仅支持 /。；此组合保留给浏览器或标准编辑操作，请选择其他按键。。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 使用 Mod+字母/数字，可加 Shift；单键仅支持 /。; 此组合保留给浏览器或标准编辑操作，请选择其他按键。. These errors reach the direct caller or this function's catch handler
 */
export function normalizeShortcut(value: string) {
  const text = value.trim();
  if (!text || text === '/') return text;
  const parts = text.toLowerCase().replaceAll(/\s/g, '').split('+');
  const key = parts.pop()!;
  const modifiers = parts.map((part) =>
    ['ctrl', 'control', 'cmd', 'meta', 'command'].includes(part) ? 'mod' : part,
  );
  if (
    !/^[a-z0-9/]$/.test(key) ||
    !modifiers.includes('mod') ||
    modifiers.some((part) => !['mod', 'shift'].includes(part)) ||
    new Set(modifiers).size !== modifiers.length
  )
    throw new Error('使用 Mod+字母/数字，可加 Shift；单键仅支持 /。');
  const normalized = 'Mod+' + (modifiers.includes('shift') ? 'Shift+' : '') + key.toUpperCase();
  if (reserved.has(normalized) || /^Mod\+(?:Shift\+)?[0-9]$/.test(normalized))
    throw new Error('此组合保留给浏览器或标准编辑操作，请选择其他按键。');
  return normalized;
}

/**
 * 中文：仅同时具备实例与项目时生成 JSON 作用域键，否则使用全局快捷键。
 * English: Build a JSON scope key only when both VM/project are present; otherwise use global shortcuts.
 * 中文：输入：vmId：当前实例标识；projectId：当前项目标识
 * English: Inputs: vmId: current VM identifier; projectId: current project identifier
 */
export function shortcutContext(vmId?: string, projectId?: string) {
  return vmId && projectId ? JSON.stringify([vmId, projectId]) : undefined;
}
/**
 * 中文：按内置默认、全局配置、项目配置顺序覆盖，返回当前作用域完整映射。
 * English: Overlay builtin defaults, global settings and project settings in that order to return a complete current-scope map.
 * 中文：输入：preferences：签名所示 ShortcutPreferences 业务值；context：当前调用所属的应用或工作区上下文
 * English: Inputs: preferences: the ShortcutPreferences domain value in the signature; context: application/workspace context for the call
 * 中文：结果：包含  的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing  for caller state reads/operations
 */
export function effectiveShortcuts(
  preferences: ShortcutPreferences,
  context?: string,
): Record<ShortcutId, string> {
  return { ...defaults, ...preferences.global, ...(context ? preferences.projects[context] : {}) };
}
/**
 * 中文：只接受已知命令 ID 与受限字符串，逐键规范化；拒绝数组、未知操作和过长配置。
 * English: Accept only known command IDs/bounded strings and normalize each binding; reject arrays, unknown operations and oversized entries.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：ShortcutMap，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ShortcutMap carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：快捷键配置格式无效；快捷键配置包含未知操作或无效按键。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 快捷键配置格式无效; 快捷键配置包含未知操作或无效按键. These errors reach the direct caller or this function's catch handler
 */
function validateMap(input: unknown): ShortcutMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('快捷键配置格式无效');
  const output: ShortcutMap = {};
  for (const [id, value] of Object.entries(input)) {
    if (!ids.has(id) || typeof value !== 'string' || value.length > 40)
      throw new Error('快捷键配置包含未知操作或无效按键');
    output[id as ShortcutId] = normalizeShortcut(value);
  }
  return output;
}
/**
 * 中文：验证版本、至多 100 个项目作用域和每个映射，再对完整有效映射检查键冲突；项目覆盖后重新核对全局继承项。
 * English: Validate version, up to one hundred project scopes and each mapping, then check complete effective maps for collisions, reconsidering inherited global entries after project overrides.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：ShortcutPreferences，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: ShortcutPreferences carrying the described computation/transport result; throwing branches do not provide success
 * 中文：拒绝原因：快捷键配置版本无效；最多保存 100 个项目的快捷键；项目快捷键标识无效。这些错误交给直接调用者或本函数 catch 处理
 * English: Refusal reasons: 快捷键配置版本无效; 最多保存 100 个项目的快捷键; 项目快捷键标识无效. These errors reach the direct caller or this function's catch handler
 */
export function validateShortcuts(input: unknown): ShortcutPreferences {
  const source = input as ShortcutPreferences;
  if (
    !source ||
    source.version !== 1 ||
    !source.projects ||
    typeof source.projects !== 'object' ||
    Array.isArray(source.projects)
  )
    throw new Error('快捷键配置版本无效');
  if (Object.keys(source.projects).length > 100) throw new Error('最多保存 100 个项目的快捷键');
  const preferences: ShortcutPreferences = {
    version: 1,
    global: validateMap(source.global),
    projects: Object.create(null),
  };
  for (const [context, map] of Object.entries(source.projects)) {
    const scope = JSON.parse(context);
    if (
      !Array.isArray(scope) ||
      scope.length !== 2 ||
      scope.some((item) => typeof item !== 'string' || !item || item.length > 128)
    )
      throw new Error('项目快捷键标识无效');
    preferences.projects[context] = validateMap(map);
  }
  for (const context of [undefined, ...Object.keys(preferences.projects)]) {
    const bindings = effectiveShortcuts(preferences, context),
      used = new Map<string, string>();
    for (const command of shortcutCommands) {
      const binding = bindings[command.id];
      if (!binding) continue;
      if (used.has(binding))
        throw new Error(
          `${context ? '项目' : '全局'}快捷键冲突：${used.get(binding)}与${command.name}使用了 ${binding}`,
        );
      used.set(binding, command.name);
    }
  }
  return preferences;
}
/**
 * 中文：读取并校验浏览器配置，损坏或不可用时使用空覆盖以保留内置默认。
 * English: Read/validate browser settings, using empty overrides on damaged/unavailable storage to retain builtin defaults.
 * 中文：结果：包含 version、global、projects 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing version, global, projects for caller state reads/operations
 */
export function readShortcuts(): ShortcutPreferences {
  try {
    const source = localStorage.getItem(storageKey);
    if (source) return validateShortcuts(JSON.parse(source));
  } catch {
    /* Unavailable or invalid browser storage falls back to built-ins. */
  }
  return { version: 1, global: {}, projects: {} };
}
/**
 * 中文：完整校验后持久化并发送当前窗口变化事件，失败通过调用者反馈而非写入无效配置。
 * English: Validate completely before persistence/in-window notification, propagating failure rather than storing invalid settings.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function saveShortcuts(input: ShortcutPreferences) {
  const preferences = validateShortcuts(input);
  localStorage.setItem(storageKey, JSON.stringify(preferences));
  window.dispatchEvent(new Event(changed));
}
/**
 * 中文：订阅当前窗口与其他窗口的快捷键变化，返回移除两类监听的退订。
 * English: Subscribe to shortcut changes in this/other windows and return cleanup removing both listeners.
 * 中文：输入：listener：本订阅的变化观察者
 * English: Inputs: listener: change observer for this subscription
 * 中文：结果：保留本次资源的后续调用或清理函数，由所有者在对应寿命结束时使用
 * English: Result: a follow-up/cleanup function retaining this pass's resources for its owner to use at the matching lifetime boundary
 */
export function watchShortcuts(listener: /** 中文：接收所属状态或资源变化，保持回调作用域与订阅一致；这是 watchShortcuts 的调用契约 | English: Receive owned state/resource changes within the subscription scope; this is the callable contract of watchShortcuts | 中文：结果：void；调用者依赖此类型约定 | English: Result: void; callers depend on this type contract */ () => void) {
  /**
   * 中文：仅本配置键或全量清空事件通知监听，其他存储变化忽略。
   * English: Notify listeners only for this setting key/full storage clears, ignoring unrelated writes.
   * 中文：输入：event：触发本处理器的事件及其数据
   * English: Inputs: event: triggering event and its data
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener('storage', storage);
  /**
   * 中文：在规范化按键、校验冲突并按工作区保存快捷键流程中移除登记的事件监听；操作对象由当前参数或闭包绑定，保持所属调用的状态和资源一致
   * English: In Normalizing keys, validating conflicts and persisting shortcuts per workspace, remove registered event listeners. Current parameters/closures bind the affected objects, retaining state/resource ownership for this invocation
   * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
   * English: Result: deliver through the described state/resource effects without returning business data
   */
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', storage);
  };
}
/**
 * 中文：把非重复、非组合输入且未处理的键盘事件规范成 Mod/Shift 字符串，拒绝 Alt 和 Ctrl+Meta 同按，单键只允许斜杠。
 * English: Normalize unhandled/nonrepeat/noncomposition keyboard events into Mod/Shift strings, rejecting Alt and simultaneous Ctrl+Meta; allow only slash without modifiers.
 * 中文：输入：event：触发本处理器的事件及其数据
 * English: Inputs: event: triggering event and its data
 */
export function eventShortcut(
  event: Pick<
    KeyboardEvent,
    | 'key'
    | 'code'
    | 'ctrlKey'
    | 'metaKey'
    | 'shiftKey'
    | 'altKey'
    | 'isComposing'
    | 'repeat'
    | 'defaultPrevented'
  >,
) {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.altKey ||
    (event.ctrlKey && event.metaKey)
  )
    return '';
  const key = event.code === 'Slash' ? '/' : event.key.toUpperCase();
  if (!event.ctrlKey && !event.metaKey) return key === '/' && !event.shiftKey ? '/' : '';
  if (!/^[A-Z0-9/]$/.test(key)) return '';
  return 'Mod+' + (event.shiftKey ? 'Shift+' : '') + key;
}
/**
 * 中文：判断目标是否处于输入控件、可编辑内容、CodeMirror、终端或桌面区域，供全局快捷键避免抢走局部按键。
 * English: Detect input/contenteditable/CodeMirror/terminal/desktop targets so global shortcuts avoid taking local keystrokes.
 * 中文：输入：target：事件目标或操作目标
 * English: Inputs: target: event/operation target
 */
export function shortcutInputTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, .xterm, .desktop-screen',
    )
  );
}

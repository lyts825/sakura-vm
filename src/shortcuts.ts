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

export function shortcutContext(vmId?: string, projectId?: string) {
  return vmId && projectId ? JSON.stringify([vmId, projectId]) : undefined;
}
export function effectiveShortcuts(
  preferences: ShortcutPreferences,
  context?: string,
): Record<ShortcutId, string> {
  return { ...defaults, ...preferences.global, ...(context ? preferences.projects[context] : {}) };
}
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
export function readShortcuts(): ShortcutPreferences {
  try {
    const source = localStorage.getItem(storageKey);
    if (source) return validateShortcuts(JSON.parse(source));
  } catch {
    /* Unavailable or invalid browser storage falls back to built-ins. */
  }
  return { version: 1, global: {}, projects: {} };
}
export function saveShortcuts(input: ShortcutPreferences) {
  const preferences = validateShortcuts(input);
  localStorage.setItem(storageKey, JSON.stringify(preferences));
  window.dispatchEvent(new Event(changed));
}
export function watchShortcuts(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', storage);
  };
}
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
export function shortcutInputTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, .xterm, .desktop-screen',
    )
  );
}

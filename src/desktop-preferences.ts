/**
 * 模块职责（中文）：合并桌面偏好及本地草稿，区分用户编辑与服务端更新，避免远端同步覆盖尚未保存的修改。
 * Module responsibility (English): Distinguishing desktop-preference drafts from confirmed server state.
 * 详细范围（中文）：公开入口包括 desktopPreferenceDefaults, mergeDesktopPreferences, DesktopPreferenceState, loadDesktopPreferences, saveDesktopPreferences, sameDesktopPreferences, editDesktopPreferences, receiveDesktopPreferences；职责覆盖区分桌面偏好草稿与已确认服务端状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include desktopPreferenceDefaults, mergeDesktopPreferences, DesktopPreferenceState, loadDesktopPreferences, saveDesktopPreferences, sameDesktopPreferences, editDesktopPreferences, receiveDesktopPreferences. The scope covers Distinguishing desktop-preference drafts from confirmed server state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { DesktopPreferences } from '../shared/desktop-preferences.ts';
import type { DesktopView } from '../shared/contracts/vm.ts';

export const desktopPreferenceDefaults: DesktopPreferences = {
  sessionType: 'auto',
  resolution: '1280x800',
  monitorLayout: 'single',
  scale: 100,
  theme: 'sakura',
  wallpaper: 'sakura',
  accent: '#c75b86',
  panel: 'bottom',
  autoHidePanel: false,
  animations: true,
};

const resolutions = ['1280x800', '1440x900', '1600x1000', '1920x1080'] as const;
const monitorLayouts = ['single', 'dual-horizontal', 'dual-vertical'] as const;
const themes = ['sakura', 'midnight', 'paper', 'lavender'] as const;
const wallpapers = ['sakura', 'midnight', 'paper', 'plain'] as const;
const panels = ['bottom', 'top', 'floating'] as const;

/**
 * 中文：仅接受 allowed 集合中的值，否则返回该字段的默认值；不把未知值隐式转换成受支持枚举。
 * English: Accept only values contained in allowed; otherwise return the field default, without coercing unknown values into supported enum entries.
 * 中文：输入：value：待校验、转换或保存的输入值；allowed：可接受的枚举值集合；fallback：输入无效时采用的默认值
 * English: Inputs: value: input value to validate/transform/save; allowed: set of accepted enum values; fallback: default used for invalid input
 */
function valueOrDefault<T>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * 中文：从未知输入逐字段恢复完整偏好；枚举、整数缩放、六位颜色和布尔值分别校验，单字段损坏只回退该字段。
 * English: Restore a complete preference set field by field from unknown input. Validate enums, integer scaling, six-digit colors and booleans independently so one damaged field only resets that field.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：包含 sessionType、resolution、monitorLayout、scale、theme、wallpaper、accent、panel、autoHidePanel、animations 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing sessionType, resolution, monitorLayout, scale, theme, wallpaper, accent, panel, autoHidePanel, animations for caller state reads/operations
 */
export function mergeDesktopPreferences(input: unknown): DesktopPreferences {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    sessionType: valueOrDefault(value.sessionType, ['auto', 'x11', 'wayland'] as const,
      desktopPreferenceDefaults.sessionType),
    resolution: valueOrDefault(value.resolution, resolutions, desktopPreferenceDefaults.resolution),
    monitorLayout: valueOrDefault(value.monitorLayout, monitorLayouts,
      desktopPreferenceDefaults.monitorLayout),
    scale:
      typeof value.scale === 'number' &&
      Number.isInteger(value.scale) &&
      value.scale >= 100 &&
      value.scale <= 200
        ? value.scale
        : desktopPreferenceDefaults.scale,
    theme: valueOrDefault(value.theme, themes, desktopPreferenceDefaults.theme),
    wallpaper: valueOrDefault(value.wallpaper, wallpapers, desktopPreferenceDefaults.wallpaper),
    accent:
      typeof value.accent === 'string' && /^#[0-9a-f]{6}$/i.test(value.accent)
        ? value.accent
        : desktopPreferenceDefaults.accent,
    panel: valueOrDefault(value.panel, panels, desktopPreferenceDefaults.panel),
    autoHidePanel:
      typeof value.autoHidePanel === 'boolean'
        ? value.autoHidePanel
        : desktopPreferenceDefaults.autoHidePanel,
    animations:
      typeof value.animations === 'boolean' ? value.animations : desktopPreferenceDefaults.animations,
  };
}

export type DesktopPreferenceState = { preferences: DesktopPreferences; pending: boolean };
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * 中文：按实例键恢复偏好及 pending 草稿标记，兼容只保存偏好对象的旧格式；存储或 JSON 失败返回默认偏好和非草稿状态。
 * English: Restore preferences and the pending-draft marker by VM key, accepting the legacy preference-only format. Storage/JSON failure returns defaults with no pending draft.
 * 中文：输入：id：目标资源标识；storage：调用时提供浏览器存储能力的工厂
 * English: Inputs: id: target resource identifier; storage: factory providing browser storage at invocation
 * 中文：结果：包含 preferences、pending 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing preferences, pending for caller state reads/operations
 */
export function loadDesktopPreferences(id: string, storage: /** 中文：提供浏览器持久化能力，调用时获取当前可用存储对象；这是 loadDesktopPreferences 的调用契约 | English: Provide browser persistence by obtaining the currently available storage object on invocation; this is the callable contract of loadDesktopPreferences | 中文：结果：PreferenceStorage；调用者依赖此类型约定 | English: Result: PreferenceStorage; callers depend on this type contract */ () => PreferenceStorage): DesktopPreferenceState {
  try {
    const saved = JSON.parse(storage().getItem(`sakura-desktop-preferences:${id}`) || 'null');
    // Older browsers stored only the preference object, without draft metadata.
    return {
      preferences: mergeDesktopPreferences(saved?.preferences ?? saved),
      pending: saved?.pending === true,
    };
  } catch {
    return { preferences: mergeDesktopPreferences(null), pending: false };
  }
}

/**
 * 中文：把偏好和草稿标记作为一个 JSON 值写入实例缓存，避免两次写入不一致；缓存失败不阻止向客户机应用设置。
 * English: Persist preferences and their draft marker as one JSON value per VM to avoid inconsistent separate writes. Cache failure must not prevent applying settings to the guest.
 * 中文：输入：id：目标资源标识；state：当前状态或草稿快照；storage：调用时提供浏览器存储能力的工厂
 * English: Inputs: id: target resource identifier; state: current state/draft snapshot; storage: factory providing browser storage at invocation
 * 中文：结果：通过上述状态或资源副作用交付，不返回业务数据
 * English: Result: deliver through the described state/resource effects without returning business data
 */
export function saveDesktopPreferences(
  id: string,
  state: DesktopPreferenceState,
  storage: /** 中文：提供浏览器持久化能力，调用时获取当前可用存储对象；这是 saveDesktopPreferences 的调用契约 | English: Provide browser persistence by obtaining the currently available storage object on invocation; this is the callable contract of saveDesktopPreferences | 中文：结果：PreferenceStorage；调用者依赖此类型约定 | English: Result: PreferenceStorage; callers depend on this type contract */ () => PreferenceStorage,
) {
  try {
    // Keep the draft and its pending flag in one atomic browser-storage write.
    storage().setItem(`sakura-desktop-preferences:${id}`, JSON.stringify(state));
  } catch {
    // An unavailable browser cache must not prevent applying settings to the guest.
  }
}

/**
 * 中文：逐字段比较偏好，强调色忽略十六进制大小写；用来判定服务端确认是否与本地草稿完全一致。
 * English: Compare preference fields, ignoring hexadecimal case for the accent color; determine whether server confirmation exactly matches the local draft.
 * 中文：输入：left：比较或合并的左侧值；right：比较或合并的右侧值
 * English: Inputs: left: left comparison/merge value; right: right comparison/merge value
 */
export function sameDesktopPreferences(left: DesktopPreferences, right: DesktopPreferences) {
  return (Object.keys(left) as (keyof DesktopPreferences)[]).every((key) =>
    key === 'accent' ? left[key].toLowerCase() === right[key].toLowerCase() : left[key] === right[key],
  );
}

/**
 * 中文：将局部 patch 合并到当前偏好并标记待确认；返回新状态对象，不把本地编辑误当成服务端已生效设置。
 * English: Merge a partial patch into current preferences and mark it pending; return new state without treating local edits as confirmed guest settings.
 * 中文：输入：state：当前状态或草稿快照；patch：只包含修改字段的增量
 * English: Inputs: state: current state/draft snapshot; patch: delta containing modified fields only
 * 中文：结果：包含 preferences、pending 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing preferences, pending for caller state reads/operations
 */
export function editDesktopPreferences(
  state: DesktopPreferenceState,
  patch: Partial<DesktopPreferences>,
): DesktopPreferenceState {
  return { preferences: { ...state.preferences, ...patch }, pending: true };
}

/**
 * 中文：只接受有偏好的 ready/stopped/not-installed 视图；尚未匹配的本地草稿保持不变，服务端确认一致后才清除 pending。排队视图不代表磁盘读取成功。
 * English: Accept preferences only from ready/stopped/not-installed views. Preserve a differing local draft and clear pending only after matching server confirmation; queued views do not prove a successful disk read.
 * 中文：输入：state：当前状态或草稿快照；view：本次收到的服务端视图
 * English: Inputs: state: current state/draft snapshot; view: newly received server view
 * 中文：结果：包含 preferences、pending 的对象，字段供调用者读取状态或调用操作
 * English: Result: an object containing preferences, pending for caller state reads/operations
 */
export function receiveDesktopPreferences(
  state: DesktopPreferenceState,
  view: DesktopView,
): DesktopPreferenceState {
  // Queued operations report requested values, not a successful guest disk read.
  // Failed or unavailable probes omit preferences instead of inventing defaults.
  if (!view.preferences || !['ready', 'stopped', 'not-installed'].includes(view.status)) return state;
  if (state.pending && !sameDesktopPreferences(state.preferences, view.preferences)) return state;
  return { preferences: view.preferences, pending: false };
}

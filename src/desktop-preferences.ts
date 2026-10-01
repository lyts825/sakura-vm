import type { DesktopPreferences, DesktopView } from '../server/model.ts';

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

function valueOrDefault<T>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

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

export function loadDesktopPreferences(id: string, storage: () => PreferenceStorage): DesktopPreferenceState {
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

export function saveDesktopPreferences(
  id: string,
  state: DesktopPreferenceState,
  storage: () => PreferenceStorage,
) {
  try {
    // Keep the draft and its pending flag in one atomic browser-storage write.
    storage().setItem(`sakura-desktop-preferences:${id}`, JSON.stringify(state));
  } catch {
    // An unavailable browser cache must not prevent applying settings to the guest.
  }
}

export function sameDesktopPreferences(left: DesktopPreferences, right: DesktopPreferences) {
  return (Object.keys(left) as (keyof DesktopPreferences)[]).every((key) =>
    key === 'accent' ? left[key].toLowerCase() === right[key].toLowerCase() : left[key] === right[key],
  );
}

export function editDesktopPreferences(
  state: DesktopPreferenceState,
  patch: Partial<DesktopPreferences>,
): DesktopPreferenceState {
  return { preferences: { ...state.preferences, ...patch }, pending: true };
}

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

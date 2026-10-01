import { z } from 'zod';

const desktopPreferenceFields = {
  sessionType: z.enum(['auto', 'x11', 'wayland']),
  resolution: z.enum(['1280x800', '1440x900', '1600x1000', '1920x1080']),
  monitorLayout: z.enum(['single', 'dual-horizontal', 'dual-vertical']),
  scale: z.number().int().min(100).max(200),
  theme: z.enum(['sakura', 'midnight', 'paper', 'lavender']),
  wallpaper: z.enum(['sakura', 'midnight', 'paper', 'plain']),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, '强调色需要使用 6 位十六进制颜色'),
  panel: z.enum(['bottom', 'top', 'floating']),
  autoHidePanel: z.boolean(),
  animations: z.boolean(),
};

export const desktopPreferencesSchema = z
  .object({
    sessionType: desktopPreferenceFields.sessionType.default('auto'),
    resolution: desktopPreferenceFields.resolution.default('1280x800'),
    monitorLayout: desktopPreferenceFields.monitorLayout.default('single'),
    scale: desktopPreferenceFields.scale.default(100),
    theme: desktopPreferenceFields.theme.default('sakura'),
    wallpaper: desktopPreferenceFields.wallpaper.default('sakura'),
    accent: desktopPreferenceFields.accent.default('#c75b86'),
    panel: desktopPreferenceFields.panel.default('bottom'),
    autoHidePanel: desktopPreferenceFields.autoHidePanel.default(false),
    animations: desktopPreferenceFields.animations.default(true),
  })
  .strict();

export type DesktopPreferences = z.infer<typeof desktopPreferencesSchema>;
export const defaultDesktopPreferences = desktopPreferencesSchema.parse({});

const preferenceKeys = Object.keys(desktopPreferenceFields) as (keyof DesktopPreferences)[];

/**
 * Recover a complete preference set from persisted or browser-provided data.
 * A bad field should not discard the other settings that were already saved.
 */
export function mergeDesktopPreferences(input: unknown): DesktopPreferences {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const result = { ...defaultDesktopPreferences };
  for (const key of preferenceKeys) {
    const parsed = desktopPreferenceFields[key].safeParse(value[key]);
    if (parsed.success) result[key] = parsed.data as never;
  }
  return result;
}

function unquoteShellValue(value: string) {
  const match = /^(?:'([^']*)'|"([^"]*)")$/.exec(value);
  return match ? (match[1] ?? match[2]) : value;
}

/** Parse the shell-style preference file written into the guest disk. */
export function parseDesktopPreferencesFile(contents: string): DesktopPreferences {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = /^(SESSION_TYPE|RESOLUTION|MONITOR_LAYOUT|SCALE|THEME|WALLPAPER|ACCENT|PANEL|AUTO_HIDE_PANEL|ANIMATIONS)=(.*)$/.exec(
      line.trim(),
    );
    if (match) values[match[1]] = unquoteShellValue(match[2]);
  }
  return mergeDesktopPreferences({
    sessionType: values.SESSION_TYPE,
    resolution: values.RESOLUTION,
    monitorLayout: values.MONITOR_LAYOUT,
    scale: values.SCALE === undefined ? undefined : Number(values.SCALE),
    theme: values.THEME,
    wallpaper: values.WALLPAPER,
    accent: values.ACCENT,
    panel: values.PANEL,
    autoHidePanel:
      values.AUTO_HIDE_PANEL === 'true' ? true : values.AUTO_HIDE_PANEL === 'false' ? false : undefined,
    animations: values.ANIMATIONS === 'true' ? true : values.ANIMATIONS === 'false' ? false : undefined,
  });
}

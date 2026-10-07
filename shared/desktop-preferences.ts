/**
 * 模块职责（中文）：桌面偏好字段、默认值与校验规则，解析客户机配置文件并仅合并受支持字段。
 * Module responsibility (English): Validating desktop preferences and parsing guest configuration text.
 * 详细范围（中文）：公开入口包括 desktopPreferencesSchema, DesktopPreferences, defaultDesktopPreferences, mergeDesktopPreferences, parseDesktopPreferencesFile；职责覆盖校验桌面偏好并解析客户机配置文本，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include desktopPreferencesSchema, DesktopPreferences, defaultDesktopPreferences, mergeDesktopPreferences, parseDesktopPreferencesFile. The scope covers Validating desktop preferences and parsing guest configuration text. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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
/**
 * 中文：从默认偏好开始逐字段 safeParse，仅替换校验成功字段，避免一个坏字段丢弃其他已保存设置。
 * English: Start from defaults and safeParse each field, replacing only valid entries so one bad field cannot discard other saved preferences.
 * 中文：输入：input：尚待校验的输入数据
 * English: Inputs: input: input data requiring validation
 * 中文：结果：DesktopPreferences，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: DesktopPreferences carrying the described computation/transport result; throwing branches do not provide success
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

/**
 * 中文：剥除一对完整单引号或双引号，否则保留原文本；只解析值的形状，不执行 shell 展开。
 * English: Strip one complete pair of single/double quotes or retain the original text; parse value shape without shell expansion.
 * 中文：输入：value：待校验、转换或保存的输入值
 * English: Inputs: value: input value to validate/transform/save
 */
function unquoteShellValue(value: string) {
  const match = /^(?:'([^']*)'|"([^"]*)")$/.exec(value);
  return match ? (match[1] ?? match[2]) : value;
}

/** Parse the shell-style preference file written into the guest disk. */
/**
 * 中文：只读取允许的 shell 风格赋值键，转换数字和明确布尔值后逐字段合并默认；未知行不会执行或进入偏好。
 * English: Read only allowed shell-style assignment keys, convert numeric/explicit boolean values and merge field defaults; unknown lines are neither executed nor admitted.
 * 中文：输入：contents：待解析的文件全文
 * English: Inputs: contents: complete file contents to parse
 * 中文：结果：DesktopPreferences，包含上述计算或传输完成值；抛错分支不提供成功结果
 * English: Result: DesktopPreferences carrying the described computation/transport result; throwing branches do not provide success
 */
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

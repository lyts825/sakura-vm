import { z } from 'zod';

export const desktopPreferencesSchema = z
  .object({
    resolution: z.enum(['1280x800', '1440x900', '1600x1000', '1920x1080']).default('1280x800'),
    scale: z.number().int().min(100).max(200).default(100),
    theme: z.enum(['sakura', 'midnight', 'paper', 'lavender']).default('sakura'),
    wallpaper: z.enum(['sakura', 'midnight', 'paper', 'plain']).default('sakura'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, '强调色需要使用 6 位十六进制颜色').default('#c75b86'),
    panel: z.enum(['bottom', 'top', 'floating']).default('bottom'),
    autoHidePanel: z.boolean().default(false),
    animations: z.boolean().default(true),
  })
  .strict();

export type DesktopPreferences = z.infer<typeof desktopPreferencesSchema>;
export const defaultDesktopPreferences = desktopPreferencesSchema.parse({});

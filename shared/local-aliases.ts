/**
 * 模块职责：本地主机别名动作与状态契约，供入口路由和主机别名配置复用。
 */
import { z } from 'zod';

export const localAliasActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set-enabled'), enabled: z.boolean() }).strict(),
  z.object({ action: z.literal('sync') }).strict(),
]);

export const localAliasViewSchema = z.object({
  enabled: z.boolean(), supported: z.boolean(),
  aliases: z.array(z.string()), installed: z.array(z.string()),
  missing: z.array(z.string()), stale: z.array(z.string()),
  error: z.string().optional(),
}).strict();

export type LocalAliasView = z.infer<typeof localAliasViewSchema>;

/**
 * 模块职责（中文）：本地主机别名动作与状态契约，供入口路由和主机别名配置复用。
 * Module responsibility (English): Defining local-host alias operations and views.
 * 详细范围（中文）：公开入口包括 localAliasActionSchema, localAliasViewSchema, LocalAliasView；职责覆盖定义本地主机别名操作与视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include localAliasActionSchema, localAliasViewSchema, LocalAliasView. The scope covers Defining local-host alias operations and views. Types, validation branches and cleanup paths define its data/behavior boundaries
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

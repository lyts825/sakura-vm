/**
 * 模块职责（中文）：控制面登录、会话与可访问项目的响应校验 Schema，定义核心身份接口的公开输出。
 * Module responsibility (English): response validation for identity, login, sessions and project access.
 * 详细范围（中文）：公开入口包括 sessionViewSchema, principalSchema, loginResponseSchema, accessibleProjectSchema, controllerResponses；职责覆盖身份、登录、会话和项目访问的响应验证，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include sessionViewSchema, principalSchema, loginResponseSchema, accessibleProjectSchema, controllerResponses. The scope covers response validation for identity, login, sessions and project access. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';
export { recoveryViewSchema } from './recovery.ts';

export const sessionViewSchema = z.object({
  configured: z.boolean(), enabled: z.boolean(), locked: z.boolean(), idleMinutes: z.number(),
  expiresAt: z.number().optional(), reason: z.enum(['idle', 'manual', 'startup']).optional(),
  retryAfterSeconds: z.number(),
}).strict();
export const principalSchema = z.object({ id: z.string(), username: z.string(),
  role: z.enum(['owner', 'viewer', 'member']), vmIds: z.array(z.string()), expiresAt: z.number() }).strict();
export const loginResponseSchema = z.object({ token: z.string(), principal: principalSchema }).strict();
export const accessibleProjectSchema = z.object({ vmId: z.string(), vmName: z.string(), projectId: z.string(),
  projectName: z.string(), roleId: z.string(), permissions: z.array(z.enum(['read', 'write', 'execute', 'approve'])),
  approvalRequired: z.boolean() }).strict();

/** Account/session DTOs shared by the controller response catalog and client contracts. */
export const controllerResponses: Readonly<Record<string, z.ZodType>> = {
  bootstrap: z.object({ token: z.string(), session: sessionViewSchema }).strict(),
  'access.status': z.object({ enabled: z.boolean(), session: sessionViewSchema }).strict(),
  'access.login': loginResponseSchema,
  'access.handoffRedeem': loginResponseSchema,
  'access.passkeyLoginVerify': loginResponseSchema,
  'access.logout': z.object({ ok: z.literal(true) }).strict(),
  'access.handoffCreate': z.object({ code: z.string(), expiresAt: z.number() }).strict(),
  'access.handoffCancel': z.object({ cancelled: z.literal(true) }).strict(),
  'access.projects': z.object({ projects: z.array(accessibleProjectSchema) }).strict(),
  'session.status': sessionViewSchema,
  'session.settings': sessionViewSchema,
  'session.configure': sessionViewSchema,
  'session.unlock': sessionViewSchema,
  'session.lock': sessionViewSchema,
  'session.activity': sessionViewSchema,
  'session.passkeyVerify': loginResponseSchema.extend({ session: sessionViewSchema }).strict(),
};

/**
 * 模块职责（中文）：HTTP 入口、健康检查与客户端认证契约，校验域名、路径和路由动作。
 * Module responsibility (English): Validating ingress routes, authentication and health-check configuration.
 * 详细范围（中文）：公开入口包括 ingressClientAuthSchema, ingressInputSchema, ingressEntrySchema, ingressActionSchema, ingressHealthSchema, ingressViewSchema, IngressInput, IngressEntry, IngressAction, IngressHealth, IngressView, IngressClientAuth, ingressAlias；职责覆盖校验入口路由、认证与健康检查配置，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ingressClientAuthSchema, ingressInputSchema, ingressEntrySchema, ingressActionSchema, ingressHealthSchema, ingressViewSchema, IngressInput, IngressEntry, IngressAction, IngressHealth, IngressView, IngressClientAuth, ingressAlias. The scope covers Validating ingress routes, authentication and health-check configuration. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

const pathSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^\/(?:[a-zA-Z0-9._~!$&'()+,;=:@%-]+(?:\/[a-zA-Z0-9._~!$&'()+,;=:@%-]+)*)?$/,
    '路径须以 / 开头，不能有尾部斜杠或查询参数',
  )
  .refine(
    (path) => !path.split('/').some((part) => part === '.' || part === '..' || /%2f|%5c|%2e/i.test(part)),
    '路径不能包含编码斜杠或点段',
  );

export const ingressClientAuthSchema = z
  .object({
    currentPem: z.string().min(100).max(16000),
    currentCaPem: z.string().min(100).max(16000).optional(),
    replacementPem: z.string().min(100).max(16000).optional(),
    replacementCaPem: z.string().min(100).max(16000).optional(),
    rotateAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.replacementPem) === Boolean(value.rotateAt), {
    message: '替换证书与轮换时间须同时填写',
  })
  .refine((value) => !value.replacementCaPem || Boolean(value.replacementPem), {
    message: '替换 CA 须同时提供替换客户端证书',
  });

export const ingressInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    protocol: z.enum(['http', 'https']).default('http'),
    domainAlias: z.boolean().default(false),
    listenPort: z.number().int().min(1024).max(65535),
    pathPrefix: pathSchema,
    vmId: z.uuid(),
    upstreamPort: z.number().int().min(1024).max(65535),
    healthPath: pathSchema,
    stripPrefix: z.boolean(),
    clientAuth: ingressClientAuthSchema.nullable().default(null),
  })
  .strict();

export const ingressEntrySchema = ingressInputSchema.extend({
  id: z.uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ingressActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), entry: ingressInputSchema }).strict(),
  z.object({ action: z.literal('delete'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('check'), id: z.uuid().optional() }).strict(),
]);

export const ingressHealthSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy', 'stopped', 'unconfigured', 'checking']),
    checkedAt: z.string().optional(),
    httpStatus: z.number().int().optional(),
    error: z.string().optional(),
  })
  .strict();

export const ingressViewSchema = z
  .object({
    entries: z.array(ingressEntrySchema.extend({ health: ingressHealthSchema, url: z.string() })),
    listenerErrors: z.record(z.string(), z.string()),
  })
  .strict();

export type IngressInput = z.infer<typeof ingressInputSchema>;
export type IngressEntry = z.infer<typeof ingressEntrySchema>;
export type IngressAction = z.infer<typeof ingressActionSchema>;
export type IngressHealth = z.infer<typeof ingressHealthSchema>;
export type IngressView = z.infer<typeof ingressViewSchema>;
export type IngressClientAuth = z.infer<typeof ingressClientAuthSchema>;

/**
 * 中文：移除入口 ID 中的连字符并转小写，生成固定 sakura.localhost 应用别名，供本地入口访问。
 * English: Remove hyphens from the ingress ID, lowercase it and produce the fixed sakura.localhost application alias for local access.
 * 中文：输入：id：目标资源标识
 * English: Inputs: id: target resource identifier
 */
export function ingressAlias(id: string) {
  return `app-${id.replace(/-/g, '').toLowerCase()}.sakura.localhost`;
}

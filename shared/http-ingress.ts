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

export function ingressAlias(id: string) {
  return `app-${id.replace(/-/g, '').toLowerCase()}.sakura.localhost`;
}

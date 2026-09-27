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

export const ingressInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    listenPort: z.number().int().min(1024).max(65535),
    pathPrefix: pathSchema,
    vmId: z.uuid(),
    upstreamPort: z.number().int().min(1024).max(65535),
    healthPath: pathSchema,
    stripPrefix: z.boolean(),
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

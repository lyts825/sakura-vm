import { z } from 'zod';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// Built-in packages use exact release pins; version ranges are deliberately unsupported.
const version = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const dependency = z.object({ id, version }).strict();
export const httpContributionSchema = z
  .object({
    path: z.string().regex(/^\/api\/[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*|:vmId))*$/),
    methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).min(1),
    projectScoped: z.boolean(),
  })
  .strict();
export const operationContributionSchema = z.object({
  id,
  path: z.string().regex(/^\/api\/[a-z][a-z0-9-]*(?:\/(?:[a-z][a-z0-9-]*|:vmId))*$/),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  status: z.number().int().min(200).max(299),
}).strict();
export const pluginManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('plugin'),
    id,
    name: z.string().min(1),
    description: z.string().min(1),
    version,
    apiVersion: z.number().int().positive(),
    category: z.enum(['foundation', 'workspace', 'development', 'operations', 'experimental']),
    experimental: z.boolean(),
    requires: z.array(dependency),
    optional: z.array(dependency),
    services: z.array(z.string().regex(/^[a-z][a-zA-Z0-9]*$/)),
    lifecycle: z.object({ activateMs: z.number().int().min(100).max(180000), closeMs: z.number().int().min(100).max(180000) }).strict(),
    contributes: z
      .object({
        http: z.array(httpContributionSchema),
        operations: z.array(operationContributionSchema),
        sockets: z.array(z.enum(['desktop', 'terminal-session'])),
        pages: z.array(id),
        tabs: z.array(id),
        developmentSections: z.array(id),
      })
      .strict(),
  })
  .strict();
export const pluginPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('pack'),
    id,
    name: z.string().min(1),
    description: z.string().min(1),
    version,
    members: z.array(z.object({ kind: z.enum(['plugin', 'pack']), id, version }).strict()).min(1),
    replacesPlugins: z.array(id),
  })
  .strict();
export const pluginSelectionSchema = z
  .object({
    schemaVersion: z.literal(3),
    plugins: z.array(id).max(100),
    packs: z.array(id).max(100),
  })
  .strict();
export const legacySelectionSchema = pluginSelectionSchema.extend({ schemaVersion: z.literal(1) });
export const legacySelectionSchemaV2 = pluginSelectionSchema.extend({ schemaVersion: z.literal(2) });

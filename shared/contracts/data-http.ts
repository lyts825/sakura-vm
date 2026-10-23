/** 所有外部数据动作使用一次性、定范围、限时的审阅计划。 */
import { z } from 'zod';
import { dataActionSchema, dataViewSchema, dataResultSchema } from './data-services.ts';
export const dataPluginIds = [
  'data-runtime',
  'data-sources',
  'data-datasets',
  'data-transforms',
  'data-quality',
  'data-notebooks',
  'data-experiments',
  'data-lineage',
  'data-exchange',
  'data-workbench',
] as const;
export const dataPlanSchema = z
  .object({
    token: z.uuid(),
    expiresAt: z.iso.datetime(),
    plugin: z.enum(dataPluginIds),
    input: dataActionSchema,
    notes: z.array(z.string().max(1024)).max(20),
  })
  .strict();
export const dataHttpActionSchema = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('preview'), input: dataActionSchema }).strict(),
  z.object({ phase: z.literal('commit'), token: z.uuid() }).strict(),
]);
export const dataHttpResultSchema = z.union([dataResultSchema, z.object({ plan: dataPlanSchema }).strict()]);
export const dataHttpRequests = Object.fromEntries<z.ZodType>(
  dataPluginIds.map((id) => [`${id}.act`, dataHttpActionSchema]),
);
export const dataHttpResponses = Object.fromEntries<z.ZodType>(
  dataPluginIds.flatMap((id) => [
    [`${id}.view`, dataViewSchema],
    [`${id}.act`, dataHttpResultSchema],
  ]),
);

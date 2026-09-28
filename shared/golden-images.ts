import { z } from 'zod';

export const goldenLimits = { count: 16, bytes: 128 * 1024 ** 3, imageBytes: 32 * 1024 ** 3 };
export const goldenEntrySchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    name: z.string().trim().min(1).max(60),
    note: z.string().max(1000),
    createdAt: z.iso.datetime(),
    sourceId: z.uuid(),
    sourceName: z.string().min(1).max(32),
    distro: z.enum(['alpine', 'debian', 'ubuntu']),
    architecture: z.enum(['x86_64', 'aarch64']).optional(),
    diskGiB: z.number().int().min(2).max(128),
    bytes: z.number().int().positive().max(goldenLimits.imageBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type GoldenEntry = z.infer<typeof goldenEntrySchema>;
export const goldenActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('create'),
      vmId: z.uuid(),
      name: goldenEntrySchema.shape.name,
      note: goldenEntrySchema.shape.note.default(''),
      sourceReviewed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal('instantiate'),
      id: z.uuid(),
      name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    })
    .strict(),
  z.object({ action: z.literal('verify'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('delete'), id: z.uuid() }).strict(),
]);
export type GoldenAction = z.infer<typeof goldenActionSchema>;
export const goldenResultSchema = z
  .object({
    kind: z.enum(['template', 'vm', 'verified', 'deleted']),
    id: z.uuid(),
  })
  .strict();
export type GoldenResult = z.infer<typeof goldenResultSchema>;

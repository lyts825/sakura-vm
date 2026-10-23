/** 本体不可变镜像与持久消费回执。 */
import { z } from 'zod';
export const imageDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const imageRefSchema = z.object({ assetId: imageDigestSchema, digest: imageDigestSchema }).strict();
export type ImageRef = z.infer<typeof imageRefSchema>;
export const imageAssetSchema = z
  .object({
    id: imageDigestSchema,
    digest: imageDigestSchema,
    bytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 ** 3),
    virtualBytes: z
      .number()
      .int()
      .positive()
      .max(128 * 1024 ** 3),
    distro: z.enum(['alpine', 'debian', 'ubuntu']),
    architecture: z.enum(['x86_64', 'aarch64']),
    createdAt: z.iso.datetime(),
    source: z.string().max(2048),
  })
  .strict();
export type ImageAsset = z.infer<typeof imageAssetSchema>;
export const imageOwnerSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}:[A-Za-z0-9_.:-]{1,160}$/);
export const ownedImageVmSchema = z
  .object({
    token: z.uuid(),
    owner: imageOwnerSchema,
    vmId: z.uuid(),
    createdAt: z.iso.datetime(),
    imageRef: imageRefSchema,
    persistent: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
    cleanup: z.enum(['pending', 'confirmed', 'unknown']),
  })
  .strict();
export type OwnedImageVm = z.infer<typeof ownedImageVmSchema>;
export const imageCreateSchema = z
  .object({
    imageRef: imageRefSchema,
    owner: imageOwnerSchema,
    name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    memoryMiB: z.number().int().min(256).max(32768).default(1024),
    cpus: z.number().int().min(1).max(32).default(1),
    network: z.enum(['isolated', 'nat']).default('isolated'),
    persistent: z.boolean().default(false),
    lifetimeMinutes: z.number().int().min(1).max(1440).default(30),
  })
  .strict();
export type ImageCreate = z.input<typeof imageCreateSchema>;
export const imageUploadSchema = z
  .object({
    id: z.uuid(),
    digest: imageDigestSchema,
    bytes: z
      .number()
      .int()
      .positive()
      .max(32 * 1024 ** 3),
    offset: z.number().int().nonnegative(),
    distro: imageAssetSchema.shape.distro,
    architecture: imageAssetSchema.shape.architecture,
    source: z.string().max(2048),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type ImageUpload = z.infer<typeof imageUploadSchema>;
export const imageLeaseSchema = z
  .object({ token: z.uuid(), imageRef: imageRefSchema, owner: imageOwnerSchema, expiresAt: z.iso.datetime() })
  .strict();
export type ImageLease = z.infer<typeof imageLeaseSchema>;

/** 交付输入和制品持久化契约。Delivery source and artifact persistence contracts. */
import { z } from 'zod';
import {
  deliveryDefinitionSchema,
  deliveryDigestSchema,
  deliveryManifestSchema,
  deliveryScopeSchema,
} from './delivery-common.ts';

/** 未完成上传的身份、声明长度与已确认偏移。Identity, declared length and confirmed offset for an unfinished upload. */
export const deliveryUploadSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    sha256: deliveryDigestSchema,
    bytes: z
      .number()
      .int()
      .min(0)
      .max(2 ** 30),
    offset: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryUpload = z.infer<typeof deliveryUploadSchema>;
/** 绑定源码清单和固定定义的输入记录；declared 不代表执行环境已核验。
 * Input record binding a source manifest and fixed definition; declared does not mean execution-environment verification. */
export const deliveryInputSchema = z
  .object({
    id: z.uuid(),
    scope: deliveryScopeSchema,
    digest: deliveryDigestSchema,
    manifestId: z.uuid(),
    manifestDigest: deliveryDigestSchema,
    definition: deliveryDefinitionSchema,
    projectVersion: z.string(),
    mode: z.enum(['commit', 'draft']),
    commit: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
    environmentEvidence: z.object({ status: z.literal('declared'), explanation: z.string() }).strict(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeliveryInputSnapshot = z.infer<typeof deliveryInputSchema>;
/** 一次性源码预览，包含完整文件、排除项和定义，供捕获时复核。
 * Single-use source preview containing the complete file list, exclusions and definition for capture-time revalidation. */
export const deliveryInputPlanSchema = z
  .object({
    token: z.uuid(),
    scope: deliveryScopeSchema,
    expiresAt: z.iso.datetime(),
    mode: z.enum(['commit', 'draft']),
    commit: z.string().optional(),
    projectVersion: z.string(),
    files: z.array(
      z
        .object({
          path: z.string(),
          sha256: deliveryDigestSchema,
          bytes: z.number().int().nonnegative(),
          mode: z.number().int(),
        })
        .strict(),
    ),
    excluded: z.array(z.string()),
    changes: z.array(z.object({ path: z.string(), status: z.string() }).strict()),
    totalBytes: z.number().int().nonnegative(),
    definition: deliveryDefinitionSchema,
  })
  .strict();
export type DeliveryInputPlan = z.infer<typeof deliveryInputPlanSchema>;
/** 绑定修订的清理预览；保留保护引用和未确认删除，使调用方可审阅实际范围。
 * Revision-bound cleanup preview exposing protected references and unconfirmed deletion for review of the actual scope. */
export const deliveryCleanupPlanSchema = z
  .object({
    token: z.uuid(),
    expiresAt: z.iso.datetime(),
    revision: z.string(),
    manifests: z.array(deliveryManifestSchema),
    protected: z.array(z.object({ manifestId: z.uuid(), references: z.array(z.string()) }).strict()),
    uploads: z.array(deliveryUploadSchema),
    unreferencedBlobs: z.array(z.string()),
    pendingCleanup: z.array(
      z.object({ blobId: z.string(), bytes: z.number(), error: z.string().optional() }).strict(),
    ),
    bytes: z.number().int().nonnegative(),
  })
  .strict();
export type DeliveryCleanupPlan = z.infer<typeof deliveryCleanupPlanSchema>;

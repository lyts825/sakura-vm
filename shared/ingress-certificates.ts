/**
 * 模块职责（中文）：入口证书轮换策略、动作及证书状态的公共 Schema，统一有效期和轮换错误视图。
 * Module responsibility (English): Defining certificate-rotation policy and certificate-state contracts.
 * 详细范围（中文）：公开入口包括 certificatePolicySchema, certificateActionSchema, certificateViewSchema, CertificatePolicy, CertificateView；职责覆盖定义证书轮换策略与证书状态契约，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include certificatePolicySchema, certificateActionSchema, certificateViewSchema, CertificatePolicy, CertificateView. The scope covers Defining certificate-rotation policy and certificate-state contracts. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

export const certificatePolicySchema = z
  .object({
    autoRotate: z.boolean(),
    renewBeforeDays: z.number().int().min(1).max(90),
  })
  .strict();

export const certificateActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configure'), policy: certificatePolicySchema }).strict(),
  z.object({ action: z.literal('rotate') }).strict(),
]);

export const certificateViewSchema = z
  .object({
    policy: certificatePolicySchema,
    certificate: z
      .object({
        pem: z.string(),
        fingerprint256: z.string(),
        validFrom: z.string(),
        validTo: z.string(),
        generatedAt: z.string(),
      })
      .strict()
      .nullable(),
    nextRotationAt: z.string().nullable(),
    rotationError: z.string().optional(),
  })
  .strict();

export type CertificatePolicy = z.infer<typeof certificatePolicySchema>;
export type CertificateView = z.infer<typeof certificateViewSchema>;

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

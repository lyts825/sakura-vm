/** 只读项目捕获票据。 Read-only project capture, fixed at preview time. */
import { z } from 'zod';
export const capturePathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (p) =>
      !p.includes('\\') &&
      !/[\x00-\x1f:]/.test(p) &&
      p
        .split('/')
        .every(
          (s) =>
            s &&
            s !== '.' &&
            s !== '..' &&
            !/^(\.git|node_modules|\.env(?:\..*)?|id_rsa|id_ed25519|credentials|\.aws|\.ssh)$/i.test(s),
        ) &&
      !/\.(pem|key|p12|pfx)$/i.test(p),
    '路径越界或属于默认排除项',
  );
export const captureRequestSchema = z
  .object({
    vmId: z.string().min(1).max(120),
    projectId: z.string().min(1).max(120),
    configRevision: z.string().min(1).max(128),
    relativePaths: z.array(capturePathSchema).min(1).max(2000),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 ** 2),
  })
  .strict();
export const capturedFileSchema = z
  .object({
    path: capturePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(16 * 1024 ** 2),
  })
  .strict();
export const capturePlanSchema = z
  .object({
    token: z.string().uuid(),
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.string().datetime(),
    consistency: z.literal('selected-file-copies'),
    files: z.array(capturedFileSchema).max(2000),
  })
  .strict();
export type ProjectCaptureRequest = z.infer<typeof captureRequestSchema>;
export type ProjectCapturePlan = z.infer<typeof capturePlanSchema>;
export type ProjectCaptureReceipt = ProjectCapturePlan;
export const captureRefreshSchema = z
  .array(
    z
      .object({
        path: capturePathSchema,
        sourceId: z.string().uuid(),
        expectedRevision: z.number().int().positive(),
      })
      .strict(),
  )
  .max(2000);

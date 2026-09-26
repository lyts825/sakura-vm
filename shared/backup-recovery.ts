import { z } from 'zod';
import { rescueRunSchema } from './rescue.ts';

export const backupRecoverySchema = z
  .object({
    backupId: z.uuid(),
    partition: z.number().int().min(0).max(128).default(0),
    paths: rescueRunSchema.shape.artifacts.refine((paths) => paths.length > 0, '至少选择一个文件'),
    password: z.string().max(1024).optional(),
  })
  .strict();
export type BackupRecoveryInput = z.infer<typeof backupRecoverySchema>;

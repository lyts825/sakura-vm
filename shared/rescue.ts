import { z } from 'zod';
import { sandboxArtifactSchema, sandboxExecutionSchema } from './sandbox.ts';

export const rescueRunSchema = z
  .object({
    command: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .refine((value) => !value.includes('\0'), '命令不能包含空字符'),
    partition: z.number().int().min(0).max(128).nullable().default(0),
    timeoutSeconds: z.number().int().min(1).max(1800).default(60),
    artifacts: z
      .array(
        z
          .string()
          .min(1)
          .max(512)
          .refine(
            (value) =>
              !value.startsWith('/') &&
              !/[\\\x00-\x1f]/.test(value) &&
              value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
            '产物需要 /workspace 内的相对文件路径',
          ),
      )
      .max(8)
      .default([])
      .refine((values) => new Set(values).size === values.length, '产物路径不能重复'),
  })
  .strict();
export type RescueRun = z.infer<typeof rescueRunSchema>;
export const DEFAULT_RESCUE_COMMAND =
  'cat /proc/partitions\nblkid\nif test -d /mnt/source/etc; then cat /mnt/source/etc/os-release; fi\nls -la /mnt/source';
export const rescueJobSchema = z
  .object({
    id: z.string(),
    status: z.enum(['running', 'done', 'error', 'cancelled', 'interrupted']),
    log: z.string(),
    startedAt: z.string(),
    execution: sandboxExecutionSchema.optional(),
  })
  .passthrough();
export const rescueViewSchema = z
  .object({
    runs: z.array(rescueJobSchema),
    persistenceError: z.string().optional(),
  })
  .strict();
export const rescueArtifactSchema = sandboxArtifactSchema.extend({ base64: z.string() });

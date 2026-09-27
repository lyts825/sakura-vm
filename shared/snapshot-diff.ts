import { z } from 'zod';

export const snapshotDiffInputSchema = z
  .object({
    from: z.uuid(),
    to: z.union([z.literal('current'), z.uuid()]).default('current'),
    partition: z.number().int().min(0).max(128).default(0),
    path: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^\/(?:[^/\\\x00-\x1f]+(?:\/[^/\\\x00-\x1f]+)*)?$/)
      .refine(
        (path) =>
          path === '/' ||
          (!path.endsWith('/') && path.split('/').every((part) => part !== '.' && part !== '..')),
        '需要文件系统内的绝对路径，不能包含相对目录',
      )
      .default('/workspace'),
  })
  .strict()
  .refine((value) => value.from !== value.to, '请选择两个不同的磁盘状态');
export type SnapshotDiffInput = z.infer<typeof snapshotDiffInputSchema>;

const fileSchema = z
  .object({
    path: z.string(),
    type: z.enum(['file', 'symlink']),
    bytes: z.number().optional(),
    sha256: z.string().optional(),
    target: z.string().optional(),
  })
  .strict();
export type SnapshotDiffFile = z.infer<typeof fileSchema>;
export const snapshotDiffResultSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    partition: z.number(),
    path: z.string(),
    diskChanged: z.boolean(),
    counts: z
      .object({
        before: z.number(),
        after: z.number(),
        added: z.number(),
        removed: z.number(),
        modified: z.number(),
      })
      .strict(),
    added: z.array(fileSchema),
    removed: z.array(fileSchema),
    modified: z.array(z.object({ path: z.string(), before: fileSchema, after: fileSchema }).strict()),
    checkedAt: z.string(),
  })
  .strict();
export type SnapshotDiffResult = z.infer<typeof snapshotDiffResultSchema>;
export const snapshotDiffJobSchema = z
  .object({ id: z.string(), status: z.string(), startedAt: z.string() })
  .passthrough();
export const snapshotDiffViewSchema = z
  .object({ runs: z.array(snapshotDiffJobSchema), persistenceError: z.string().optional() })
  .strict();

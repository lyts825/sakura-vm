import { z } from 'zod';
import { snapshotDiffInputSchema } from './snapshot-diff.ts';

export const snapshotMergeInputSchema = z.object({
  mode: z.enum(['preview', 'apply']),
  name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/).optional(),
  partition: snapshotDiffInputSchema.shape.partition,
  path: snapshotDiffInputSchema.shape.path,
}).strict().superRefine((value, context) => {
  if (value.mode === 'apply' && !value.name)
    context.addIssue({ code: 'custom', path: ['name'], message: '合并需要新实例名称' });
});
export type SnapshotMergeInput = z.infer<typeof snapshotMergeInputSchema>;

export const snapshotMergeJobSchema = z.object({
  id: z.string(), status: z.string(), startedAt: z.string(),
}).passthrough();
export const snapshotMergeViewSchema = z.object({
  branchOrigin: z.object({ sourceVmId: z.string(), snapshotId: z.string(),
    createdAt: z.string() }).optional(),
  sourceName: z.string().optional(),
  runs: z.array(snapshotMergeJobSchema),
  persistenceError: z.string().optional(),
}).strict();

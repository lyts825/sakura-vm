/**
 * 模块职责（中文）：快照分支合并的输入与任务视图契约，校验基础/分支/目标及冲突决策。
 * Module responsibility (English): Validating snapshot-branch merge inputs and conflict decisions.
 * 详细范围（中文）：公开入口包括 snapshotMergeInputSchema, SnapshotMergeInput, snapshotMergeJobSchema, snapshotMergeViewSchema；职责覆盖校验快照分支合并输入与冲突决策，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include snapshotMergeInputSchema, SnapshotMergeInput, snapshotMergeJobSchema, snapshotMergeViewSchema. The scope covers Validating snapshot-branch merge inputs and conflict decisions. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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

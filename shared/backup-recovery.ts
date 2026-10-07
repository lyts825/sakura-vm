/**
 * 模块职责（中文）：备份文件恢复输入契约，校验选择的备份、路径、目标和覆盖策略。
 * Module responsibility (English): Validating backup-file recovery targets, paths and overwrite policy.
 * 详细范围（中文）：公开入口包括 backupRecoverySchema, BackupRecoveryInput；职责覆盖校验备份文件恢复目标、路径和覆盖策略，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include backupRecoverySchema, BackupRecoveryInput. The scope covers Validating backup-file recovery targets, paths and overwrite policy. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
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

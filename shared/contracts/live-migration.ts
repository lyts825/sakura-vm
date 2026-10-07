/**
 * 模块职责（中文）：在线迁移目标准备回执和状态契约，校验迁移身份、资源及完成状态。
 * Module responsibility (English): live-migration target prepare receipts and state.
 * 详细范围（中文）：公开入口包括 liveMigrationPrepareReceiptSchema, LiveMigrationPrepareReceipt, liveMigrationTargetStatusSchema, LiveMigrationTargetStatus；职责覆盖在线迁移目标准备回执和状态，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include liveMigrationPrepareReceiptSchema, LiveMigrationPrepareReceipt, liveMigrationTargetStatusSchema, LiveMigrationTargetStatus. The scope covers live-migration target prepare receipts and state. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { z } from 'zod';

export const liveMigrationPrepareReceiptSchema = z.object({
  targetVmId: z.uuid(), sessionId: z.uuid(), targetDiskNode: z.string().min(1).max(64),
  diskPort: z.number().int().min(1024).max(65535), statePort: z.number().int().min(1024).max(65535),
  completionProtocol: z.literal(1).optional(),
}).strict();
export type LiveMigrationPrepareReceipt = z.infer<typeof liveMigrationPrepareReceiptSchema>;

/** Older paired controllers may omit proof fields; their status remains readable but cannot confirm a fence. */
export const liveMigrationTargetStatusSchema = z.object({
  targetVmId: z.uuid(),
  status: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
  originStatus: z.enum(['prepared', 'received', 'ready']),
  sourceHostId: z.uuid().optional(), sourceVmId: z.uuid().optional(), transferId: z.uuid().optional(),
  sessionId: z.uuid().optional(), projectsDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  targetVerifiedAt: z.iso.datetime().optional(),
}).strict();
export type LiveMigrationTargetStatus = z.infer<typeof liveMigrationTargetStatusSchema>;

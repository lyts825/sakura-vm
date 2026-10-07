/**
 * 模块职责（中文）：“备份策略”插件的界面视图类型（BackupView、BackupPolicy、BackupRecord、BackupRecoveryView），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for backup policy, retention and file recovery from published operation responses.
 * 详细范围（中文）：公开入口包括 BackupView, BackupPolicy, BackupRecord, BackupRecoveryView；职责覆盖从已公开操作响应派生备份策略、保留与文件恢复的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include BackupView, BackupPolicy, BackupRecord, BackupRecoveryView. The scope covers deriving UI data views for backup policy, retention and file recovery from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type BackupView = OperationResponse<'backups.legacy.get.vms.vmId.backups'>;
export type BackupPolicy = BackupView['policy'];
export type BackupRecord = BackupView['items'][number];
export type BackupRecoveryView = OperationResponse<'backups.recovery-view'>;

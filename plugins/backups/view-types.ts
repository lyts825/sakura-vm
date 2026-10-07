/**
 * 模块职责：“备份策略”插件的界面视图类型（BackupView、BackupPolicy、BackupRecord、BackupRecoveryView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type BackupView = OperationResponse<'backups.legacy.get.vms.vmId.backups'>;
export type BackupPolicy = BackupView['policy'];
export type BackupRecord = BackupView['items'][number];
export type BackupRecoveryView = OperationResponse<'backups.recovery-view'>;

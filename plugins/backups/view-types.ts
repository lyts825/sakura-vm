import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type BackupView = OperationResponse<'backups.legacy.get.vms.vmId.backups'>;
export type BackupPolicy = BackupView['policy'];
export type BackupRecord = BackupView['items'][number];
export type BackupRecoveryView = OperationResponse<'backups.recovery-view'>;

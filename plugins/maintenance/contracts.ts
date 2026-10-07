/**
 * 模块职责：“磁盘与诊断”插件的界面视图类型（StorageView、DiagnosticView、DiskMaintenanceView、DiskMaintenancePolicy），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type StorageView = OperationResponse<'maintenance.legacy.get.storage'>;
export type DiagnosticView = OperationResponse<'maintenance.legacy.get.vms.vmId.diagnostics'>;
export type DiskMaintenanceView = OperationResponse<'maintenance.legacy.get.vms.vmId.disk-maintenance'>;
export type DiskMaintenancePolicy = DiskMaintenanceView['policy'];

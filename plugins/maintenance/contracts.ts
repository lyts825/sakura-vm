import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type StorageView = OperationResponse<'maintenance.legacy.get.storage'>;
export type DiagnosticView = OperationResponse<'maintenance.legacy.get.vms.vmId.diagnostics'>;
export type DiskMaintenanceView = OperationResponse<'maintenance.legacy.get.vms.vmId.disk-maintenance'>;
export type DiskMaintenancePolicy = DiskMaintenanceView['policy'];

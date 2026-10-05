import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type HealthView = OperationResponse<'service-health.legacy.get.vms.vmId.health'>;
export type ServiceHealthPolicy = NonNullable<OperationResponse<'projects.legacy.get.vms.vmId.project'>['project']['services']>[number]['health'];

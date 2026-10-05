import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SecretsView = OperationResponse<'secrets.legacy.get.vms.vmId.secrets'>;
export type SecretRotationView = OperationResponse<'secrets.legacy.get.vms.vmId.secret-rotation'>;
export type SecretRotationItem = SecretRotationView['items'][number];

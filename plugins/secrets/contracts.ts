/**
 * 模块职责：“私密配置”插件的界面视图类型（SecretsView、SecretRotationView、SecretRotationItem），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SecretsView = OperationResponse<'secrets.legacy.get.vms.vmId.secrets'>;
export type SecretRotationView = OperationResponse<'secrets.legacy.get.vms.vmId.secret-rotation'>;
export type SecretRotationItem = SecretRotationView['items'][number];

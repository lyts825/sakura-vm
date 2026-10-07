/**
 * 模块职责：“服务健康检查”插件的界面视图类型（HealthView、ServiceHealthPolicy），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type HealthView = OperationResponse<'service-health.legacy.get.vms.vmId.health'>;
export type ServiceHealthPolicy = NonNullable<OperationResponse<'projects.legacy.get.vms.vmId.project'>['project']['services']>[number]['health'];

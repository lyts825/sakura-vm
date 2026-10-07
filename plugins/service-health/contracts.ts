/**
 * 模块职责（中文）：“服务健康检查”插件的界面视图类型（HealthView、ServiceHealthPolicy），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for continuous project-service health checks from published operation responses.
 * 详细范围（中文）：公开入口包括 HealthView, ServiceHealthPolicy；职责覆盖从已公开操作响应派生项目服务持续健康检查的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include HealthView, ServiceHealthPolicy. The scope covers deriving UI data views for continuous project-service health checks from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type HealthView = OperationResponse<'service-health.legacy.get.vms.vmId.health'>;
export type ServiceHealthPolicy = NonNullable<OperationResponse<'projects.legacy.get.vms.vmId.project'>['project']['services']>[number]['health'];

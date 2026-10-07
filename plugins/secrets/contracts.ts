/**
 * 模块职责（中文）：“私密配置”插件的界面视图类型（SecretsView、SecretRotationView、SecretRotationItem），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for private configuration references and rotation from published operation responses.
 * 详细范围（中文）：公开入口包括 SecretsView, SecretRotationView, SecretRotationItem；职责覆盖从已公开操作响应派生私密配置引用与轮换的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SecretsView, SecretRotationView, SecretRotationItem. The scope covers deriving UI data views for private configuration references and rotation from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SecretsView = OperationResponse<'secrets.legacy.get.vms.vmId.secrets'>;
export type SecretRotationView = OperationResponse<'secrets.legacy.get.vms.vmId.secret-rotation'>;
export type SecretRotationItem = SecretRotationView['items'][number];

/**
 * 模块职责（中文）：“沙箱工作台”插件的界面视图类型（SandboxOverview、SandboxView），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for isolated environments, timed execution and expiry cleanup from published operation responses.
 * 详细范围（中文）：公开入口包括 SandboxOverview, SandboxView；职责覆盖从已公开操作响应派生隔离环境、限时执行与到期清理的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SandboxOverview, SandboxView. The scope covers deriving UI data views for isolated environments, timed execution and expiry cleanup from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SandboxOverview = OperationResponse<'sandbox.list'>;
export type SandboxView = SandboxOverview['sandboxes'][number];

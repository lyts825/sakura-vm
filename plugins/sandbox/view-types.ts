/**
 * 模块职责：“沙箱工作台”插件的界面视图类型（SandboxOverview、SandboxView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SandboxOverview = OperationResponse<'sandbox.list'>;
export type SandboxView = SandboxOverview['sandboxes'][number];

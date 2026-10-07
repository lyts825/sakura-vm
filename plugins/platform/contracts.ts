/**
 * 模块职责：“平台扩展适配器”插件的界面视图类型（NextView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type NextView = OperationResponse<'platform.legacy.get.vms.vmId.next-features'>;

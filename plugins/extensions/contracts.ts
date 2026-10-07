/**
 * 模块职责：“工程扩展适配器”插件的界面视图类型（ExtendedView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type ExtendedView = OperationResponse<'extensions.legacy.get.vms.vmId.extended-features'>;

/**
 * 模块职责：“自动化与运维”插件的界面视图类型（SuiteView、Schedule、AlertConfig），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SuiteView = OperationResponse<'automation.legacy.get.vms.vmId.advanced'>;
export type Schedule = SuiteView['settings']['schedule'];
export type AlertConfig = SuiteView['settings']['alerts'];

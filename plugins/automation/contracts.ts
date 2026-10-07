/**
 * 模块职责（中文）：“自动化与运维”插件的界面视图类型（SuiteView、Schedule、AlertConfig），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for resource policy, packages and engineering tasks from published operation responses.
 * 详细范围（中文）：公开入口包括 SuiteView, Schedule, AlertConfig；职责覆盖从已公开操作响应派生资源策略、软件包与工程任务的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SuiteView, Schedule, AlertConfig. The scope covers deriving UI data views for resource policy, packages and engineering tasks from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SuiteView = OperationResponse<'automation.legacy.get.vms.vmId.advanced'>;
export type Schedule = SuiteView['settings']['schedule'];
export type AlertConfig = SuiteView['settings']['alerts'];

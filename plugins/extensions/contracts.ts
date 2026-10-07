/**
 * 模块职责（中文）：“工程扩展适配器”插件的界面视图类型（ExtendedView），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for engineering extensions and capability checks from published operation responses.
 * 详细范围（中文）：公开入口包括 ExtendedView；职责覆盖从已公开操作响应派生工程扩展与能力检查的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include ExtendedView. The scope covers deriving UI data views for engineering extensions and capability checks from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type ExtendedView = OperationResponse<'extensions.legacy.get.vms.vmId.extended-features'>;

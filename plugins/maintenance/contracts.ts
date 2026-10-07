/**
 * 模块职责（中文）：“磁盘与诊断”插件的界面视图类型（StorageView、DiagnosticView、DiskMaintenanceView、DiskMaintenancePolicy），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for VM diagnostics, disk growth and maintenance from published operation responses.
 * 详细范围（中文）：公开入口包括 StorageView, DiagnosticView, DiskMaintenanceView, DiskMaintenancePolicy；职责覆盖从已公开操作响应派生实例诊断、磁盘扩容与整理的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include StorageView, DiagnosticView, DiskMaintenanceView, DiskMaintenancePolicy. The scope covers deriving UI data views for VM diagnostics, disk growth and maintenance from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type StorageView = OperationResponse<'maintenance.legacy.get.storage'>;
export type DiagnosticView = OperationResponse<'maintenance.legacy.get.vms.vmId.diagnostics'>;
export type DiskMaintenanceView = OperationResponse<'maintenance.legacy.get.vms.vmId.disk-maintenance'>;
export type DiskMaintenancePolicy = DiskMaintenanceView['policy'];

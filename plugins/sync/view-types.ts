/**
 * 模块职责（中文）：“目录同步”插件的界面视图类型（SyncView、SyncConfig、SyncPreview、SyncMergeContext、SyncRun、SyncDecisions、SyncManualMerges），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for bidirectional directory sync, conflicts and rollback from published operation responses.
 * 详细范围（中文）：公开入口包括 SyncView, SyncConfig, SyncPreview, SyncMergeContext, SyncDecisions, SyncManualMerges；职责覆盖从已公开操作响应派生双向目录同步、冲突与回滚的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include SyncView, SyncConfig, SyncPreview, SyncMergeContext, SyncDecisions, SyncManualMerges. The scope covers deriving UI data views for bidirectional directory sync, conflicts and rollback from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationRequest, OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SyncView = OperationResponse<'sync.legacy.get.vms.vmId.sync'>;
export type SyncConfig = NonNullable<SyncView['config']>;
export type SyncPreview = OperationResponse<'sync.legacy.post.vms.vmId.sync-preview'>;
export type SyncMergeContext = OperationResponse<'sync.legacy.post.vms.vmId.sync-merge'>;
type SyncRun = OperationRequest<'sync.legacy.post.vms.vmId.sync'>;
export type SyncDecisions = NonNullable<SyncRun['decisions']>;
export type SyncManualMerges = NonNullable<SyncRun['merges']>;

/**
 * 模块职责（中文）：“磁盘快照”插件的界面视图类型（GoldenImagesView、RescueView、SignedBundlesView、SnapshotDiffView、SnapshotMergeView），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for snapshots, clones, rescue, golden images and signed bundles from published operation responses.
 * 详细范围（中文）：公开入口包括 GoldenImagesView, RescueView, SignedBundlesView, SnapshotDiffView, SnapshotMergeView；职责覆盖从已公开操作响应派生快照、克隆、救援、黄金镜像和签名包的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include GoldenImagesView, RescueView, SignedBundlesView, SnapshotDiffView, SnapshotMergeView. The scope covers deriving UI data views for snapshots, clones, rescue, golden images and signed bundles from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type GoldenImagesView = OperationResponse<'snapshots.golden-list'>;
export type RescueView = OperationResponse<'snapshots.rescue-view'>;
export type SignedBundlesView = OperationResponse<'snapshots.signed-bundles-view'>;
export type SnapshotDiffView = OperationResponse<'snapshots.snapshot-diff-view'>;
export type SnapshotMergeView = OperationResponse<'snapshots.snapshot-merge-view'>;

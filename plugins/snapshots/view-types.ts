/**
 * 模块职责：“磁盘快照”插件的界面视图类型（GoldenImagesView、RescueView、SignedBundlesView、SnapshotDiffView、SnapshotMergeView），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type GoldenImagesView = OperationResponse<'snapshots.golden-list'>;
export type RescueView = OperationResponse<'snapshots.rescue-view'>;
export type SignedBundlesView = OperationResponse<'snapshots.signed-bundles-view'>;
export type SnapshotDiffView = OperationResponse<'snapshots.snapshot-diff-view'>;
export type SnapshotMergeView = OperationResponse<'snapshots.snapshot-merge-view'>;

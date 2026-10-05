import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type GoldenImagesView = OperationResponse<'snapshots.golden-list'>;
export type RescueView = OperationResponse<'snapshots.rescue-view'>;
export type SignedBundlesView = OperationResponse<'snapshots.signed-bundles-view'>;
export type SnapshotDiffView = OperationResponse<'snapshots.snapshot-diff-view'>;
export type SnapshotMergeView = OperationResponse<'snapshots.snapshot-merge-view'>;

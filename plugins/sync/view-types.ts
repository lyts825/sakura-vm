import type { OperationRequest, OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type SyncView = OperationResponse<'sync.legacy.get.vms.vmId.sync'>;
export type SyncConfig = NonNullable<SyncView['config']>;
export type SyncPreview = OperationResponse<'sync.legacy.post.vms.vmId.sync-preview'>;
export type SyncMergeContext = OperationResponse<'sync.legacy.post.vms.vmId.sync-merge'>;
type SyncRun = OperationRequest<'sync.legacy.post.vms.vmId.sync'>;
export type SyncDecisions = NonNullable<SyncRun['decisions']>;
export type SyncManualMerges = NonNullable<SyncRun['merges']>;

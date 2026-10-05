import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type NetworkView = OperationResponse<'network.legacy.get.vms.vmId.network'>;
export type NetworkProfile = NetworkView['config'];
export type NetworkPreview = Extract<OperationResponse<'network.legacy.post.vms.vmId.network'>, { token: string }>;
export type ServicesView = OperationResponse<'network.legacy.get.vms.vmId.services'>;
export type SavedNetworkProfile = OperationResponse<'network.legacy.get.network-profiles'>[number];
export type DependencyAuthentication = NonNullable<NonNullable<NetworkProfile['dependencyDownloads']>['npm']>;

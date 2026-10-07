/**
 * 模块职责：“网络管理”插件的界面视图类型（NetworkView、NetworkProfile、NetworkPreview、ServicesView、SavedNetworkProfile、DependencyAuthentication），从公开 operation 响应契约派生字段以保持接口一致。
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type NetworkView = OperationResponse<'network.legacy.get.vms.vmId.network'>;
export type NetworkProfile = NetworkView['config'];
export type NetworkPreview = Extract<OperationResponse<'network.legacy.post.vms.vmId.network'>, { token: string }>;
export type ServicesView = OperationResponse<'network.legacy.get.vms.vmId.services'>;
export type SavedNetworkProfile = OperationResponse<'network.legacy.get.network-profiles'>[number];
export type DependencyAuthentication = NonNullable<NonNullable<NetworkProfile['dependencyDownloads']>['npm']>;

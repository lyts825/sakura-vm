/**
 * 模块职责（中文）：“网络管理”插件的界面视图类型（NetworkView、NetworkProfile、NetworkPreview、ServicesView、SavedNetworkProfile、DependencyAuthentication），从公开 operation 响应契约派生字段以保持接口一致。
 * Module responsibility (English): deriving UI data views for ports, network profiles, ingress and certificates from published operation responses.
 * 详细范围（中文）：公开入口包括 NetworkView, NetworkProfile, NetworkPreview, ServicesView, SavedNetworkProfile, DependencyAuthentication；职责覆盖从已公开操作响应派生端口、网络档案、入口与证书的界面数据视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include NetworkView, NetworkProfile, NetworkPreview, ServicesView, SavedNetworkProfile, DependencyAuthentication. The scope covers deriving UI data views for ports, network profiles, ingress and certificates from published operation responses. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import type { OperationResponse } from '../../shared/contracts/api-client.generated.ts';

export type NetworkView = OperationResponse<'network.legacy.get.vms.vmId.network'>;
export type NetworkProfile = NetworkView['config'];
export type NetworkPreview = Extract<OperationResponse<'network.legacy.post.vms.vmId.network'>, { token: string }>;
export type ServicesView = OperationResponse<'network.legacy.get.vms.vmId.services'>;
export type SavedNetworkProfile = OperationResponse<'network.legacy.get.network-profiles'>[number];
export type DependencyAuthentication = NonNullable<NonNullable<NetworkProfile['dependencyDownloads']>['npm']>;

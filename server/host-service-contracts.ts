/**
 * 模块职责：声明宿主服务解析器接口及无服务默认值，限制领域可依赖的宿主能力。
 */
import type { BrowserIdeV1, CapabilityChecksV1, ColdMigrationsV1, CommunityPluginsV1, DisasterRecoveryDrillV1, HaHostFailoverV1, HaLocalFailoversV1, HostMountsV1, HostPeersV1, MediaDevicesV1, NotebookEnvironmentsV1, ProcessInteropV1, ProjectTerminalsV1, SnapshotReplicationsV1, TrustedBootServiceV1, VirtioFsSharesV1 } from './service-contracts/v1.ts';
export interface HostServiceContracts {
  communityPlugins: CommunityPluginsV1;
  mediaDevices: MediaDevicesV1; hostMounts: HostMountsV1; virtioFsShares: VirtioFsSharesV1;
  processInterop: ProcessInteropV1; hostPeers: HostPeersV1; notebookEnvironments: NotebookEnvironmentsV1;
  browserIde: BrowserIdeV1; coldMigrations: ColdMigrationsV1; snapshotReplications: SnapshotReplicationsV1;
  haHostFailover: HaHostFailoverV1; haLocalFailovers: HaLocalFailoversV1; disasterRecovery: DisasterRecoveryDrillV1;
  trustedBoot: TrustedBootServiceV1; projectTerminals: ProjectTerminalsV1;
  capabilityChecks: CapabilityChecksV1;
}
export type HostServiceResolver = { optional<K extends keyof HostServiceContracts>(id: K): HostServiceContracts[K] | undefined };
export const noHostServices: HostServiceResolver = Object.freeze({ optional: () => undefined });

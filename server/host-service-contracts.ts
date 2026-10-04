import type { ServiceInterface } from './service-interface.ts';
import type { CommunityPlugins } from './community-plugins.ts';
import type { MediaDevices } from './media-devices.ts';
import type { HostMounts } from './host-mount.ts';
import type { VirtioFsShares } from './virtio-fs.ts';
import type { ProcessInterop } from './process-interop.ts';
import type { HostPeers } from './host-peers.ts';
import type { NotebookEnvironments } from './notebook-environments.ts';
import type { BrowserIde } from './browser-ide.ts';
import type { ColdMigrations } from './cold-migration.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';
import type { HaHostFailover } from './ha-host-failover.ts';
import type { HaLocalFailovers } from './ha-local-failovers.ts';
import type { DisasterRecoveryDrill } from './disaster-recovery-drill.ts';
import type { TrustedBootService } from './trusted-boot-service.ts';
import type { TerminalService } from './terminal-backend.ts';
import type { HostScoreInput } from './host-peers.ts';

export interface HostServiceContracts {
  communityPlugins: ServiceInterface<CommunityPlugins>;
  mediaDevices: ServiceInterface<MediaDevices>; hostMounts: ServiceInterface<HostMounts>; virtioFsShares: ServiceInterface<VirtioFsShares>;
  processInterop: ServiceInterface<ProcessInterop>; hostPeers: ServiceInterface<HostPeers>; notebookEnvironments: ServiceInterface<NotebookEnvironments>;
  browserIde: ServiceInterface<BrowserIde>; coldMigrations: ServiceInterface<ColdMigrations>; snapshotReplications: ServiceInterface<SnapshotReplications>;
  haHostFailover: ServiceInterface<HaHostFailover>; haLocalFailovers: ServiceInterface<HaLocalFailovers>; disasterRecovery: ServiceInterface<DisasterRecoveryDrill>;
  trustedBoot: ServiceInterface<TrustedBootService>; projectTerminals: TerminalService;
  capabilityChecks: {
    acmeAllowed(): boolean; mutation(delta: number): void;
    scoreHosts(input: HostScoreInput): ReturnType<ServiceInterface<HostPeers>['score']>;
    sharedDesktopCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
    sharedTerminalCheck(id: string): Promise<{ ready: boolean; reason?: string }>;
    passkeyCheck(): { ready: boolean; registered: number; reason?: string };
    accountModeReady(): boolean; mobileCheck(): { ready: boolean; devices: number; reason?: string };
    remoteAuditCheck(): Promise<{ ready: boolean; configured: boolean; anchoredSequence: number; reason?: string }>;
  };
}
export type HostServiceResolver = { optional<K extends keyof HostServiceContracts>(id: K): HostServiceContracts[K] | undefined };
export const noHostServices: HostServiceResolver = Object.freeze({ optional: () => undefined });

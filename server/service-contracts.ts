/**
 * 模块职责：汇集系统与官方插件服务的版本契约，连接服务引用、实现类型和公共成员定义。
 */
import type * as V1 from './service-contracts/v1.ts';
import { PUBLIC_SERVICE_CONTRACTS } from './public-service-members.ts';
import type { ServiceContract } from './service-ref.ts';

/** Stable descriptor IDs are independent of implementation names and paths. */
export const serviceContracts = {
  RecoveryCatalog: PUBLIC_SERVICE_CONTRACTS['sakura.service.recovery-catalog.v1'] as ServiceContract<V1.RecoveryCatalogV1>,
  FeatureSuite: PUBLIC_SERVICE_CONTRACTS['sakura.service.feature-suite.v1'] as ServiceContract<V1.FeatureSuiteV1>,
  FeatureScheduler: PUBLIC_SERVICE_CONTRACTS['sakura.service.feature-scheduler.v1'] as ServiceContract<V1.FeatureSchedulerV1>,
  Backups: PUBLIC_SERVICE_CONTRACTS['sakura.service.backups.v1'] as ServiceContract<V1.BackupsV1>,
  BackupRecovery: PUBLIC_SERVICE_CONTRACTS['sakura.service.backup-recovery.v1'] as ServiceContract<V1.BackupRecoveryV1>,
  CodeIntelligence: PUBLIC_SERVICE_CONTRACTS['sakura.service.code-intelligence.v1'] as ServiceContract<V1.CodeIntelligenceV1>,
  LanguageServices: PUBLIC_SERVICE_CONTRACTS['sakura.service.language-services.v1'] as ServiceContract<V1.LanguageServicesV1>,
  DebugAdapter: PUBLIC_SERVICE_CONTRACTS['sakura.service.debug-adapter.v1'] as ServiceContract<V1.DebugAdapterV1>,
  CommandPresets: PUBLIC_SERVICE_CONTRACTS['sakura.service.command-presets.v1'] as ServiceContract<V1.CommandPresetsV1>,
  Containers: PUBLIC_SERVICE_CONTRACTS['sakura.service.containers.v1'] as ServiceContract<V1.ContainersV1>,
  Desktops: PUBLIC_SERVICE_CONTRACTS['sakura.service.desktops.v1'] as ServiceContract<V1.DesktopsV1>,
  Jobs: PUBLIC_SERVICE_CONTRACTS['sakura.service.jobs.v1'] as ServiceContract<V1.JobsV1>,
  X11Clipboard: PUBLIC_SERVICE_CONTRACTS['sakura.service.x11clipboard.v1'] as ServiceContract<V1.X11ClipboardV1>,
  WaylandClipboard: PUBLIC_SERVICE_CONTRACTS['sakura.service.wayland-clipboard.v1'] as ServiceContract<V1.WaylandClipboardV1>,
  ExtendedFeatures: PUBLIC_SERVICE_CONTRACTS['sakura.service.extended-features.v1'] as ServiceContract<V1.ExtendedFeaturesV1>,
  Files: PUBLIC_SERVICE_CONTRACTS['sakura.service.files.v1'] as ServiceContract<V1.FilesV1>,
  FileHistory: PUBLIC_SERVICE_CONTRACTS['sakura.service.file-history.v1'] as ServiceContract<V1.FileHistoryV1>,
  FileLocks: PUBLIC_SERVICE_CONTRACTS['sakura.service.file-locks.v1'] as ServiceContract<V1.FileLocksV1>,
  GitWorkbench: PUBLIC_SERVICE_CONTRACTS['sakura.service.git-workbench.v1'] as ServiceContract<V1.GitWorkbenchV1>,
  Ide: PUBLIC_SERVICE_CONTRACTS['sakura.service.ide.v1'] as ServiceContract<V1.IdeV1>,
  Images: PUBLIC_SERVICE_CONTRACTS['sakura.service.images.v1'] as ServiceContract<V1.ImagesV1>,
  DiskImports: PUBLIC_SERVICE_CONTRACTS['sakura.service.disk-imports.v1'] as ServiceContract<V1.DiskImportsV1>,
  Maintenance: PUBLIC_SERVICE_CONTRACTS['sakura.service.maintenance.v1'] as ServiceContract<V1.MaintenanceV1>,
  Metrics: PUBLIC_SERVICE_CONTRACTS['sakura.service.metrics.v1'] as ServiceContract<V1.MetricsV1>,
  DataMigration: PUBLIC_SERVICE_CONTRACTS['sakura.service.data-migration.v1'] as ServiceContract<V1.DataMigrationV1>,
  NetworkProfiles: PUBLIC_SERVICE_CONTRACTS['sakura.service.network-profiles.v1'] as ServiceContract<V1.NetworkProfilesV1>,
  IngressCertificates: PUBLIC_SERVICE_CONTRACTS['sakura.service.ingress-certificates.v1'] as ServiceContract<V1.IngressCertificatesV1>,
  HttpIngress: PUBLIC_SERVICE_CONTRACTS['sakura.service.http-ingress.v1'] as ServiceContract<V1.HttpIngressV1>,
  LocalAliases: PUBLIC_SERVICE_CONTRACTS['sakura.service.local-aliases.v1'] as ServiceContract<V1.LocalAliasesV1>,
  Pipelines: PUBLIC_SERVICE_CONTRACTS['sakura.service.pipelines.v1'] as ServiceContract<V1.PipelinesV1>,
  NextFeatures: PUBLIC_SERVICE_CONTRACTS['sakura.service.next-features.v1'] as ServiceContract<V1.NextFeaturesV1>,
  ProjectFiles: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-files.v1'] as ServiceContract<V1.ProjectFilesV1>,
  Workspaces: PUBLIC_SERVICE_CONTRACTS['sakura.service.workspaces.v1'] as ServiceContract<V1.WorkspacesV1>,
  Recipes: PUBLIC_SERVICE_CONTRACTS['sakura.service.recipes.v1'] as ServiceContract<V1.RecipesV1>,
  RuntimeVersions: PUBLIC_SERVICE_CONTRACTS['sakura.service.runtime-versions.v1'] as ServiceContract<V1.RuntimeVersionsV1>,
  Sandboxes: PUBLIC_SERVICE_CONTRACTS['sakura.service.sandboxes.v1'] as ServiceContract<V1.SandboxesV1>,
  Secrets: PUBLIC_SERVICE_CONTRACTS['sakura.service.secrets.v1'] as ServiceContract<V1.SecretsV1>,
  ServiceHealth: PUBLIC_SERVICE_CONTRACTS['sakura.service.service-health.v1'] as ServiceContract<V1.ServiceHealthV1>,
  Bundles: PUBLIC_SERVICE_CONTRACTS['sakura.service.bundles.v1'] as ServiceContract<V1.BundlesV1>,
  SignedBundles: PUBLIC_SERVICE_CONTRACTS['sakura.service.signed-bundles.v1'] as ServiceContract<V1.SignedBundlesV1>,
  GoldenImages: PUBLIC_SERVICE_CONTRACTS['sakura.service.golden-images.v1'] as ServiceContract<V1.GoldenImagesV1>,
  Rescue: PUBLIC_SERVICE_CONTRACTS['sakura.service.rescue.v1'] as ServiceContract<V1.RescueV1>,
  SnapshotDiff: PUBLIC_SERVICE_CONTRACTS['sakura.service.snapshot-diff.v1'] as ServiceContract<V1.SnapshotDiffV1>,
  SnapshotMerge: PUBLIC_SERVICE_CONTRACTS['sakura.service.snapshot-merge.v1'] as ServiceContract<V1.SnapshotMergeV1>,
  FolderSync: PUBLIC_SERVICE_CONTRACTS['sakura.service.folder-sync.v1'] as ServiceContract<V1.FolderSyncV1>,
  ProjectTerminals: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-terminals.v1'] as ServiceContract<V1.ProjectTerminalsV1>,
  Toolchains: PUBLIC_SERVICE_CONTRACTS['sakura.service.toolchains.v1'] as ServiceContract<V1.ToolchainsV1>,
  Downloads: PUBLIC_SERVICE_CONTRACTS['sakura.service.downloads.v1'] as ServiceContract<V1.DownloadsV1>,
  SessionLock: PUBLIC_SERVICE_CONTRACTS['sakura.service.session-lock.v1'] as ServiceContract<V1.SessionLockV1>,
  AccessControl: PUBLIC_SERVICE_CONTRACTS['sakura.service.access-control.v1'] as ServiceContract<V1.AccessControlV1>,
  Passkeys: PUBLIC_SERVICE_CONTRACTS['sakura.service.passkeys.v1'] as ServiceContract<V1.PasskeysV1>,
  SingleSignOn: PUBLIC_SERVICE_CONTRACTS['sakura.service.single-sign-on.v1'] as ServiceContract<V1.SingleSignOnV1>,
  TerminalSharing: PUBLIC_SERVICE_CONTRACTS['sakura.service.terminal-sharing.v1'] as ServiceContract<V1.TerminalSharingV1>,
  JitPrivileges: PUBLIC_SERVICE_CONTRACTS['sakura.service.jit-privileges.v1'] as ServiceContract<V1.JitPrivilegesV1>,
  BrowserExtensions: PUBLIC_SERVICE_CONTRACTS['sakura.service.browser-extensions.v1'] as ServiceContract<V1.BrowserExtensionsV1>,
  RemoteAuditLock: PUBLIC_SERVICE_CONTRACTS['sakura.service.remote-audit-lock.v1'] as ServiceContract<V1.RemoteAuditLockV1>,
  FeatureRollouts: PUBLIC_SERVICE_CONTRACTS['sakura.service.feature-rollouts.v1'] as ServiceContract<V1.FeatureRolloutsV1>,
  ProjectExecution: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-execution.v1'] as ServiceContract<V1.ProjectExecutionV1>,
  UsbHotplug: PUBLIC_SERVICE_CONTRACTS['sakura.service.usb-hotplug.v1'] as ServiceContract<V1.UsbHotplugV1>,
  MediaDevices: PUBLIC_SERVICE_CONTRACTS['sakura.service.media-devices.v1'] as ServiceContract<V1.MediaDevicesV1>,
  MemoryReclaim: PUBLIC_SERVICE_CONTRACTS['sakura.service.memory-reclaim.v1'] as ServiceContract<V1.MemoryReclaimV1>,
  HostMounts: PUBLIC_SERVICE_CONTRACTS['sakura.service.host-mounts.v1'] as ServiceContract<V1.HostMountsV1>,
  VirtioFsShares: PUBLIC_SERVICE_CONTRACTS['sakura.service.virtio-fs-shares.v1'] as ServiceContract<V1.VirtioFsSharesV1>,
  TrustedBootService: PUBLIC_SERVICE_CONTRACTS['sakura.service.trusted-boot-service.v1'] as ServiceContract<V1.TrustedBootServiceV1>,
  GpuProfiles: PUBLIC_SERVICE_CONTRACTS['sakura.service.gpu-profiles.v1'] as ServiceContract<V1.GpuProfilesV1>,
  BuildFarm: PUBLIC_SERVICE_CONTRACTS['sakura.service.build-farm.v1'] as ServiceContract<V1.BuildFarmV1>,
  ProjectPermissions: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-permissions.v1'] as ServiceContract<V1.ProjectPermissionsV1>,
  PolicyBundles: PUBLIC_SERVICE_CONTRACTS['sakura.service.policy-bundles.v1'] as ServiceContract<V1.PolicyBundlesV1>,
  ChangeApprovals: PUBLIC_SERVICE_CONTRACTS['sakura.service.change-approvals.v1'] as ServiceContract<V1.ChangeApprovalsV1>,
  ProcessInterop: PUBLIC_SERVICE_CONTRACTS['sakura.service.process-interop.v1'] as ServiceContract<V1.ProcessInteropV1>,
  HostPeers: PUBLIC_SERVICE_CONTRACTS['sakura.service.host-peers.v1'] as ServiceContract<V1.HostPeersV1>,
  MobileCompanion: PUBLIC_SERVICE_CONTRACTS['sakura.service.mobile-companion.v1'] as ServiceContract<V1.MobileCompanionV1>,
  LiveMigrationReceiver: PUBLIC_SERVICE_CONTRACTS['sakura.service.live-migration-receiver.v1'] as ServiceContract<V1.LiveMigrationReceiverV1>,
  FleetPolicyRollouts: PUBLIC_SERVICE_CONTRACTS['sakura.service.fleet-policy-rollouts.v1'] as ServiceContract<V1.FleetPolicyRolloutsV1>,
  NotebookEnvironments: PUBLIC_SERVICE_CONTRACTS['sakura.service.notebook-environments.v1'] as ServiceContract<V1.NotebookEnvironmentsV1>,
  BrowserIde: PUBLIC_SERVICE_CONTRACTS['sakura.service.browser-ide.v1'] as ServiceContract<V1.BrowserIdeV1>,
  ColdMigrations: PUBLIC_SERVICE_CONTRACTS['sakura.service.cold-migrations.v1'] as ServiceContract<V1.ColdMigrationsV1>,
  SnapshotReplications: PUBLIC_SERVICE_CONTRACTS['sakura.service.snapshot-replications.v1'] as ServiceContract<V1.SnapshotReplicationsV1>,
  HaHostFailover: PUBLIC_SERVICE_CONTRACTS['sakura.service.ha-host-failover.v1'] as ServiceContract<V1.HaHostFailoverV1>,
  HaLocalFailovers: PUBLIC_SERVICE_CONTRACTS['sakura.service.ha-local-failovers.v1'] as ServiceContract<V1.HaLocalFailoversV1>,
  DisasterRecoveryDrill: PUBLIC_SERVICE_CONTRACTS['sakura.service.disaster-recovery-drill.v1'] as ServiceContract<V1.DisasterRecoveryDrillV1>,
  NativeIntegration: PUBLIC_SERVICE_CONTRACTS['sakura.service.native-integration.v1'] as ServiceContract<V1.NativeIntegrationV1>,
  NativeClipboard: PUBLIC_SERVICE_CONTRACTS['sakura.service.native-clipboard.v1'] as ServiceContract<V1.NativeClipboardV1>,
  LocalAssistant: PUBLIC_SERVICE_CONTRACTS['sakura.service.local-assistant.v1'] as ServiceContract<V1.LocalAssistantV1>,
  CommunityPlugins: PUBLIC_SERVICE_CONTRACTS['sakura.service.community-plugins.v1'] as ServiceContract<V1.CommunityPluginsV1>,
  Webhooks: PUBLIC_SERVICE_CONTRACTS['sakura.service.webhooks.v1'] as ServiceContract<V1.WebhooksV1>,
  AutomationRules: PUBLIC_SERVICE_CONTRACTS['sakura.service.automation-rules.v1'] as ServiceContract<V1.AutomationRulesV1>,
  LogRetention: PUBLIC_SERVICE_CONTRACTS['sakura.service.log-retention.v1'] as ServiceContract<V1.LogRetentionV1>,
  GraphApi: PUBLIC_SERVICE_CONTRACTS['sakura.service.graph-api.v1'] as ServiceContract<V1.GraphApiV1>,
  PackageWorkbench: PUBLIC_SERVICE_CONTRACTS['sakura.service.package-workbench.v1'] as ServiceContract<V1.PackageWorkbenchV1>,
  SingleAppWindows: PUBLIC_SERVICE_CONTRACTS['sakura.service.single-app-windows.v1'] as ServiceContract<V1.SingleAppWindowsV1>,
  ResumableUploads: PUBLIC_SERVICE_CONTRACTS['sakura.service.resumable-uploads.v1'] as ServiceContract<V1.ResumableUploadsV1>,
  StorageTiering: PUBLIC_SERVICE_CONTRACTS['sakura.service.storage-tiering.v1'] as ServiceContract<V1.StorageTieringV1>,
  ServiceMesh: PUBLIC_SERVICE_CONTRACTS['sakura.service.service-mesh.v1'] as ServiceContract<V1.ServiceMeshV1>,
  VtpmEnrollment: PUBLIC_SERVICE_CONTRACTS['sakura.service.vtpm-enrollment.v1'] as ServiceContract<V1.VtpmEnrollmentV1>,
  AcmeRenewal: PUBLIC_SERVICE_CONTRACTS['sakura.service.acme-renewal.v1'] as ServiceContract<V1.AcmeRenewalV1>,
  TeamTemplates: PUBLIC_SERVICE_CONTRACTS['sakura.service.team-templates.v1'] as ServiceContract<V1.TeamTemplatesV1>,
  HaFailureMonitor: PUBLIC_SERVICE_CONTRACTS['sakura.service.ha-failure-monitor.v1'] as ServiceContract<V1.HaFailureMonitorV1>,
  ProjectCatalog: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-catalog.v1'] as ServiceContract<V1.ProjectCatalogV1>,
  StorageRuntime: PUBLIC_SERVICE_CONTRACTS['sakura.service.storage-runtime.v1'] as ServiceContract<V1.StorageRuntimeV1>,
  ProjectPreparation: PUBLIC_SERVICE_CONTRACTS['sakura.service.project-preparation.v1'] as ServiceContract<V1.ProjectPreparationV1>,
  VmLifetime: PUBLIC_SERVICE_CONTRACTS['sakura.service.vm-lifetime.v1'] as ServiceContract<V1.VmLifetimeV1>,
  ResourceScope: PUBLIC_SERVICE_CONTRACTS['sakura.service.resource-scope.v1'] as ServiceContract<V1.ResourceScopeV1>,
  CapabilityChecks: PUBLIC_SERVICE_CONTRACTS['sakura.service.capability-checks.v1'] as ServiceContract<V1.CapabilityChecksV1>,
} as const;

export const officialServiceContracts: Readonly<Record<string, ServiceContract<any>>> = {
  'automation/suite': serviceContracts.FeatureSuite,
  'automation-scheduler/scheduler': serviceContracts.FeatureScheduler,
  'backups/backups': serviceContracts.Backups,
  'backups/backupRecovery': serviceContracts.BackupRecovery,
  'code-checks/intelligence': serviceContracts.CodeIntelligence,
  'code-checks/languageServices': serviceContracts.LanguageServices,
  'code-checks/debugger': serviceContracts.DebugAdapter,
  'commands/commands': serviceContracts.CommandPresets,
  'containers/containers': serviceContracts.Containers,
  'desktop/desktops': serviceContracts.Desktops,
  'desktop/jobs': serviceContracts.Jobs,
  'desktop/x11Clipboard': serviceContracts.X11Clipboard,
  'desktop/waylandClipboard': serviceContracts.WaylandClipboard,
  'extensions/extended': serviceContracts.ExtendedFeatures,
  'files/files': serviceContracts.Files,
  'files/history': serviceContracts.FileHistory,
  'files/fileLocks': serviceContracts.FileLocks,
  'git/git': serviceContracts.GitWorkbench,
  'ide/ide': serviceContracts.Ide,
  'images/images': serviceContracts.Images,
  'images/diskImports': serviceContracts.DiskImports,
  'maintenance/maintenance': serviceContracts.Maintenance,
  'metrics/metrics': serviceContracts.Metrics,
  'migration/migration': serviceContracts.DataMigration,
  'network/network': serviceContracts.NetworkProfiles,
  'network/certificates': serviceContracts.IngressCertificates,
  'network/ingress': serviceContracts.HttpIngress,
  'network/localAliases': serviceContracts.LocalAliases,
  'pipelines/pipelines': serviceContracts.Pipelines,
  'platform/next': serviceContracts.NextFeatures,
  'project-search/projectFiles': serviceContracts.ProjectFiles,
  'projects/workspaces': serviceContracts.Workspaces,
  'recipes/recipes': serviceContracts.Recipes,
  'runtimes/runtimes': serviceContracts.RuntimeVersions,
  'sandbox/sandboxes': serviceContracts.Sandboxes,
  'secrets/secrets': serviceContracts.Secrets,
  'service-health/health': serviceContracts.ServiceHealth,
  'snapshots/bundles': serviceContracts.Bundles,
  'snapshots/signedBundles': serviceContracts.SignedBundles,
  'snapshots/goldenImages': serviceContracts.GoldenImages,
  'snapshots/rescue': serviceContracts.Rescue,
  'snapshots/snapshotDiff': serviceContracts.SnapshotDiff,
  'snapshots/snapshotMerge': serviceContracts.SnapshotMerge,
  'sync/sync': serviceContracts.FolderSync,
  'terminal-workspace/terminals': serviceContracts.ProjectTerminals,
  'toolchains/toolchains': serviceContracts.Toolchains,
  'transfers/downloads': serviceContracts.Downloads,
};

export const systemServiceContracts: Readonly<Record<string, ServiceContract<any>>> = {
  'session': serviceContracts.SessionLock,
  'access': serviceContracts.AccessControl,
  'passkeys': serviceContracts.Passkeys,
  'sso': serviceContracts.SingleSignOn,
  'terminalSharing': serviceContracts.TerminalSharing,
  'jitPrivileges': serviceContracts.JitPrivileges,
  'browserExtensions': serviceContracts.BrowserExtensions,
  'remoteAudit': serviceContracts.RemoteAuditLock,
  'rollouts': serviceContracts.FeatureRollouts,
  'projectTerminals': serviceContracts.ProjectTerminals,
  'projectExecution': serviceContracts.ProjectExecution,
  'usbHotplug': serviceContracts.UsbHotplug,
  'mediaDevices': serviceContracts.MediaDevices,
  'memoryReclaim': serviceContracts.MemoryReclaim,
  'hostMounts': serviceContracts.HostMounts,
  'virtioFsShares': serviceContracts.VirtioFsShares,
  'trustedBoot': serviceContracts.TrustedBootService,
  'gpuProfiles': serviceContracts.GpuProfiles,
  'buildFarm': serviceContracts.BuildFarm,
  'projectPermissions': serviceContracts.ProjectPermissions,
  'policyBundles': serviceContracts.PolicyBundles,
  'changeApprovals': serviceContracts.ChangeApprovals,
  'processInterop': serviceContracts.ProcessInterop,
  'hostPeers': serviceContracts.HostPeers,
  'mobileCompanion': serviceContracts.MobileCompanion,
  'liveMigrationReceiver': serviceContracts.LiveMigrationReceiver,
  'fleetRollouts': serviceContracts.FleetPolicyRollouts,
  'capabilityChecks': serviceContracts.CapabilityChecks,
  'notebookEnvironments': serviceContracts.NotebookEnvironments,
  'browserIde': serviceContracts.BrowserIde,
  'coldMigrations': serviceContracts.ColdMigrations,
  'snapshotReplications': serviceContracts.SnapshotReplications,
  'haHostFailover': serviceContracts.HaHostFailover,
  'haLocalFailovers': serviceContracts.HaLocalFailovers,
  'disasterRecovery': serviceContracts.DisasterRecoveryDrill,
  'native': serviceContracts.NativeIntegration,
  'nativeClipboard': serviceContracts.NativeClipboard,
  'assistant': serviceContracts.LocalAssistant,
  'communityPlugins': serviceContracts.CommunityPlugins,
  'webhooks': serviceContracts.Webhooks,
  'automationRules': serviceContracts.AutomationRules,
  'retention': serviceContracts.LogRetention,
  'graph': serviceContracts.GraphApi,
  'terminal-backend': serviceContracts.ProjectTerminals,
};

/** System assembly returns these contracts; raw values stay in initialization callbacks. */
export interface SystemServiceContracts {
  'session': V1.SessionLockV1;
  'access': V1.AccessControlV1;
  'passkeys': V1.PasskeysV1;
  'sso': V1.SingleSignOnV1;
  'terminalSharing': V1.TerminalSharingV1;
  'jitPrivileges': V1.JitPrivilegesV1;
  'browserExtensions': V1.BrowserExtensionsV1;
  'remoteAudit': V1.RemoteAuditLockV1;
  'rollouts': V1.FeatureRolloutsV1;
  'projectTerminals': V1.ProjectTerminalsV1;
  'projectExecution': V1.ProjectExecutionV1;
  'usbHotplug': V1.UsbHotplugV1;
  'mediaDevices': V1.MediaDevicesV1;
  'memoryReclaim': V1.MemoryReclaimV1;
  'hostMounts': V1.HostMountsV1;
  'virtioFsShares': V1.VirtioFsSharesV1;
  'trustedBoot': V1.TrustedBootServiceV1;
  'gpuProfiles': V1.GpuProfilesV1;
  'buildFarm': V1.BuildFarmV1;
  'projectPermissions': V1.ProjectPermissionsV1;
  'policyBundles': V1.PolicyBundlesV1;
  'changeApprovals': V1.ChangeApprovalsV1;
  'processInterop': V1.ProcessInteropV1;
  'hostPeers': V1.HostPeersV1;
  'mobileCompanion': V1.MobileCompanionV1;
  'liveMigrationReceiver': V1.LiveMigrationReceiverV1;
  'fleetRollouts': V1.FleetPolicyRolloutsV1;
  'capabilityChecks': V1.CapabilityChecksV1;
  'notebookEnvironments': V1.NotebookEnvironmentsV1;
  'browserIde': V1.BrowserIdeV1;
  'coldMigrations': V1.ColdMigrationsV1;
  'snapshotReplications': V1.SnapshotReplicationsV1;
  'haHostFailover': V1.HaHostFailoverV1;
  'haLocalFailovers': V1.HaLocalFailoversV1;
  'disasterRecovery': V1.DisasterRecoveryDrillV1;
  'native': V1.NativeIntegrationV1;
  'nativeClipboard': V1.NativeClipboardV1;
  'assistant': V1.LocalAssistantV1;
  'communityPlugins': V1.CommunityPluginsV1;
  'webhooks': V1.WebhooksV1;
  'automationRules': V1.AutomationRulesV1;
  'retention': V1.LogRetentionV1;
  'graph': V1.GraphApiV1;
  'terminal-backend': V1.ProjectTerminalsV1;
}

// Runtime descriptors cannot be widened by changing a borrowed declaration object.
for (const contract of Object.values(PUBLIC_SERVICE_CONTRACTS)) {
  Object.freeze(contract.members);
  if (contract.optional) Object.freeze(contract.optional);
  if (contract.methods) Object.freeze(contract.methods);
  if (contract.properties) Object.freeze(contract.properties);
  if (contract.returns) Object.freeze(contract.returns);
  Object.freeze(contract);
}
Object.freeze(PUBLIC_SERVICE_CONTRACTS);
Object.freeze(serviceContracts);
Object.freeze(officialServiceContracts);
Object.freeze(systemServiceContracts);

import type { BackupsV1, BundlesV1, CodeIntelligenceV1, CommandPresetsV1, ContainersV1, DataMigrationV1, DebugAdapterV1, DesktopsV1, DownloadsV1, ExtendedFeaturesV1, FeatureSuiteV1, FileHistoryV1, FileLocksV1, FilesV1, FolderSyncV1, GitWorkbenchV1, IdeV1, ImagesV1, JobsV1, LanguageServicesV1, MaintenanceV1, MetricsV1, NetworkProfilesV1, NextFeaturesV1, PipelinesV1, ProjectFilesV1, RecipesV1, RuntimeVersionsV1, SecretsV1, ServiceHealthV1, ToolchainsV1, WorkspacesV1 } from './service-contracts/v1.ts';
/** Read-only public contracts. Every convenience access resolves a revocable ServiceRef. */
export interface PluginServices {
  files: FilesV1;
  images: ImagesV1;
  bundles: BundlesV1;
  downloads: DownloadsV1;
  workspaces: WorkspacesV1;
  sync: FolderSyncV1;
  jobs: JobsV1;
  backups: BackupsV1;
  maintenance: MaintenanceV1;
  ide: IdeV1;
  recipes: RecipesV1;
  git: GitWorkbenchV1;
  projectFiles: ProjectFilesV1;
  commands: CommandPresetsV1;
  toolchains: ToolchainsV1;
  network: NetworkProfilesV1;
  secrets: SecretsV1;
  health: ServiceHealthV1;
  containers: ContainersV1;
  migration: DataMigrationV1;
  history: FileHistoryV1;
  fileLocks: FileLocksV1;
  pipelines: PipelinesV1;
  runtimes: RuntimeVersionsV1;
  intelligence: CodeIntelligenceV1;
  languageServices: LanguageServicesV1;
  debugger: DebugAdapterV1;
  suite: FeatureSuiteV1;
  extended: ExtendedFeaturesV1;
  next: NextFeaturesV1;
  desktops: DesktopsV1;
  metrics: MetricsV1;
}
export const SERVICE_KEYS = [
  'files',
  'images',
  'bundles',
  'downloads',
  'workspaces',
  'sync',
  'jobs',
  'backups',
  'maintenance',
  'ide',
  'recipes',
  'git',
  'projectFiles',
  'commands',
  'toolchains',
  'network',
  'secrets',
  'health',
  'containers',
  'migration',
  'history',
  'fileLocks',
  'pipelines',
  'runtimes',
  'intelligence',
  'languageServices',
  'debugger',
  'suite',
  'extended',
  'next',
  'desktops',
  'metrics',
] as const satisfies readonly (keyof PluginServices)[];

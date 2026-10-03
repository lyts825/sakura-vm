import type { Files } from './files.ts';
import type { Images } from './images.ts';
import type { Bundles } from './bundles.ts';
import type { Downloads } from './downloads.ts';
import type { Workspaces } from './workspaces.ts';
import type { FolderSync } from './sync.ts';
import type { Jobs } from './jobs.ts';
import type { Backups } from './backups.ts';
import type { Maintenance } from './maintenance.ts';
import type { Ide } from './ide.ts';
import type { Recipes } from './recipes.ts';
import type { GitWorkbench } from './git-workbench.ts';
import type { ProjectFiles } from './project-files.ts';
import type { CommandPresets } from './command-presets.ts';
import type { Toolchains } from './toolchains.ts';
import type { NetworkProfiles } from './network-profiles.ts';
import type { Secrets } from './secrets.ts';
import type { ServiceHealth } from './service-health.ts';
import type { Containers } from './containers.ts';
import type { DataMigration } from './data-migration.ts';
import type { FileHistory } from './file-history.ts';
import type { FileLocks } from './file-locks.ts';
import type { Pipelines } from './pipelines.ts';
import type { RuntimeVersions } from './runtime-versions.ts';
import type { CodeIntelligence } from './code-intelligence.ts';
import type { LanguageServices } from './language-services.ts';
import type { DebugAdapter } from './debug-adapter.ts';
import type { FeatureSuite } from './feature-suite.ts';
import type { ExtendedFeatures } from './extended-features.ts';
import type { NextFeatures } from './next-features.ts';
import type { Desktops } from './desktop.ts';
import type { Metrics } from './metrics.ts';

/** Compatibility view of built-in services. New services use provider-owned ServiceRefs. */
export interface PluginServices {
  files: Files;
  images: Images;
  bundles: Bundles;
  downloads: Downloads;
  workspaces: Workspaces;
  sync: FolderSync;
  jobs: Jobs;
  backups: Backups;
  maintenance: Maintenance;
  ide: Ide;
  recipes: Recipes;
  git: GitWorkbench;
  projectFiles: ProjectFiles;
  commands: CommandPresets;
  toolchains: Toolchains;
  network: NetworkProfiles;
  secrets: Secrets;
  health: ServiceHealth;
  containers: Containers;
  migration: DataMigration;
  history: FileHistory;
  fileLocks: FileLocks;
  pipelines: Pipelines;
  runtimes: RuntimeVersions;
  intelligence: CodeIntelligence;
  languageServices: LanguageServices;
  debugger: DebugAdapter;
  suite: FeatureSuite;
  extended: ExtendedFeatures;
  next: NextFeatures;
  desktops: Desktops;
  metrics: Metrics;
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

import type { Features } from '../features.ts';
export type PluginModule = {
  services: readonly (keyof Features)[];
  activate(host: Features): Promise<void>;
  deactivate?(host: Features): void;
  route: typeof import('./files.ts').route;
};
export const loaders: Record<string, () => Promise<PluginModule>> = {
  transfers: () => import('./transfers.ts'),
  files: () => import('./files.ts'),
  images: () => import('./images.ts'),
  projects: () => import('./projects.ts'),
  environment: () => import('./environment.ts'),
  development: () => import('./development.ts'),
  git: () => import('./git.ts'),
  containers: () => import('./containers.ts'),
  sync: () => import('./sync.ts'),
  network: () => import('./network.ts'),
  secrets: () => import('./secrets.ts'),
  monitoring: () => import('./monitoring.ts'),
  desktop: () => import('./desktop.ts'),
  backups: () => import('./backups.ts'),
  maintenance: () => import('./maintenance.ts'),
  migration: () => import('./migration.ts'),
  automation: () => import('./automation.ts'),
  extensions: () => import('./extensions.ts'),
  platform: () => import('./platform.ts'),
  snapshots: () => import('./snapshots.ts'),
  library: () => import('./library.ts'),
  'terminal-workspace': () => import('./terminal-workspace.ts'),
  'command-palette': () => import('./command-palette.ts'),
};
const globalRoutes: Record<string, string> = {
  jobs: 'tasks',
  events: 'tasks',
  'feature-suite': 'automation',
  'extended-features': 'extensions',
  'next-features': 'platform',
  migration: 'migration',
  storage: 'maintenance',
  recipes: 'environment',
  images: 'images',
  import: 'snapshots',
};
const vmRoutes: Record<string, string> = {
  snapshots: 'snapshots',
  projects: 'projects',
  history: 'files',
  pipelines: 'development',
  'pipeline-artifact': 'development',
  runtimes: 'development',
  git: 'git',
  'project-files': 'development',
  'code-diagnostics': 'development',
  advanced: 'automation',
  'extended-features': 'extensions',
  'next-features': 'platform',
  commands: 'development',
  tools: 'development',
  network: 'network',
  secrets: 'secrets',
  health: 'monitoring',
  containers: 'containers',
  'backup-download': 'backups',
  organization: 'library',
  diagnostics: 'maintenance',
  resize: 'maintenance',
  compact: 'maintenance',
  ide: 'environment',
  recipe: 'environment',
  backups: 'backups',
  'sync-preview': 'sync',
  download: 'transfers',
  'terminal-session': 'terminal-workspace',
  transfer: 'files',
  'file-operation': 'files',
  export: 'snapshots',
  clone: 'snapshots',
  metrics: 'monitoring',
  services: 'network',
  project: 'projects',
  'project-runtime': 'projects',
  sync: 'sync',
  ime: 'desktop',
  file: 'files',
  files: 'files',
  desktop: 'desktop',
  suspend: 'automation',
  resume: 'automation',
};
export function routeOwner(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api') return undefined;
  if (parts[1] === 'vms')
    return parts[2] === 'batch'
      ? 'library'
      : Object.hasOwn(vmRoutes, parts[3])
        ? vmRoutes[parts[3]]
        : undefined;
  return Object.hasOwn(globalRoutes, parts[1]) ? globalRoutes[parts[1]] : undefined;
}

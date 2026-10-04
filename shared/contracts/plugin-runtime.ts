export type PluginSource = 'official' | 'community' | 'system';
export type PluginPhase = 'activating' | 'running' | 'draining' | 'inactive' | 'failed' | 'cleanup-pending' | 'skipped';
export type PluginContributionKind = 'http' | 'operation' | 'socket' | 'page' | 'tab' | 'developmentSection' | 'job-retry' | 'jobs' | 'schedule' | 'event' | 'interceptor' | 'panel';
export type PluginInstanceView = {
  identity: string;
  source: PluginSource;
  pluginId: string;
  version: string;
  artifactDigest: string;
  generation: string;
  permissions: string[];
  desired: boolean;
  phase: PluginPhase;
  activationMs: number;
  error?: string;
  resourceId?: string;
  contributions?: ReadonlyArray<{ kind: PluginContributionKind; id: string; target: string }>;
};

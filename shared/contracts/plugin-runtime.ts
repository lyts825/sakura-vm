export type PluginSource = 'official' | 'community' | 'system';
export type PluginPhase = 'activating' | 'running' | 'draining' | 'inactive' | 'failed' | 'cleanup-pending' | 'skipped';
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
};

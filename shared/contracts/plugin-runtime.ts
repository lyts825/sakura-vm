/**
 * 模块职责：插件安装身份、运行代次、权限和贡献的公共快照类型，区分启用意图与实际生命周期阶段。
 */
export type PluginSource = 'official' | 'community' | 'system';
export type PluginPhase = 'activating' | 'running' | 'draining' | 'inactive' | 'failed' | 'cleanup-pending' | 'skipped';
export type PluginContributionKind = 'http' | 'operation' | 'socket' | 'page' | 'tab' | 'developmentSection' | 'job-retry' | 'jobs' | 'schedule' | 'event' | 'interceptor' | 'panel';
// identity 代表安装来源和插件；generation 表示此次激活的访问能力寿命，desired 仅表示用户启用意图。
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

/**
 * 模块职责（中文）：插件安装身份、运行代次、权限和贡献的公共快照类型，区分启用意图与实际生命周期阶段。
 * Module responsibility (English): plugin installation identities, permissions, activation generations and contributions.
 * 详细范围（中文）：公开入口包括 PluginSource, PluginPhase, PluginContributionKind, PluginInstanceView；职责覆盖插件安装身份、权限、激活代次和贡献视图，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include PluginSource, PluginPhase, PluginContributionKind, PluginInstanceView. The scope covers plugin installation identities, permissions, activation generations and contributions. Types, validation branches and cleanup paths define its data/behavior boundaries
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

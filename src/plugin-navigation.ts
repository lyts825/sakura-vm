/**
 * 模块职责（中文）：把插件贡献的页面、标签和开发分区转换为界面导航标签与所属插件信息。
 * Module responsibility (English): Mapping declared plugin contributions to navigation labels and ownership.
 * 详细范围（中文）：公开入口包括 pageLabels, tabLabels, sectionLabels, pluginNavigation；职责覆盖将已声明插件贡献映射为导航标签与归属，字段与行为边界由本文件类型、校验分支及清理流程共同定义
 * Detailed scope (English): Public entry points include pageLabels, tabLabels, sectionLabels, pluginNavigation. The scope covers Mapping declared plugin contributions to navigation labels and ownership. Types, validation branches and cleanup paths define its data/behavior boundaries
 */
import { PLUGINS, pluginSurfaceEnabled, type PluginRuntimeView } from '../shared/plugins';

export const pageLabels: Record<string, string> = {
  workspace: '工作空间',
  plugins: '插件中心',
  settings: '系统设置',
  images: '镜像库',
  tasks: '任务中心',
  library: '实例管理',
  features: '能力中心',
};
export const tabLabels: Record<string, string> = {
  terminal: '终端',
  desktop: '桌面',
  files: '文件',
  project: '项目',
  git: 'Git',
  development: '开发',
  containers: '容器',
  metrics: '资源',
  services: '服务',
  sync: '同步',
  snapshots: '快照',
  maintenance: '维护',
  config: '配置',
};
export const sectionLabels: Record<string, string> = {
  tools: '开发工具',
  network: '网络配置',
  secrets: '私密配置',
  commands: '收藏命令',
  pipelines: '流水线',
  runtimes: '版本',
};

/** The catalog owns availability; labels only name the shared surfaces. */
/**
 * 中文：合并基础标签和插件声明的页面/分区 ID，按当前启用或运行时贡献筛选；标签依次取基础名称、插件名称或原 ID。
 * English: Combine base labels with declared page/tab IDs, filter by current enablement/runtime contributions and label by base name, plugin name or original ID.
 * 中文：输入：active：签名所示 readonly string[] 业务值；kind：签名所示 'pages' | 'tabs' 业务值；runtime：签名所示 PluginRuntimeView 业务值
 * English: Inputs: active: the readonly string[] domain value in the signature; kind: the 'pages' | 'tabs' domain value in the signature; runtime: the PluginRuntimeView domain value in the signature
 */
export function pluginNavigation(active: readonly string[], kind: 'pages' | 'tabs', runtime?: PluginRuntimeView) {
  const labels = kind === 'pages' ? pageLabels : tabLabels;
  const ids = new Set([...Object.keys(labels), ...PLUGINS.flatMap((plugin) => plugin.contributes[kind])]);
  return [...ids]
    .filter((id) => pluginSurfaceEnabled(active, kind, id, runtime))
    .map((id) => ({
      id,
      label:
        labels[id] ||
        PLUGINS.find((plugin) => active.includes(plugin.id) && plugin.contributes[kind].includes(id))?.name ||
        id,
    }));
}

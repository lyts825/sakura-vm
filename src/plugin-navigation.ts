import { PLUGINS, pluginSurfaceEnabled } from '../shared/plugins';

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
export function pluginNavigation(active: readonly string[], kind: 'pages' | 'tabs') {
  const labels = kind === 'pages' ? pageLabels : tabLabels;
  const ids = new Set([...Object.keys(labels), ...PLUGINS.flatMap((plugin) => plugin.contributes[kind])]);
  return [...ids]
    .filter((id) => pluginSurfaceEnabled(active, kind, id))
    .map((id) => ({
      id,
      label:
        labels[id] ||
        PLUGINS.find((plugin) => active.includes(plugin.id) && plugin.contributes[kind].includes(id))?.name ||
        id,
    }));
}

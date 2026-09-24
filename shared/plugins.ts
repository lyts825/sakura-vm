/** The built-in plugin catalog is data only: importing it must never start a service. */
export type PluginManifest = {
  id: string;
  name: string;
  description: string;
  version: string;
  apiVersion: number;
  requires: string[];
  pages: string[];
  tabs: string[];
  experimental?: boolean;
};

const plugin = (
  id: string,
  name: string,
  description: string,
  requires: string[] = [],
  tabs: string[] = [],
  pages: string[] = [],
  experimental = false,
): PluginManifest => ({
  id,
  name,
  description,
  version: '0.1.0',
  apiVersion: 1,
  requires,
  tabs,
  pages,
  experimental,
});

export const PLUGINS: PluginManifest[] = [
  plugin('transfers', '传输基础', '为文件下载、磁盘导出和流水线产物提供传输与任务服务。'),
  plugin('files', '文件工作台', '文件浏览、上传下载、文本编辑、历史版本与回收站。', ['transfers'], ['files']),
  plugin('images', '发行版镜像', '按需下载并校验 Alpine、Debian 和 Ubuntu 官方镜像。', [], [], ['images']),
  plugin('terminal-workspace', '多终端工作区', '终端标签、分屏与 tmux 会话恢复。'),
  plugin(
    'snapshots',
    '磁盘快照',
    '离线快照、恢复、克隆以及独立磁盘包导入导出。',
    ['transfers'],
    ['snapshots'],
  ),
  plugin('backups', '备份策略', '定时备份、保留策略、加密备份与外部目录备份。', ['snapshots', 'secrets']),
  plugin('projects', '项目工作区', '多项目配置、开发模板、初始化命令与项目服务。', [], ['project']),
  plugin('environment', '环境互通', 'sakura.json 环境配方与 VS Code Remote-SSH 接入。', ['projects']),
  plugin(
    'development',
    '开发工具',
    '工具安装、项目搜索、代码检查、收藏命令、流水线与运行时版本。',
    ['projects', 'files'],
    ['development'],
  ),
  plugin('git', 'Git 工作台', '差异、暂存、提交、分支与远程仓库。', ['projects'], ['git']),
  plugin('containers', '容器工作台', 'Docker 与 Compose 项目操作。', ['projects'], ['containers']),
  plugin('sync', '目录同步', '主机与 Linux 双向同步、变更预览与冲突决策。', ['projects'], ['sync']),
  plugin('network', '网络管理', '端口转发、代理与软件源配置及网络诊断。', [], ['services', 'development']),
  plugin('secrets', '私密配置', '主机私密配置存储与项目环境变量引用。', [], ['development']),
  plugin(
    'monitoring',
    '资源与健康检查',
    '客户机实时资源采样与项目服务持续健康检查。',
    ['projects'],
    ['metrics'],
  ),
  plugin(
    'desktop',
    'Linux 图形桌面',
    '按需安装 KDE Plasma、浏览器桌面与中文输入法。',
    [],
    ['desktop'],
    [],
    true,
  ),
  plugin('library', '实例整理', '实例分组、标签、收藏与批量启停。', [], [], ['library']),
  plugin('maintenance', '磁盘与诊断', '故障诊断、磁盘扩容、空间检查与 QCOW2 整理。', [], ['maintenance']),
  plugin('migration', '数据目录迁移', '停机复制、校验并切换主机数据目录。'),
  plugin(
    'automation',
    '自动化与运维',
    '计划启停、告警、资源预设、软件包与开发任务。',
    ['projects'],
    [],
    ['features'],
  ),
  plugin(
    'extensions',
    '扩展能力适配器',
    '第二批能力检查与工程操作；外部依赖按实际可用性报告。',
    ['automation'],
    [],
    ['features'],
    true,
  ),
  plugin(
    'platform',
    '平台能力适配器',
    '远程、灾备、安全与协作能力的配置和检查适配器。',
    ['automation'],
    [],
    ['features'],
    true,
  ),
  plugin('command-palette', '快捷命令面板', '搜索已启用的功能、切换实例与执行收藏命令。'),
];

export type PluginPack = {
  id: string;
  name: string;
  description: string;
  version: string;
  plugins: { id: string; version: string }[];
};
const pack = (id: string, name: string, description: string, plugins: string[]): PluginPack => ({
  id,
  name,
  description,
  version: '0.1.0',
  plugins: plugins.map((id) => ({ id, version: '0.1.0' })),
});
export const PLUGIN_PACKS: PluginPack[] = [
  pack('essentials', '日常使用', '文件、快照、镜像与多终端，按需扩展基础 Linux 空间。', [
    'files',
    'snapshots',
    'images',
    'terminal-workspace',
  ]),
  pack('developer', '开发工作台', '项目、代码、Git、运行时与常用开发配套。', [
    'files',
    'projects',
    'environment',
    'development',
    'git',
    'network',
    'secrets',
    'terminal-workspace',
    'command-palette',
  ]),
  pack('operations', '运维与备份', '备份、同步、监控、诊断、实例整理与数据迁移。', [
    'backups',
    'sync',
    'monitoring',
    'maintenance',
    'library',
    'migration',
  ]),
  pack('desktop', '图形桌面', '图形 Linux 空间，配合文件和快照管理。', [
    'desktop',
    'files',
    'snapshots',
    'images',
  ]),
  pack('lab', '实验室', '显式启用自动化及两批实验性能力适配器。', [
    'automation',
    'extensions',
    'platform',
    'containers',
  ]),
  pack(
    'complete',
    '完整兼容',
    '恢复此前全部可选功能；包含实验能力和后台任务。',
    PLUGINS.map((item) => item.id),
  ),
];

export type PluginSelection = { schemaVersion: 1; plugins: string[]; packs: string[] };
export const emptySelection = (): PluginSelection => ({ schemaVersion: 1, plugins: [], packs: [] });

/** Resolve explicit roots and pack pins to one deterministic, dependency-first activation plan. */
export function resolvePlugins(
  selection: PluginSelection,
  catalog = PLUGINS,
  packs = PLUGIN_PACKS,
): string[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  if (byId.size !== catalog.length) throw new Error('插件标识重复');
  const packById = new Map(packs.map((item) => [item.id, item]));
  if (packById.size !== packs.length) throw new Error('整合包标识重复');
  const roots = new Set(selection.plugins);
  for (const id of selection.packs) {
    const bundle = packById.get(id);
    if (!bundle) throw new Error(`整合包不存在：${id}`);
    for (const pin of bundle.plugins) {
      if (byId.get(pin.id)?.version !== pin.version)
        throw new Error(`整合包 ${id} 的插件版本不匹配：${pin.id}@${pin.version}`);
      roots.add(pin.id);
    }
  }
  const visiting = new Set<string>(),
    visited = new Set<string>(),
    order: string[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`插件依赖循环：${[...visiting, id].join(' → ')}`);
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) throw new Error(`插件不存在：${id}`);
    if (item.apiVersion !== 1) throw new Error(`插件 API 版本不兼容：${id}`);
    visiting.add(id);
    for (const dependency of [...item.requires].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  for (const id of [...roots].sort()) visit(id);
  return order;
}

export function pluginSurfaceEnabled(active: readonly string[], kind: 'pages' | 'tabs', id: string) {
  if ((kind === 'pages' ? ['workspace', 'plugins', 'settings'] : ['terminal', 'config']).includes(id))
    return true;
  if (kind === 'pages' && id === 'tasks') return active.length > 0;
  return PLUGINS.some((item) => active.includes(item.id) && item[kind].includes(id));
}

export type PluginStatus = {
  selection: PluginSelection;
  active: string[];
  planned: string[];
  restartRequired: boolean;
  errors: Record<string, string>;
  plugins: PluginManifest[];
  packs: PluginPack[];
};

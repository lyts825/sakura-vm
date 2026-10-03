/**
 * The feature suite is intentionally kept separate from the VM record.  The
 * VM record is part of the portable bundle format, while these preferences are
 * host-local automation and observability state.
 */
export const featureCatalog = [
  ['image-import', '通用镜像导入', '实例与资源', 'P1', '支持 VHDX、VMDK、RAW、OVA 等格式的导入校验。'],
  ['golden-images', '黄金镜像制作', '实例与资源', 'P1', '将干净的实例固化为可复用模板。'],
  [
    'multi-arch',
    '多架构实例',
    '实例与资源',
    'P2',
    '使用 Debian 12 ARM64 镜像、QEMU virt 和 UEFI 固件创建并运行 aarch64 实例。',
  ],
  ['power-schedules', '开机与关机计划', '实例与资源', 'P0', '按本机时间自动启动或停止实例。'],
  ['idle-shutdown', '空闲自动暂停或关机', '实例与资源', 'P1', '连续空闲时自动释放实例资源。'],
  ['dynamic-memory', '动态内存目标', '实例与资源', 'P1', '通过 virtio-balloon 在运行中调整客户机内存目标。'],
  ['online-snapshots', '一致性在线快照', '实例与资源', 'P2', '通过文件系统冻结创建一致性快照。'],
  ['snapshot-diff', '快照时间线与差异', '实例与资源', 'P1', '比较快照的文件和磁盘变化。'],
  ['disk-maintenance', 'TRIM、压缩与稀疏回收', '实例与资源', 'P1', '计划执行客户机 TRIM 和磁盘整理。'],
  ['resource-presets', '资源预设与推荐', '实例与资源', 'P0', '按工作负载推荐 CPU、内存和磁盘。'],
  ['windows-mount', 'Windows 文件系统直挂', '文件与数据', 'P1', '通过受控 SSHFS 共享挂载宿主机目录。'],
  ['file-drop', '文件拖放与富剪贴板', '文件与数据', 'P1', '在宿主机与客户机间传递文件和图片。'],
  ['workspace-search', '全工作区全文搜索', '文件与数据', 'P0', '跨实例、项目和文件类型搜索内容。'],
  ['disk-analyzer', '可视化磁盘分析', '文件与数据', 'P0', '按目录和类型查看客户机磁盘占用。'],
  ['resumable-transfer', '可续传分块传输', '文件与数据', 'P1', '大文件传输支持断点续传和校验。'],
  ['three-way-sync', '三方同步合并', '文件与数据', 'P1', '基于共同基线合并两侧编辑。'],
  ['directory-history', '目录级版本时间线', '文件与数据', 'P1', '恢复整个目录而不只是一份文件。'],
  ['binary-preview', '二进制文件预览', '文件与数据', 'P0', '预览图片、PDF、CSV 和常见归档文件。'],
  ['language-services', 'LSP 语言服务', '开发工作台', 'P1', '提供补全、跳转、重命名和诊断。'],
  ['debug-adapter', 'DAP 调试器', '开发工作台', 'P2', '提供断点、单步、调用栈和变量查看。'],
  ['test-explorer', '测试资源管理器', '开发工作台', 'P1', '发现测试文件、运行测试并查看任务日志。'],
  ['format-lint', '格式化与代码检查', '开发工作台', 'P0', '统一执行格式化、Lint 和自动修复。'],
  ['git-worktrees', 'Git Worktree 管理', '开发工作台', 'P0', '创建和切换多个分支工作树。'],
  ['merge-editor', '三方合并编辑器', '开发工作台', 'P0', '图形化解决 Git 和同步冲突。'],
  ['dependency-report', '依赖图与更新报告', '开发工作台', 'P1', '显示依赖关系、过期包和升级建议。'],
  ['runtime-matrix', '更多运行时版本', '开发工作台', 'P1', '管理 Go、Java、.NET、PHP 等版本。'],
  ['package-manager', 'Linux 包管理器界面', '开发工作台', 'P0', '统一操作 apk、apt 并查看更新。'],
  ['reproducible-env', '可复现环境锁文件', '开发工作台', 'P1', '固定工具、包和运行时版本。'],
  ['dev-container', 'Dev Container 支持', '开发工作台', 'P1', '从 Dockerfile 或 devcontainer 配置创建环境。'],
  ['browser-preview', '浏览器预览与热重载', '开发工作台', 'P0', '发现项目端口并直接预览 Web 服务。'],
  ['database-presets', '数据库服务预设', '开发工作台', 'P1', '一键创建 PostgreSQL、Redis 等服务。'],
  ['ai-assistant', '隐私优先 AI 编程助手', '开发工作台', 'P2', '在脱敏后提供解释、测试和修复建议。'],
  ['port-discovery', '端口自动发现', '网络与服务', 'P0', '检测监听端口并生成转发建议。'],
  ['reverse-proxy', 'HTTPS 反向代理', '网络与服务', 'P1', '生成本地域名、证书和服务路由。'],
  ['network-profiles', '网络配置档案', '网络与服务', 'P1', '保存 NAT、DNS、代理和镜像源设置。'],
  ['vpn-integration', 'VPN 集成', '网络与服务', 'P1', '通过 WireGuard 管理客户机覆盖网络连接。'],
  ['network-diagnostics', '网络诊断工具箱', '网络与服务', 'P0', '执行 DNS、HTTPS、路由和端口测试。'],
  ['package-cache', '离线软件包缓存', '网络与服务', 'P1', '缓存常用软件源和项目依赖。'],
  ['service-dashboard', '服务运行面板', '网络与服务', 'P0', '集中查看依赖、日志和自动恢复状态。'],
  ['gpu-acceleration', 'GPU 与 3D 加速', '桌面与跨系统', 'P2', '支持 virtio-gpu 和 VirGL 等方案。'],
  ['audio-video', '音频与摄像头转发', '桌面与跨系统', 'P2', '让 Linux 图形应用使用宿主机设备。'],
  ['single-app-windows', '单应用 Linux 窗口', '桌面与跨系统', 'P2', '将 Linux GUI 应用集成到 Windows 桌面。'],
  ['process-interop', 'Windows 进程互操作', '桌面与跨系统', 'P2', '允许 Linux 命令调用受控的 Windows 程序。'],
  ['native-integration', '宿主机原生集成', '桌面与跨系统', 'P0', '在资源管理器或宿主编辑器中打开文件。'],
  ['multi-monitor', '多显示器与无障碍', '桌面与跨系统', 'P1', '保存分辨率、缩放和多屏布局。'],
  ['metrics-history', '历史资源指标', '运维与安全', 'P0', '保存 CPU、内存、磁盘和网络趋势。'],
  ['alerts', '阈值告警与通知中心', '运维与安全', 'P0', '对资源、服务、备份失败发送提醒。'],
  ['security-scan', '镜像与软件包安全扫描', '运维与安全', 'P1', '检查 CVE、弱配置和过期组件。'],
  [
    'rbac-sharing',
    '多用户与只读分享',
    '运维与安全',
    'P2',
    '可选账户模式提供管理员与限定实例的只读账户、短期会话令牌和按身份记录的写操作审计。',
  ],
  [
    'plugin-api',
    '插件 API 与自动化触发器',
    '运维与安全',
    'P1',
    '提供脱敏事件、定时触发、签名 Webhook，以及受限 JSON HTTP 操作与声明式扩展面板。',
  ],
] as const;

export const resourcePresets = {
  light: { name: '轻量命令行', memoryMiB: 512, cpus: 1 },
  development: { name: '日常开发', memoryMiB: 2048, cpus: 2 },
  build: { name: '编译构建', memoryMiB: 4096, cpus: 4 },
  desktop: { name: '图形桌面', memoryMiB: 2048, cpus: 2 },
} as const;
export type ResourcePresetId = keyof typeof resourcePresets;
export type ResourcePreset = (typeof resourcePresets)[ResourcePresetId];

export type FeatureId = (typeof featureCatalog)[number][0];
export type FeatureCatalogItem = {
  id: FeatureId;
  name: string;
  category: string;
  priority: string;
  summary: string;
  state: 'available' | 'experimental' | 'planned';
  implemented: boolean;
};

const availableFeatureIds = new Set<FeatureId>([
  'single-app-windows',
  'gpu-acceleration',
  'audio-video',
  'process-interop',
  'windows-mount',
  'image-import',
  'power-schedules',
  'idle-shutdown',
  'dynamic-memory',
  'test-explorer',
  'package-manager',
  'browser-preview',
  'database-presets',
  'port-discovery',
  'service-dashboard',
  'directory-history',
  'disk-analyzer',
  'format-lint',
  'workspace-search',
  'binary-preview',
  'three-way-sync',
  'merge-editor',
  'resumable-transfer',
  'file-drop',
  'git-worktrees',
  'resource-presets',
  'dependency-report',
  'runtime-matrix',
  'reproducible-env',
  'disk-maintenance',
  'metrics-history',
  'alerts',
  'network-diagnostics',
  'network-profiles',
  'reverse-proxy',
  'ai-assistant',
  'native-integration',
  'language-services',
  'debug-adapter',
  'multi-monitor',
  'golden-images',
  'multi-arch',
  'dev-container',
  'snapshot-diff',
  'online-snapshots',
  'package-cache',
  'security-scan',
  'vpn-integration',
  'rbac-sharing',
  'plugin-api',
]);
const partialFeatureIds = new Set<FeatureId>();

export const featureCatalogView = (): FeatureCatalogItem[] =>
  featureCatalog.map(([id, name, category, priority, summary]) => ({
    id,
    name,
    category,
    priority,
    summary,
    implemented: availableFeatureIds.has(id),
    state: availableFeatureIds.has(id) ? 'available' : partialFeatureIds.has(id) ? 'experimental' : 'planned',
  }));

/** The public catalog describes implemented entry points and planned work. */
export const implementedFeatureCatalogView = (): FeatureCatalogItem[] => featureCatalogView();

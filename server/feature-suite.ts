import { join } from 'node:path';
import { z } from 'zod';
import { DATA, AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs, type JobView } from './jobs.ts';
import type { HealthView } from './service-health.ts';
import { randomUUID } from 'node:crypto';
import { guestTask } from './guest-task.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';
import { distroInfo } from './images.ts';
import { envPrefix } from './project-services.ts';
import { privateLog, redactValues } from './secrets.ts';
import { CapabilityActions } from './capability-actions.ts';
import { requireSuccessfulResult, runEngineeringOperation } from './engineering-runner.ts';
import { capabilityViews, capabilityParameters, hasCapability } from './capability-definitions.ts';
import { inMaintenance } from './automation-policy.ts';
import { resourcePolicy } from './resource-policies.ts';
import { observeAvailability, type AvailabilitySpan } from './availability.ts';
import type { SecretRotationItem } from './secret-rotation.ts';
import { hostPower, powerPolicy, powerDecision, type PowerSample } from './power-policy.ts';

/**
 * The feature suite is intentionally kept separate from the VM record.  The
 * VM record is part of the portable bundle format, while these preferences are
 * host-local automation and observability state.
 */
export const featureCatalog = [
  ['image-import', '通用镜像导入', '实例与资源', 'P1', '支持 VHDX、VMDK、RAW、OVA 等格式的导入校验。'],
  ['golden-images', '黄金镜像制作', '实例与资源', 'P1', '将干净的实例固化为可复用模板。'],
  ['multi-arch', '多架构实例', '实例与资源', 'P2', '为 ARM64 等架构提供 QEMU 兼容运行入口。'],
  ['power-schedules', '开机与关机计划', '实例与资源', 'P0', '按本机时间自动启动或停止实例。'],
  ['idle-shutdown', '空闲自动暂停或关机', '实例与资源', 'P1', '连续空闲时自动释放实例资源。'],
  ['dynamic-memory', '动态内存目标', '实例与资源', 'P1', '通过 virtio-balloon 在运行中调整客户机内存目标。'],
  ['online-snapshots', '一致性在线快照', '实例与资源', 'P2', '通过文件系统冻结创建一致性快照。'],
  ['snapshot-diff', '快照时间线与差异', '实例与资源', 'P1', '比较快照的文件和磁盘变化。'],
  ['disk-maintenance', 'TRIM、压缩与稀疏回收', '实例与资源', 'P1', '计划执行客户机 TRIM 和磁盘整理。'],
  ['resource-presets', '资源预设与推荐', '实例与资源', 'P0', '按工作负载推荐 CPU、内存和磁盘。'],
  ['windows-mount', 'Windows 文件系统直挂', '文件与数据', 'P1', '通过受控共享挂载宿主机目录。'],
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
  ['vpn-integration', 'VPN 集成', '网络与服务', 'P1', '管理 WireGuard 或 Tailscale 连接。'],
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
  ['rbac-sharing', '多用户与只读分享', '运维与安全', 'P2', '提供角色、短期令牌和审计日志。'],
  ['plugin-api', '插件 API 与自动化触发器', '运维与安全', 'P1', '开放事件、定时任务、Webhook 和扩展面板。'],
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
  'ai-assistant',
  'native-integration',
  'golden-images',
]);
const partialFeatureIds = new Set<FeatureId>([
  'language-services',
  'merge-editor',
  'multi-monitor',
  'security-scan',
]);

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

const scheduleSchema = z
  .object({
    enabled: z.boolean().default(false),
    startAt: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    stopAt: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    idleMinutes: z.number().int().min(0).max(10080).default(0),
    idleAction: z.enum(['stop']).default('stop'),
  })
  .strict();
export type Schedule = z.infer<typeof scheduleSchema>;
const alertSchema = z
  .object({
    enabled: z.boolean().default(false),
    cpuPercent: z.number().min(0).max(100).default(90),
    memoryPercent: z.number().min(0).max(100).default(90),
    diskPercent: z.number().min(0).max(100).default(90),
    cooldownMinutes: z.number().int().min(1).max(10080).default(30),
    taskFailures: z.boolean().default(true),
    serviceFailures: z.boolean().default(true),
    secretRotation: z.boolean().default(true),
  })
  .strict();
export type AlertConfig = z.infer<typeof alertSchema>;
export type AlertEvent = {
  id: string;
  vmId: string;
  kind: 'cpu' | 'memory' | 'disk' | 'service' | 'backup' | 'task' | 'secret';
  message: string;
  createdAt: string;
  acknowledged: boolean;
  projectId?: string;
  jobId?: string;
};
export type MetricPoint = {
  sampledAt: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
  networkReceivedBytes?: number | null;
  networkTransmittedBytes?: number | null;
  networkReceiveBytesPerSecond?: number | null;
  networkTransmitBytesPerSecond?: number | null;
};
type FeatureState = {
  settings: Record<string, { schedule: Schedule; alerts: AlertConfig; updatedAt: string }>;
  history: Record<string, MetricPoint[]>;
  events: AlertEvent[];
  lastAlerts: Record<string, Record<string, number>>;
  notifiedJobs?: Record<string, string[]>;
  notifiedSecretRotations?: Record<string, Record<string, string>>;
  availability?: Record<string, AvailabilitySpan[]>;
  featureRuns: Record<
    string,
    Array<{ featureId: FeatureId; startedAt: string; finishedAt: string; result: Record<string, unknown> }>
  >;
};

const defaultState = (): FeatureState => ({
  settings: {},
  history: {},
  events: [],
  lastAlerts: {},
  featureRuns: {},
});

const defaultSchedule = (): Schedule => scheduleSchema.parse({});
const defaultAlerts = (): AlertConfig => alertSchema.parse({});
const packageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.:@/-]{0,127}$/, '软件包名称无效');
const searchText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !/[\x00-\x1f]/.test(v), '搜索内容包含控制字符');
const hostTarget = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, '目标地址无效');

export type FeatureAction =
  | { action: 'sample' }
  | { action: 'memory-target'; memoryMiB: number }
  | { action: 'apply-preset'; preset: ResourcePresetId }
  | { action: 'disk-analysis'; path?: string }
  | {
      action: 'dev';
      operation:
        | 'test'
        | 'test-discover'
        | 'lint'
        | 'format'
        | 'dependencies'
        | 'lock'
        | 'lock-check'
        | 'install-locked'
        | 'worktree-list'
        | 'worktree-add'
        | 'worktree-remove'
        | 'database';
      branch?: string;
      path?: string;
      database?: 'postgres' | 'redis' | 'mysql';
      name?: string;
      port?: number;
      password?: string;
    }
  | { action: 'search'; query: string; path?: string; content?: boolean }
  | { action: 'package'; operation: 'list' | 'search' | 'install' | 'remove' | 'update'; name?: string }
  | { action: 'network-test'; target: string }
  | { action: 'security-scan' }
  | { action: 'discover-ports' }
  | { action: 'acknowledge'; id: string }
  | { action: 'feature-check'; featureId: FeatureId }
  | { action: 'feature-run'; featureId: FeatureId; options?: Record<string, unknown> };

export class FeatureSuite {
  jobs = new Jobs('feature-suite');
  private stateValue?: FeatureState;
  private loading?: Promise<FeatureState>;
  private writes: Promise<void> = Promise.resolve();
  private backgroundEnabled = false;
  private closed = false;
  private idleSince = new Map<string, number>();
  private lastSampleAt = new Map<string, number>();
  private ticking = false;
  private powerAbort = new AbortController();

  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
    private observations: {
      jobs?: () => JobView[];
      services?: (id: string) => Array<HealthView & { projectId: string }>;
      secrets?: (id: string) => Promise<SecretRotationItem[] | undefined>;
      power?: (signal: AbortSignal) => Promise<PowerSample>;
    } = {},
  ) {}
  enableBackground() {
    if (this.powerAbort.signal.aborted) this.powerAbort = new AbortController();
    const controller = this.powerAbort;
    this.backgroundEnabled = true;
    return () => {
      if (this.powerAbort === controller) this.backgroundEnabled = false;
      controller.abort();
    };
  }
  private file() {
    return join(DATA, 'feature-suite.json');
  }
  private async state() {
    if (this.stateValue) return this.stateValue;
    return (this.loading ||= readStore(this.file(), defaultState)
      .then((state) => (this.stateValue = state))
      .finally(() => {
        this.loading = undefined;
      }));
  }
  private async save(state: FeatureState) {
    this.stateValue = state;
    const snapshot = structuredClone(state);
    const write = this.writes.catch(() => {}).then(() => writeStore(this.file(), snapshot));
    this.writes = write;
    await write;
  }
  private settingsFor(state: FeatureState, id: string) {
    const value = state.settings[id] || {
      schedule: defaultSchedule(),
      alerts: defaultAlerts(),
      updatedAt: new Date(0).toISOString(),
    };
    value.schedule = scheduleSchema.parse(value.schedule);
    value.alerts = alertSchema.parse(value.alerts);
    state.settings[id] = value;
    return value;
  }
  async catalog() {
    return {
      features: implementedFeatureCatalogView(),
      capabilities: capabilityViews('suite'),
      presets: resourcePresets,
      generatedAt: new Date().toISOString(),
    };
  }
  async alertEvents() {
    return structuredClone((await this.state()).events);
  }
  async view(id: string, limit = 120) {
    this.machines.get(id);
    const state = await this.state();
    state.featureRuns ||= {};
    const settings = this.settingsFor(state, id);
    const size = Number.isFinite(limit) ? Math.min(720, Math.max(1, Math.floor(limit))) : 120;
    return {
      projectId: this.workspaces.projects.current(id),
      settings,
      history: (state.history[id] || []).slice(-size),
      events: state.events
        .filter((event) => event.vmId === id)
        .slice(-500)
        .reverse(),
      job: this.jobs.view(`${this.workspaces.projects.key(id)}:package`),
      devJob: this.jobs.view(`${this.workspaces.projects.key(id)}:dev`),
      presets: resourcePresets,
      features: implementedFeatureCatalogView(),
      featureRuns: (state.featureRuns[id] || []).slice(-50).reverse(),
      capabilities: capabilityViews('suite'),
      capabilityJobs: this.jobs
        .list()
        .filter(
          (job) =>
            job.vmId === id &&
            (job.projectId || 'default') === this.workspaces.projects.current(id) &&
            job.action?.startsWith('capability:'),
        ),
    };
  }

  /** Record generic capability checks without claiming their named actions ran. */
  async feature(
    id: string,
    input: { featureId: FeatureId; action: 'check' | 'run'; options?: Record<string, unknown> },
    signal?: AbortSignal,
  ) {
    this.machines.get(id);
    const featureId = z
      .enum(featureCatalog.map(([value]) => value) as [FeatureId, ...FeatureId[]])
      .parse(input.featureId);
    const spec = featureCatalog.find(([value]) => value === featureId)!;
    if (hasCapability(featureId)) {
      const runner = new CapabilityActions(this.machines, this.workspaces);
      if (input.action === 'check') return runner.check(id, featureId, signal);
      this.machines.requireUnlocked(id);
      const parameters = capabilityParameters(featureId, input.options || {});
      return this.jobs.start(
        this.workspaces.projects.key(id) + ':capability:' + featureId,
        async (log, taskSignal, _update, saveResult) => {
          const result = await runner.run(id, featureId, parameters, taskSignal);
          await saveResult(result);
          log(JSON.stringify(result) + '\n');
          if (!result.ready) throw new AppError('能力执行失败', 409);
        },
        {
          vmId: id,
          projectId: this.workspaces.projects.current(id),
          title: spec[1],
          action: 'capability:' + featureId,
        },
      );
    }
    const startedAt = new Date().toISOString();
    const vm = this.machines.get(id);
    const result: Record<string, unknown> = {
      ready: false,
      executed: false,
      featureId,
      name: spec[1],
      category: spec[2],
      state: featureCatalogView().find((feature) => feature.id === featureId)?.state,
      implementation: 'catalog-context',
      reason: '此入口仅记录功能目录与基础环境信息；请使用对应插件的实际操作检查能力。',
      vmState: this.machines.state(id),
      options: input.options || {},
      checkedAt: new Date().toISOString(),
    };
    if (featureId === 'ai-assistant') {
      result.ready = true;
      result.reason =
        '系统设置 → 本地 AI 助手，连接本机 Ollama，审阅脱敏上下文后获取解释、测试或修复建议。需要已下载的本地模型。';
    } else if (featureId === 'golden-images') {
      result.ready = true;
      result.reason =
        '启用磁盘快照插件后，在实例 → 快照 → 黄金镜像库保存、校验和删除模板，并创建独立实例。镜像库页面也可管理所有模板。';
    } else if (featureId === 'disk-maintenance') {
      result.ready = true;
      result.reason = '已接入工作空间 → 维护；启用磁盘与诊断插件后可计划 TRIM、离线压缩和稀疏回收。';
    } else if (featureId === 'network-profiles') {
      result.ready = true;
      result.reason =
        '已接入工作空间 → 开发 → 网络配置：保存、加载 DNS、代理、镜像源与 NAT 端口档案，预览后应用，支持恢复原配置。';
    } else if (featureId === 'metrics-history' || featureId === 'alerts') {
      result.ready = true;
      result.reason = '已接入能力中心的资源趋势与通知中心；自动采样和告警需启用自动化调度插件。';
    } else if (featureId === 'gpu-acceleration') {
      result.accelerator = vm.accelerator;
      result.commandline = this.machines.commandline(id);
    } else if (featureId === 'multi-arch') {
      result.architecture = process.arch;
      result.qemu = true;
    } else if (featureId === 'online-snapshots' || featureId === 'snapshot-diff') {
      result.snapshots = vm.snapshots.length;
      result.consistency = this.machines.state(id) === 'running' ? 'qmp-coordinated' : 'offline';
    } else if (
      featureId === 'windows-mount' ||
      featureId === 'file-drop' ||
      featureId === 'resumable-transfer'
    ) {
      result.transfer = 'sftp-resumable';
    } else if (
      featureId === 'language-services' ||
      featureId === 'debug-adapter' ||
      featureId === 'dev-container'
    ) {
      result.adapter = 'workspace-tooling';
    } else if (featureId === 'reverse-proxy' || featureId === 'vpn-integration') {
      result.network = 'profile-backed';
    } else if (featureId === 'rbac-sharing' || featureId === 'plugin-api') {
      result.controlPlane = 'local-token-and-event-bus';
    }
    const state = await this.state();
    state.featureRuns ||= {};
    const history = (state.featureRuns[id] ||= []);
    history.push({ featureId, startedAt, finishedAt: new Date().toISOString(), result });
    while (history.length > 50) history.shift();
    await this.save(state);
    signal?.throwIfAborted();
    return result;
  }
  async update(id: string, input: unknown) {
    this.machines.get(id);
    const value = z
      .object({ schedule: scheduleSchema.optional(), alerts: alertSchema.optional() })
      .strict()
      .parse(input);
    const state = await this.state();
    const settings = this.settingsFor(state, id);
    if (value.schedule) {
      settings.schedule = value.schedule;
      this.idleSince.delete(id);
      this.lastSampleAt.delete(id);
    }
    if (value.alerts) settings.alerts = value.alerts;
    settings.updatedAt = new Date().toISOString();
    await this.save(state);
    return settings;
  }
  async sample(id: string) {
    const boot = this.machines.live?.get(id)?.startedAt;
    const point = await this.workspaces.metrics(id);
    if (boot !== this.machines.live?.get(id)?.startedAt)
      throw new AppError('实例已重启，本次采样已失效', 409);
    const state = await this.state();
    const history = (state.history[id] ||= []);
    if (history.some((entry) => entry.sampledAt === point.sampledAt)) return point;
    history.push({
      sampledAt: point.sampledAt,
      cpuPercent: point.cpuPercent,
      memoryUsed: point.memoryUsed,
      memoryTotal: point.memoryTotal,
      diskUsed: point.diskUsed,
      diskTotal: point.diskTotal,
      networkReceivedBytes: point.networkReceivedBytes,
      networkTransmittedBytes: point.networkTransmittedBytes,
      networkReceiveBytesPerSecond: point.networkReceiveBytesPerSecond,
      networkTransmitBytesPerSecond: point.networkTransmitBytesPerSecond,
    });
    while (history.length > 720) history.shift();
    await this.save(state);
    if (this.backgroundEnabled) await this.checkAlerts(id, point, state);
    return point;
  }
  async memoryTarget(id: string, memoryMiB: number) {
    const target = z.number().int().min(256).max(8192).parse(memoryMiB);
    return this.machines.setMemoryTarget(id, target);
  }
  async applyPreset(id: string, preset: ResourcePresetId) {
    const key = z.enum(['light', 'development', 'build', 'desktop']).parse(preset) as ResourcePresetId;
    const vm = this.machines.get(id);
    const target = resourcePresets[key];
    const distro = distroInfo(vm.distro);
    const minimumMemory = distro.minimumMemory;
    if (target.memoryMiB < minimumMemory)
      throw new AppError(`${target.name} 预设的内存低于 ${distro.name} 的最低要求（${minimumMemory} MiB）`);
    return this.machines.update(id, {
      name: vm.name,
      memoryMiB: target.memoryMiB,
      cpus: target.cpus,
      diskGiB: vm.diskGiB,
      accelerator: vm.accelerator,
      distro: vm.distro,
      template: vm.template,
      forwards: vm.forwards,
    });
  }
  async diskAnalysis(id: string, input: { path?: string }, signal?: AbortSignal) {
    this.machines.get(id);
    const path = guestPath(input.path || '/workspace');
    const result = await this.machines.exec(
      id,
      `set +e\ndu -x -k -d 2 ${quote(path)} 2>/dev/null | sort -nr | head -n 100`,
      30_000,
      signal,
    );
    if (result.code !== 0 && !result.stdout.trim())
      throw new AppError(result.stderr.trim() || '磁盘分析失败', 502);
    const entries = result.stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^(\d+)\s+(.+)$/))
      .filter((match): match is RegExpMatchArray => !!match)
      .map((match) => ({ path: match[2], bytes: Number(match[1]) * 1024 }))
      .filter((entry) => Number.isSafeInteger(entry.bytes) && entry.bytes >= 0);
    return { path, entries, checkedAt: new Date().toISOString() };
  }
  dev(id: string, input: Omit<Extract<FeatureAction, { action: 'dev' }>, 'action'>, signal?: AbortSignal) {
    const operation = z
      .enum([
        'test',
        'test-discover',
        'lint',
        'format',
        'dependencies',
        'lock',
        'lock-check',
        'install-locked',
        'worktree-list',
        'worktree-add',
        'worktree-remove',
        'database',
      ])
      .parse(input.operation);
    const branch = input.branch?.trim();
    const path = input.path?.trim();
    const database = input.database;
    if (operation === 'worktree-add' && (!branch || !/^(?!-)[A-Za-z0-9_./-]{1,128}$/.test(branch)))
      throw new AppError('分支名称无效');
    if (['worktree-add', 'worktree-remove'].includes(operation)) {
      if (
        !path ||
        path.startsWith('/') ||
        path.split('/').includes('..') ||
        !/^[A-Za-z0-9_./-]{1,160}$/.test(path)
      )
        throw new AppError('工作树路径必须是仓库内的相对路径');
    }
    if (operation === 'database') {
      if (!database) throw new AppError('请选择数据库类型');
      if (
        !input.password ||
        input.password.length < 12 ||
        input.password.length > 128 ||
        !/^[\x21-\x7e]+$/.test(input.password)
      )
        throw new AppError('数据库密码需要 12–128 个不含空格的可打印 ASCII 字符');
      if (input.name !== undefined && !/^[a-z][a-z0-9-]{0,31}$/.test(input.name.trim()))
        throw new AppError('数据库容器名称无效');
      if (
        input.port !== undefined &&
        (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)
      )
        throw new AppError('数据库端口需要在 1024–65535 之间');
    }
    const vm = this.machines.get(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:dev`,
      async (log, taskSignal, _update, saveResult) => {
        const combined = taskSignal && signal ? AbortSignal.any([taskSignal, signal]) : taskSignal;
        if (operation === 'lint' || operation === 'format') {
          const result = await new CapabilityActions(this.machines, this.workspaces).run(
            id,
            'format-lint',
            { mode: operation },
            combined,
          );
          await saveResult(result);
          log(JSON.stringify(result) + '\n');
          requireSuccessfulResult(result);
          return;
        }
        const project = await this.workspaces.resolvedConfig(id);
        const directory = quote(project.directory);
        const worktreePath = path ? quote(`${project.directory}/${path}`) : '';
        const environment = envPrefix(project.environment);
        let command: string;
        switch (operation) {
          case 'test':
            command = `cd ${directory}\nif [ -f package.json ]; then npm test; elif [ -f pyproject.toml ] || [ -f pytest.ini ]; then python3 -m pytest; elif [ -f Cargo.toml ]; then cargo test; elif [ -f go.mod ]; then go test ./...; else echo '没有识别到测试项目'; fi`;
            break;
          case 'test-discover':
            command = `cd ${directory}\nfind . -type d \( -name .git -o -name node_modules -o -name .venv -o -name target -o -name .worktrees \) -prune -o -type f \( -name '*.test.*' -o -name '*.spec.*' -o -name 'test_*.py' -o -name '*_test.py' -o -name '*_test.go' \) -print | head -n 300`;
            break;
          case 'dependencies':
            command = `cd ${directory}\nset +e\nprintf 'NODE\\n'; test ! -f package.json || npm outdated --json\nprintf 'PYTHON\\n'; command -v pip3 >/dev/null && pip3 list --outdated --format=json\nprintf 'RUST\\n'; test ! -f Cargo.toml || cargo tree --depth 1`;
            break;
          case 'lock':
            command = `cd ${directory}\nmkdir -p .sakura\nprintf '%s\\n' '# Generated by Sakura' "project=${project.directory}" "node=$(node --version 2>/dev/null || true)" "python=$(python3 --version 2>/dev/null || true)" "rust=$(rustc --version 2>/dev/null || true)" > .sakura/environment.lock\ncat .sakura/environment.lock`;
            break;
          case 'lock-check':
            command = `cd ${directory}\ntest -f .sakura/environment.lock || { echo '环境锁文件不存在，请先生成锁文件' >&2; exit 1; }\nsakura_lock=$(mktemp)\ntrap 'rm -f "$sakura_lock"' EXIT\nprintf '%s\\n' '# Generated by Sakura' "project=${project.directory}" "node=$(node --version 2>/dev/null || true)" "python=$(python3 --version 2>/dev/null || true)" "rust=$(rustc --version 2>/dev/null || true)" > "$sakura_lock"\ndiff -u .sakura/environment.lock "$sakura_lock"`;
            break;
          case 'install-locked':
            command = `cd ${directory}\nif [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; elif [ -f yarn.lock ] && command -v yarn >/dev/null; then yarn install --frozen-lockfile; elif [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null; then pnpm install --frozen-lockfile; elif [ -f requirements.txt ]; then python3 -m pip install -r requirements.txt; elif [ -f Cargo.lock ]; then cargo fetch --locked; elif [ -f go.sum ]; then go mod download; else echo '没有识别到受支持的锁文件' >&2; exit 1; fi`;
            break;
          case 'worktree-list':
            command = `cd ${directory}\ngit worktree list --porcelain`;
            break;
          case 'worktree-add':
            command = `cd ${directory}\ngit worktree add -- ${worktreePath} ${quote(branch!)}`;
            break;
          case 'worktree-remove':
            command = `cd ${directory}\ngit worktree remove -- ${worktreePath}`;
            break;
          case 'database': {
            const image =
              database === 'postgres'
                ? 'postgres:16-alpine'
                : database === 'redis'
                  ? 'redis:7-alpine'
                  : 'mysql:8';
            const container = input.name?.trim() || `sakura-${database}`;
            const settings =
              database === 'postgres'
                ? [`POSTGRES_USER=sakura`, `POSTGRES_DB=sakura`, `POSTGRES_PASSWORD=${input.password}`]
                : database === 'mysql'
                  ? [
                      `MYSQL_DATABASE=sakura`,
                      `MYSQL_USER=sakura`,
                      `MYSQL_PASSWORD=${input.password}`,
                      `MYSQL_ROOT_PASSWORD=${input.password}`,
                    ]
                  : [];
            const guestPort = database === 'postgres' ? 5432 : database === 'mysql' ? 3306 : 6379;
            const publishedPort = input.port || guestPort;
            const volumePath =
              database === 'redis'
                ? '/data'
                : database === 'postgres'
                  ? '/var/lib/postgresql/data'
                  : '/var/lib/mysql';
            const imageCommand =
              database === 'redis'
                ? ` redis-server --appendonly yes --requirepass ${quote(input.password!)}`
                : '';
            command = `if ! command -v docker >/dev/null; then echo '客户机尚未安装 Docker' >&2; exit 1; fi\nif docker container inspect ${quote(container)} >/dev/null 2>&1; then echo '同名数据库容器已存在' >&2; exit 1; fi\ndocker run -d --restart unless-stopped --label sakura.managed=database --name ${quote(container)} --publish ${quote(`127.0.0.1:${publishedPort}:${guestPort}`)} --volume ${quote(`${container}-data:${volumePath}`)} ${settings.map((value) => `--env ${quote(value)}`).join(' ')} ${image}${imageCommand}\nprintf '%s\\n' ${quote(`${container} 已启动 · 客户机 127.0.0.1:${publishedPort} · 数据卷 ${container}-data`)}`;
            break;
          }
        }
        const secrets = [input.password || '', ...Object.values(project.environment || {})];
        const output = privateLog(log, secrets);
        try {
          const result = await guestTask(
            this.machines,
            id,
            `${environment}\nset -eu\n${command}`,
            combined,
            output.write,
            600_000,
          );
          if (result.code !== 0)
            throw new AppError(
              redactValues(result.stderr.trim(), secrets) || `开发操作失败（${result.code}）`,
            );
        } catch (error) {
          throw new AppError(redactValues((error as Error).message, secrets));
        } finally {
          output.flush();
        }
      },
      {
        title: `开发工具 · ${operation}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `dev:${operation}`,
      },
    );
  }
  private async checkAlerts(id: string, point: MetricPoint, state: FeatureState) {
    const settings = this.settingsFor(state, id).alerts;
    if (!settings.enabled) return;
    const values: Array<[AlertEvent['kind'], number, number, string]> = [
      ['cpu', point.cpuPercent, settings.cpuPercent, `CPU 使用率超过 ${settings.cpuPercent}%`],
      [
        'memory',
        point.memoryTotal ? (point.memoryUsed / point.memoryTotal) * 100 : 0,
        settings.memoryPercent,
        `内存使用率超过 ${settings.memoryPercent}%`,
      ],
      [
        'disk',
        point.diskTotal ? (point.diskUsed / point.diskTotal) * 100 : 0,
        settings.diskPercent,
        `磁盘使用率超过 ${settings.diskPercent}%`,
      ],
    ];
    const previous = (state.lastAlerts[id] ||= {});
    let changed = false;
    for (const [kind, value, threshold, message] of values) {
      if (!Number.isFinite(value) || value < threshold) continue;
      const last = previous[kind] || 0;
      if (Date.now() - last < settings.cooldownMinutes * 60_000) continue;
      previous[kind] = Date.now();
      state.events.push({
        id: `${id}-${kind}-${Date.now()}`,
        vmId: id,
        kind,
        message,
        createdAt: new Date().toISOString(),
        acknowledged: false,
      });
      changed = true;
    }
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
    if (changed) await this.save(state);
  }
  private async checkOperationalAlerts(id: string, state: FeatureState) {
    const settings = this.settingsFor(state, id);
    if (!settings.alerts.enabled) return;
    const now = Date.now(),
      previous = (state.lastAlerts[id] ||= {});
    const jobs = this.observations.jobs?.().filter((job) => job.vmId === id) || [];
    state.notifiedJobs ||= {};
    const seen = new Set(state.notifiedJobs[id] || []);
    for (const job of jobs) {
      if (!job.id || seen.has(job.id) || !['error', 'interrupted'].includes(job.status)) continue;
      seen.add(job.id);
      const service = job.scope === 'health';
      if (
        !(service ? settings.alerts.serviceFailures : settings.alerts.taskFailures) ||
        !Number.isFinite(Date.parse(job.finishedAt || '')) ||
        Date.parse(job.finishedAt!) < Date.parse(settings.updatedAt)
      )
        continue;
      const kind = job.scope === 'backups' ? 'backup' : service ? 'service' : 'task';
      state.events.push({
        id: randomUUID(),
        vmId: id,
        kind,
        jobId: job.id,
        projectId: job.projectId,
        message: `${kind === 'backup' ? '备份' : kind === 'service' ? '服务' : '后台'}任务${job.status === 'interrupted' ? '中断' : '失败'}：${job.title || job.scope || '未命名任务'}，请查看任务详情。`,
        createdAt: new Date(now).toISOString(),
        acknowledged: false,
      });
    }
    state.notifiedJobs[id] = [...seen].slice(-10000);
    if (settings.alerts.secretRotation !== false) {
      const secrets = await this.observations.secrets?.(id);
      if (secrets) {
        state.notifiedSecretRotations ||= {};
        const notified = (state.notifiedSecretRotations[id] ||= {});
        for (const name of Object.keys(notified))
          if (!secrets.some((item) => item.name === name)) delete notified[name];
        for (const item of secrets) {
          if (!['due-soon', 'overdue'].includes(item.status)) continue;
          const key = `${item.lastChangedAt}:${item.dueAt}:${item.status}`;
          if (notified[item.name] === key) continue;
          notified[item.name] = key;
          state.events.push({
            id: randomUUID(),
            vmId: id,
            kind: 'secret',
            acknowledged: false,
            createdAt: new Date(now).toISOString(),
            message: `私密配置 ${item.name} ${item.status === 'overdue' ? '已到轮换期限' : '即将到轮换期限'}；请在开发设置中更新值。`,
          });
        }
      }
    }
    if (settings.alerts.serviceFailures)
      for (const service of this.observations.services?.(id) || []) {
        if (
          !service.desired ||
          !['unhealthy', 'exhausted', 'restarting'].includes(service.status) ||
          !service.checkedAt
        )
          continue;
        const key = `service:${service.projectId}:${service.name}`;
        if (now - (previous[key] || 0) < settings.alerts.cooldownMinutes * 60000) continue;
        previous[key] = now;
        state.events.push({
          id: randomUUID(),
          vmId: id,
          kind: 'service',
          projectId: service.projectId,
          message: `服务 ${service.name} ${service.status === 'exhausted' ? '已耗尽自动重启次数' : service.status === 'restarting' ? '健康检查失败，正在重启' : '健康检查失败'}。`,
          createdAt: new Date(now).toISOString(),
          acknowledged: false,
        });
      }
    if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
  }
  async acknowledge(id: string, eventId: string) {
    this.machines.get(id);
    const state = await this.state();
    const event = state.events.find((value) => value.vmId === id && value.id === eventId);
    if (!event) throw new AppError('告警不存在', 404);
    event.acknowledged = true;
    await this.save(state);
    return event;
  }
  async search(id: string, input: { query: string; path?: string; content?: boolean }, signal?: AbortSignal) {
    this.machines.get(id);
    const query = searchText.parse(input.query);
    const path = guestPath(input.path || '/workspace');
    const command =
      input.content === false
        ? `find ${quote(path)} -maxdepth 5 -type f -iname ${quote(`*${query}*`)} -print | head -n 200`
        : `if command -v rg >/dev/null; then rg -F -n --hidden --glob '!.git' --max-count 20 ${quote(query)} ${quote(path)} 2>/dev/null | head -n 200; else grep -RInF --exclude-dir=.git ${quote(query)} ${quote(path)} 2>/dev/null | head -n 200; fi`;
    const result = await this.machines.exec(id, command, 30_000, signal);
    if (result.code && !result.stdout.trim()) throw new AppError(result.stderr.trim() || '搜索失败', 502);
    return {
      query,
      path,
      content: input.content !== false,
      matches: result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 200),
    };
  }
  package(
    id: string,
    input: Omit<Extract<FeatureAction, { action: 'package' }>, 'action'>,
    signal?: AbortSignal,
  ) {
    const operation = z.enum(['list', 'search', 'install', 'remove', 'update']).parse(input.operation);
    const name = input.name ? packageName.parse(input.name) : undefined;
    if (['search', 'install', 'remove'].includes(operation) && !name)
      throw new AppError('此操作需要软件包名称');
    const vm = this.machines.get(id);
    const manager = vm.distro === 'alpine' ? 'apk' : 'apt-get';
    const command =
      manager === 'apk'
        ? {
            list: 'apk info',
            search: `apk search -v ${quote(name!)}`,
            install: `apk add --no-cache --timeout 30 ${quote(name!)}`,
            remove: `apk del ${quote(name!)}`,
            update: 'apk update',
          }[operation]
        : {
            list: "dpkg-query -W -f='${Package}\\t${Version}\\n'",
            search: `apt-cache search ${quote(name!)}`,
            install: `DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=2 install -y ${quote(name!)}`,
            remove: `DEBIAN_FRONTEND=noninteractive apt-get remove -y ${quote(name!)}`,
            update: 'apt-get update',
          }[operation];
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:package`,
      async (log, taskSignal) => {
        const combined = taskSignal && signal ? AbortSignal.any([taskSignal, signal]) : taskSignal;
        const result = await guestTask(this.machines, id, `set -eu\n${command}`, combined, log, 300_000);
        if (result.code !== 0) throw new AppError(result.stderr.trim() || `软件包操作失败（${result.code}）`);
      },
      {
        title: `软件包${{ list: '列表', search: '搜索', install: '安装', remove: '卸载', update: '更新' }[operation]}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `package:${operation}${name ? `:${name}` : ''}`,
      },
    );
  }
  async networkTest(id: string, target: string, signal?: AbortSignal) {
    const host = hostTarget.parse(target);
    const result = await runEngineeringOperation(
      this.machines,
      this.workspaces,
      id,
      'network-diagnostics',
      capabilityParameters('network-diagnostics', { target: host }),
      signal || new AbortController().signal,
    );
    return {
      target: host,
      output: JSON.stringify(result, null, 2),
      code: result.code,
    };
  }
  async discoverPorts(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(
      id,
      `(command -v ss >/dev/null && ss -ltnH) || (cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | awk '$4 == "0A" { split($2,a,":"); print a[2] }' | while read -r port; do printf 'LISTEN *:%d\\n' "0x$port"; done)`,
      15_000,
      signal,
    );
    const ports = new Set<number>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = line.match(/:(\d+)\s*$/);
      if (match) ports.add(Number(match[1]));
    }
    return { ports: [...ports].filter((port) => port > 0 && port < 65536).sort((a, b) => a - b) };
  }
  async securityScan(id: string, signal?: AbortSignal) {
    const result = await this.machines.exec(
      id,
      `set +e\nprintf 'IDENTITY\\n'; id\nprintf 'SSH\\n'; (sshd -T 2>/dev/null || true) | grep -E 'permitrootlogin|passwordauthentication|pubkeyauthentication'\nprintf 'UPDATES\\n'; if command -v apk >/dev/null; then apk version -l '<'; elif command -v apt-get >/dev/null; then apt list --upgradable 2>/dev/null | tail -n +2; fi\nprintf 'WORLD-WRITABLE\\n'; find /etc /usr/local/bin -xdev -type f -perm -0002 -print 2>/dev/null | head -n 50`,
      30_000,
      signal,
    );
    const output = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim();
    const findings = [
      ...(output.includes('passwordauthentication yes') ? ['SSH 允许密码认证'] : []),
      ...(output.includes('permitrootlogin yes') ? ['SSH 允许 root 密码登录'] : []),
      ...(output.split('UPDATES\n')[1]?.split('WORLD-WRITABLE\n')[0].trim() ? ['存在待更新的软件包'] : []),
      ...(output.split('WORLD-WRITABLE\n')[1]?.trim() ? ['发现可写系统文件'] : []),
    ];
    return { checkedAt: new Date().toISOString(), findings, output, code: result.code };
  }
  async action(id: string, input: unknown, signal?: AbortSignal) {
    const value = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('sample') }).strict(),
        z
          .object({ action: z.literal('memory-target'), memoryMiB: z.number().int().min(256).max(8192) })
          .strict(),
        z
          .object({
            action: z.literal('apply-preset'),
            preset: z.enum(['light', 'development', 'build', 'desktop']),
          })
          .strict(),
        z.object({ action: z.literal('disk-analysis'), path: z.string().optional() }).strict(),
        z
          .object({
            action: z.literal('dev'),
            operation: z.enum([
              'test',
              'test-discover',
              'lint',
              'format',
              'dependencies',
              'lock',
              'lock-check',
              'install-locked',
              'worktree-list',
              'worktree-add',
              'worktree-remove',
              'database',
            ]),
            branch: z.string().optional(),
            path: z.string().optional(),
            database: z.enum(['postgres', 'redis', 'mysql']).optional(),
            name: z.string().optional(),
            port: z.number().int().min(1024).max(65535).optional(),
            password: z.string().optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal('search'),
            query: z.string(),
            path: z.string().optional(),
            content: z.boolean().optional(),
          })
          .strict(),
        z
          .object({
            action: z.literal('package'),
            operation: z.enum(['list', 'search', 'install', 'remove', 'update']),
            name: z.string().optional(),
          })
          .strict(),
        z.object({ action: z.literal('network-test'), target: z.string() }).strict(),
        z.object({ action: z.literal('security-scan') }).strict(),
        z.object({ action: z.literal('discover-ports') }).strict(),
        z.object({ action: z.literal('acknowledge'), id: z.string().min(1).max(160) }).strict(),
        z
          .object({
            action: z.literal('feature-check'),
            featureId: z.enum(featureCatalog.map(([id]) => id) as [FeatureId, ...FeatureId[]]),
          })
          .strict(),
        z
          .object({
            action: z.literal('feature-run'),
            featureId: z.enum(featureCatalog.map(([id]) => id) as [FeatureId, ...FeatureId[]]),
            options: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      ])
      .parse(input) as FeatureAction;
    if (value.action === 'sample') return this.sample(id);
    if (value.action === 'memory-target') return this.memoryTarget(id, value.memoryMiB);
    if (value.action === 'apply-preset') return this.applyPreset(id, value.preset);
    if (value.action === 'disk-analysis') return this.diskAnalysis(id, value, signal);
    if (value.action === 'dev') return this.dev(id, value, signal);
    if (value.action === 'search') return this.search(id, value, signal);
    if (value.action === 'package') return this.package(id, value, signal);
    if (value.action === 'network-test') return this.networkTest(id, value.target, signal);
    if (value.action === 'security-scan') return this.securityScan(id, signal);
    if (value.action === 'discover-ports') return this.discoverPorts(id, signal);
    if (value.action === 'feature-check') return this.feature(id, { ...value, action: 'check' }, signal);
    if (value.action === 'feature-run') return this.feature(id, { ...value, action: 'run' }, signal);
    return this.acknowledge(id, value.id);
  }
  async tick() {
    if (this.closed || this.ticking) return;
    const signal = this.powerAbort.signal;
    if (signal.aborted) return;
    this.ticking = true;
    try {
      const state = await this.state();
      const now = new Date();
      const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const policy = await resourcePolicy();
      let powerSample: PowerSample | undefined;
      const scheduled = [...this.machines.records.values()].sort(
        (a, b) => (policy.priorities[b.id] || 0) - (policy.priorities[a.id] || 0),
      );
      for (const vm of scheduled) {
        if (this.closed || signal.aborted) break;
        const maintenance = await inMaintenance(vm.id, now);
        const settings = this.settingsFor(state, vm.id);
        if (this.backgroundEnabled) await this.checkOperationalAlerts(vm.id, state);
        const schedule = settings.schedule;
        let sampled = false;
        if (this.machines.state(vm.id) === 'running') {
          try {
            await this.sample(vm.id);
            sampled = true;
          } catch {
            /* Missing samples break the idle interval. */
          }
        }
        const point = state.history[vm.id]?.at(-1);
        const sampledAt = point ? Date.parse(point.sampledAt) : NaN;
        const previous = this.lastSampleAt.get(vm.id);
        const probeHealthy =
          sampled &&
          Number.isFinite(sampledAt) &&
          sampledAt <= Date.now() &&
          Date.now() - sampledAt < 120_000;
        const fresh = probeHealthy && (previous === undefined || sampledAt > previous);
        if (this.backgroundEnabled) {
          state.availability ||= {};
          const status = this.machines.state(vm.id);
          observeAvailability(
            (state.availability[vm.id] ||= []),
            status === 'running' && !probeHealthy ? 'unreachable' : status,
            Date.now(),
          );
        }
        if (
          !fresh ||
          !Number.isFinite(point?.cpuPercent) ||
          point!.cpuPercent >= 5 ||
          !schedule.enabled ||
          !schedule.idleMinutes
        ) {
          this.idleSince.delete(vm.id);
        } else {
          if (previous === undefined || sampledAt - previous > 120_000) this.idleSince.delete(vm.id);
          if (!this.idleSince.has(vm.id)) this.idleSince.set(vm.id, sampledAt);
        }
        if (fresh) this.lastSampleAt.set(vm.id, sampledAt);
        else this.lastSampleAt.delete(vm.id);
        if (maintenance) {
          this.idleSince.delete(vm.id);
          this.lastSampleAt.delete(vm.id);
          continue;
        }
        const electricity = await powerPolicy(vm.id);
        let allowStart = true;
        if (electricity.enabled) {
          powerSample ||= await (this.observations.power?.(signal) || hostPower(signal));
          if (this.closed || signal.aborted) break;
          const decision = powerDecision(electricity, powerSample);
          allowStart = decision.allowStart;
          if (decision.stop && this.machines.state(vm.id) === 'running') {
            await this.machines.stop(vm.id, false).catch(() => {});
            continue;
          }
        }
        if (this.closed || signal.aborted) break;
        if (!schedule.enabled) continue;
        if (allowStart && schedule.startAt === clock && this.machines.state(vm.id) === 'stopped')
          await this.machines.start(vm.id).catch(() => {});
        if (schedule.stopAt === clock && this.machines.state(vm.id) === 'running')
          await this.machines.stop(vm.id, false).catch(() => {});
        if (schedule.idleMinutes > 0 && this.machines.state(vm.id) === 'running') {
          const since = this.idleSince.get(vm.id);
          if (since !== undefined && sampledAt - since >= schedule.idleMinutes * 60_000) {
            await this.machines.stop(vm.id, false).catch(() => {});
            this.idleSince.delete(vm.id);
            this.lastSampleAt.delete(vm.id);
          }
        }
      }
      if (!this.closed && !signal.aborted) await this.save(state);
    } finally {
      this.ticking = false;
    }
  }
  async close() {
    this.closed = true;
    this.powerAbort.abort();
    this.backgroundEnabled = false;
    await this.jobs.close();
    await this.writes;
  }
}

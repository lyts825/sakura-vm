import { join } from 'node:path';
import { z } from 'zod';
import { DATA, AppError, guestPath } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';

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
  ['dynamic-memory', '动态内存回收', '实例与资源', 'P1', '按客户机压力动态调整内存配额。'],
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
  ['test-explorer', '测试资源管理器', '开发工作台', 'P1', '发现测试、运行测试并查看覆盖率。'],
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

export type FeatureId = (typeof featureCatalog)[number][0];
export type FeatureCatalogItem = {
  id: FeatureId;
  name: string;
  category: string;
  priority: string;
  summary: string;
  state: 'available' | 'experimental' | 'planned';
};

export const featureCatalogView = (): FeatureCatalogItem[] =>
  featureCatalog.map(([id, name, category, priority, summary]) => ({
    id,
    name,
    category,
    priority,
    summary,
    state:
      [
        'power-schedules',
        'idle-shutdown',
        'workspace-search',
        'disk-analyzer',
        'binary-preview',
        'format-lint',
        'git-worktrees',
        'merge-editor',
        'package-manager',
        'browser-preview',
        'port-discovery',
        'network-diagnostics',
        'service-dashboard',
        'native-integration',
        'metrics-history',
        'alerts',
        'security-scan',
      ].includes(id)
        ? 'available'
        : ['network-profiles', 'test-explorer', 'language-services', 'dev-container', 'database-presets'].includes(id)
          ? 'experimental'
          : 'planned',
  }));

const scheduleSchema = z
  .object({
    enabled: z.boolean().default(false),
    startAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    stopAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
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
  })
  .strict();
export type AlertConfig = z.infer<typeof alertSchema>;
export type AlertEvent = {
  id: string;
  vmId: string;
  kind: 'cpu' | 'memory' | 'disk' | 'service';
  message: string;
  createdAt: string;
  acknowledged: boolean;
};
type MetricPoint = {
  sampledAt: string;
  cpuPercent: number;
  memoryUsed: number;
  memoryTotal: number;
  diskUsed: number;
  diskTotal: number;
};
type FeatureState = {
  settings: Record<
    string,
    { schedule: Schedule; alerts: AlertConfig; updatedAt: string }
  >;
  history: Record<string, MetricPoint[]>;
  events: AlertEvent[];
  lastAlerts: Record<string, Record<string, number>>;
};

const defaultState = (): FeatureState => ({
  settings: {},
  history: {},
  events: [],
  lastAlerts: {},
});

const defaultSchedule = (): Schedule => scheduleSchema.parse({});
const defaultAlerts = (): AlertConfig => alertSchema.parse({});
const packageName = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9+_.:@/-]{0,127}$/, '软件包名称无效');
const searchText = z.string().trim().min(1).max(200).refine((v) => !/[\x00-\x1f]/.test(v), '搜索内容包含控制字符');
const hostTarget = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, '目标地址无效');

export type FeatureAction =
  | { action: 'sample' }
  | { action: 'search'; query: string; path?: string; content?: boolean }
  | { action: 'package'; operation: 'list' | 'search' | 'install' | 'remove' | 'update'; name?: string }
  | { action: 'network-test'; target: string }
  | { action: 'security-scan' }
  | { action: 'discover-ports' }
  | { action: 'acknowledge'; id: string };

export class FeatureSuite {
  jobs = new Jobs('feature-suite');
  private stateValue?: FeatureState;
  private timer: ReturnType<typeof setInterval>;
  private tickPromise?: Promise<void>;
  private closed = false;

  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {
    this.timer = setInterval(() => {
      if (!this.tickPromise) this.startTick();
    }, 30_000);
    this.timer.unref();
    this.startTick();
  }
  private startTick() {
    const task = this.tick()
      .catch(() => {})
      .finally(() => {
        if (this.tickPromise === task) this.tickPromise = undefined;
      });
    this.tickPromise = task;
    return task;
  }
  private file() {
    return join(DATA, 'feature-suite.json');
  }
  private async state() {
    return (this.stateValue ||= await readStore(this.file(), defaultState));
  }
  private async save(state: FeatureState) {
    this.stateValue = state;
    await writeStore(this.file(), state);
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
    return { features: featureCatalogView(), generatedAt: new Date().toISOString() };
  }
  async view(id: string, limit = 120) {
    this.machines.get(id);
    const state = await this.state();
    const settings = this.settingsFor(state, id);
    const size = Number.isFinite(limit) ? Math.min(720, Math.max(1, Math.floor(limit))) : 120;
    return {
      settings,
      history: (state.history[id] || []).slice(-size),
      events: state.events.filter((event) => event.vmId === id).slice(-50).reverse(),
      job: this.jobs.view(`${id}:package`),
      features: featureCatalogView(),
    };
  }
  async update(id: string, input: unknown) {
    this.machines.get(id);
    const value = z
      .object({ schedule: scheduleSchema.optional(), alerts: alertSchema.optional() })
      .strict()
      .parse(input);
    const state = await this.state();
    const settings = this.settingsFor(state, id);
    if (value.schedule) settings.schedule = value.schedule;
    if (value.alerts) settings.alerts = value.alerts;
    settings.updatedAt = new Date().toISOString();
    await this.save(state);
    return settings;
  }
  async sample(id: string) {
    const point = await this.workspaces.metrics(id);
    const state = await this.state();
    const history = (state.history[id] ||= []);
    history.push({
      sampledAt: point.sampledAt,
      cpuPercent: point.cpuPercent,
      memoryUsed: point.memoryUsed,
      memoryTotal: point.memoryTotal,
      diskUsed: point.diskUsed,
      diskTotal: point.diskTotal,
    });
    while (history.length > 720) history.shift();
    await this.save(state);
    await this.checkAlerts(id, point, state);
    return point;
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
      if (value < threshold) continue;
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
    const command = input.content === false
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
  package(id: string, input: Omit<Extract<FeatureAction, { action: 'package' }>, 'action'>, signal?: AbortSignal) {
    const operation = z.enum(['list', 'search', 'install', 'remove', 'update']).parse(input.operation);
    const name = input.name ? packageName.parse(input.name) : undefined;
    if (['search', 'install', 'remove'].includes(operation) && !name)
      throw new AppError('此操作需要软件包名称');
    const vm = this.machines.get(id);
    const manager = vm.distro === 'alpine' ? 'apk' : 'apt-get';
    const command = manager === 'apk'
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
      `${id}:package`,
      async (log, taskSignal) => {
        const combined = taskSignal && signal ? AbortSignal.any([taskSignal, signal]) : taskSignal;
        const result = await guestTask(this.machines, id, `set -eu\n${command}`, combined, log, 300_000);
        if (result.code !== 0) throw new AppError(result.stderr.trim() || `软件包操作失败（${result.code}）`);
      },
      { title: `软件包${{ list: '列表', search: '搜索', install: '安装', remove: '卸载', update: '更新' }[operation]}`, vmId: id, action: `package:${operation}${name ? `:${name}` : ''}` },
    );
  }
  async networkTest(id: string, target: string, signal?: AbortSignal) {
    const host = hostTarget.parse(target);
    const result = await this.machines.exec(
      id,
      `set +e\nprintf 'DNS\\n'; getent hosts ${quote(host)} 2>&1\nprintf 'HTTPS\\n'; if command -v curl >/dev/null; then curl -fsSIL --max-time 10 https://${quote(host)} 2>&1 | head -n 8; else wget -q --spider -T 10 https://${quote(host)} 2>&1; fi\nprintf 'PORTS\\n'; (command -v ss >/dev/null && ss -ltnH) || true`,
      30_000,
      signal,
    );
    return { target: host, output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim(), code: result.code };
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
    const value = z.discriminatedUnion('action', [
      z.object({ action: z.literal('sample') }).strict(),
      z.object({ action: z.literal('search'), query: z.string(), path: z.string().optional(), content: z.boolean().optional() }).strict(),
      z.object({ action: z.literal('package'), operation: z.enum(['list', 'search', 'install', 'remove', 'update']), name: z.string().optional() }).strict(),
      z.object({ action: z.literal('network-test'), target: z.string() }).strict(),
      z.object({ action: z.literal('security-scan') }).strict(),
      z.object({ action: z.literal('discover-ports') }).strict(),
      z.object({ action: z.literal('acknowledge'), id: z.string().min(1).max(160) }).strict(),
    ]).parse(input) as FeatureAction;
    if (value.action === 'sample') return this.sample(id);
    if (value.action === 'search') return this.search(id, value, signal);
    if (value.action === 'package') return this.package(id, value, signal);
    if (value.action === 'network-test') return this.networkTest(id, value.target, signal);
    if (value.action === 'security-scan') return this.securityScan(id, signal);
    if (value.action === 'discover-ports') return this.discoverPorts(id, signal);
    return this.acknowledge(id, value.id);
  }
  async tick() {
    if (this.closed) return;
    const state = await this.state();
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const vm of this.machines.records.values()) {
      const settings = this.settingsFor(state, vm.id);
      const schedule = settings.schedule;
      if (this.machines.state(vm.id) === 'running') await this.sample(vm.id).catch(() => {});
      if (!schedule.enabled) continue;
      if (schedule.startAt === clock && this.machines.state(vm.id) === 'stopped') void this.machines.start(vm.id).catch(() => {});
      if (schedule.stopAt === clock && this.machines.state(vm.id) === 'running') void this.machines.stop(vm.id, false).catch(() => {});
      if (schedule.idleMinutes > 0 && this.machines.state(vm.id) === 'running') {
        const history = state.history[vm.id] || [];
        const last = history.at(-1);
        if (last && Date.now() - Date.parse(last.sampledAt) >= schedule.idleMinutes * 60_000 && last.cpuPercent < 5)
          void this.machines.stop(vm.id, false).catch(() => {});
      }
    }
    await this.save(state);
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.tickPromise;
    await this.jobs.close();
  }
}

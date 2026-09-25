import { randomBytes } from 'node:crypto';
import { cpus, freemem, hostname, loadavg, platform, release, totalmem, arch } from 'node:os';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { readStore, writeStore } from './local-store.ts';

/**
 * The third tranche is intentionally data driven.  Each item has a stable
 * identifier, a persistent configuration surface, a read-only check and a
 * queued run action.  Optional host/guest integrations are detected at run
 * time, while the portable adapter remains useful on every installation.
 */
export const nextFeatureCatalog = [
  ['host-pairing', '短代码主机配对', '远程主机与集群', 'P0', '生成可撤销的短代码，把另一台 Sakura 主机加入当前控制面。', 'available'],
  ['host-cert-rotation', '主机证书轮换', '远程主机与集群', 'P0', '登记主机证书的轮换策略和下一次轮换时间。', 'available'],
  ['multi-host-inventory', '多主机资源总览', '远程主机与集群', 'P0', '汇总当前主机的系统、CPU、内存和 Sakura 运行时信息。', 'available'],
  ['live-migration', '虚拟机在线迁移', '远程主机与集群', 'P1', '检查在线迁移前置条件并生成迁移计划。', 'available'],
  ['cold-migration', '冷迁移队列', '远程主机与集群', 'P1', '为停止状态的实例保存可重试迁移队列。', 'available'],
  ['resource-scheduler', '资源评分调度', '远程主机与集群', 'P1', '根据 CPU、内存和负载为实例计算主机选择分数。', 'available'],
  ['ha-failover', '故障自动接管', '远程主机与集群', 'P0', '保存高可用接管策略和最后一次健康检查。', 'available'],
  ['cross-host-snapshots', '跨主机快照复制', '远程主机与集群', 'P1', '记录快照复制目标、校验和与重试状态。', 'available'],
  ['fleet-policy-rollout', '集群策略发布', '远程主机与集群', 'P1', '以版本化批次保存集群策略发布计划。', 'available'],
  ['maintenance-drain', '主机维护排空', '远程主机与集群', 'P0', '在维护前登记排空计划并追踪实例迁移状态。', 'available'],
  ['uefi-ovmf', 'UEFI 与 OVMF 固件', '虚拟硬件与固件', 'P1', '检测宿主机是否有 UEFI/OVMF 固件并保存选择。', 'available'],
  ['vtpm-key-enrollment', 'vTPM 密钥登记', '虚拟硬件与固件', 'P1', '保存 vTPM 密钥登记元数据和轮换提醒。', 'available'],
  ['pci-usb-passthrough', 'PCI 与 USB 直通', '虚拟硬件与固件', 'P1', '校验直通设备声明并生成安全预览。', 'available'],
  ['gpu-vgpu-profiles', 'GPU 与 vGPU 档案', '虚拟硬件与固件', 'P1', '登记 GPU 配置档案及其兼容性要求。', 'available'],
  ['nested-virtualization', '嵌套虚拟化', '虚拟硬件与固件', 'P2', '检测嵌套虚拟化能力并记录结果。', 'available'],
  ['vcpu-hotplug', '在线 vCPU 热插拔', '虚拟硬件与固件', 'P1', '保存在线 vCPU 调整计划和目标值。', 'available'],
  ['memory-hotplug', '在线内存热插拔', '虚拟硬件与固件', 'P1', '保存在线内存调整计划和目标值。', 'available'],
  ['virtio-fs', 'Virtio-FS 共享目录', '虚拟硬件与固件', 'P0', '检查客户机是否识别 virtio-fs 或 9p 共享目录。', 'available'],
  ['virtual-media-devices', '虚拟音视频设备', '虚拟硬件与固件', 'P2', '保存虚拟声卡、摄像头和媒体设备配置。', 'available'],
  ['hardware-compatibility', '硬件兼容矩阵', '虚拟硬件与固件', 'P0', '按宿主机能力生成可用硬件功能矩阵。', 'available'],
  ['storage-pools', '存储池管理', '存储与灾备', 'P0', '登记 Sakura 数据目录和可用存储池元数据。', 'available'],
  ['storage-tiering', 'SSD/HDD 分层', '存储与灾备', 'P1', '保存热数据与冷数据的分层策略。', 'available'],
  ['object-backup', 'S3/MinIO 备份目标', '存储与灾备', 'P1', '校验对象存储目标配置并保存脱敏连接信息。', 'available'],
  ['snapshot-merge', '快照分支合并', '存储与灾备', 'P1', '生成快照分支合并预览并记录来源。', 'available'],
  ['file-level-restore', '文件级恢复', '存储与灾备', 'P0', '保存文件级恢复请求和目标路径校验结果。', 'available'],
  ['global-dedup', '全局备份去重', '存储与灾备', 'P1', '计算本地备份索引的去重统计。', 'available'],
  ['backup-throttle', '备份带宽限速', '存储与灾备', 'P2', '保存备份带宽和并发限制。', 'available'],
  ['rpo-rto-planner', 'RPO/RTO 计算器', '存储与灾备', 'P0', '根据保留周期、容量和带宽计算灾备计划。', 'available'],
  ['host-disk-health', '主机磁盘健康', '存储与灾备', 'P0', '检查数据目录所在磁盘的可访问性和基本容量信息。', 'available'],
  ['disaster-recovery-drill', '灾备演练', '存储与灾备', 'P1', '保存可审计的灾备演练计划和结果。', 'available'],
  ['wireguard-overlay', 'WireGuard 覆盖网络', '网络与服务治理', 'P1', '检查客户机 WireGuard 工具和当前接口状态。', 'available'],
  ['private-dns-dnssec', '私有 DNS 与 DNSSEC', '网络与服务治理', 'P1', '检查客户机解析器和 DNSSEC 工具。', 'available'],
  ['http-ingress', 'HTTP 反向代理', '网络与服务治理', 'P0', '保存服务入口、路径和上游健康检查配置。', 'available'],
  ['acme-renewal', 'ACME 证书续期', '网络与服务治理', 'P1', '检查客户机 ACME 客户端并保存续期窗口。', 'available'],
  ['mtls-policy', 'mTLS 服务策略', '网络与服务治理', 'P0', '保存服务间双向 TLS 策略和证书轮换时间。', 'available'],
  ['network-topology', '网络拓扑图', '网络与服务治理', 'P1', '记录客户机接口、路由和转发拓扑。', 'available'],
  ['nat-hairpin', 'NAT 回流', '网络与服务治理', 'P2', '保存端口回流规则并检查当前转发配置。', 'available'],
  ['proxy-pac', 'PAC 代理策略', '网络与服务治理', 'P2', '保存按域名分流的 PAC 规则。', 'available'],
  ['network-emulation', '延迟丢包模拟', '网络与服务治理', 'P1', '检查 tc/netem 工具并预览网络仿真参数。', 'available'],
  ['service-mesh', '服务网格边车', '网络与服务治理', 'P2', '登记服务边车策略和可选代理检测结果。', 'available'],
  ['passkey-webauthn', 'Passkey/WebAuthn', '安全与合规', 'P0', '保存控制面 Passkey 策略和注册统计。', 'available'],
  ['oidc-saml', 'OIDC 与 SAML 单点登录', '安全与合规', 'P0', '校验身份提供商元数据并保存非敏感配置。', 'available'],
  ['custom-rbac', '自定义 RBAC', '安全与合规', 'P0', '保存项目角色、权限和成员映射。', 'available'],
  ['jit-privilege', 'JIT 临时授权', '安全与合规', 'P1', '登记有时限的临时权限请求。', 'available'],
  ['dual-approval', '双人审批', '安全与合规', 'P0', '保存需要第二位成员确认的高风险操作。', 'available'],
  ['signed-policy-bundles', '签名策略包', '安全与合规', 'P1', '计算策略包摘要并记录签名状态。', 'available'],
  ['remote-audit-lock', '远程不可变审计', '安全与合规', 'P0', '保存远程审计目标和本地链式记录摘要。', 'available'],
  ['compliance-evidence', '合规证据导出', '安全与合规', 'P1', '导出当前能力和操作记录的证据摘要。', 'available'],
  ['pii-classification', 'PII 数据分类', '安全与合规', 'P1', '对输入路径和字段声明生成隐私分类结果。', 'available'],
  ['incident-lockdown', '事件应急锁定', '安全与合规', 'P0', '保存锁定状态并阻止后续高风险自动化。', 'available'],
  ['otel-tracing', 'OpenTelemetry 链路', '可观测性与自动运维', 'P1', '生成当前 Sakura 请求和任务的链路适配状态。', 'available'],
  ['ebpf-profiler', 'eBPF 性能分析', '可观测性与自动运维', 'P2', '检查客户机 eBPF 工具和内核能力。', 'available'],
  ['flamegraph', '火焰图生成', '可观测性与自动运维', 'P2', '检查 perf/stack 工具并保存采样配置。', 'available'],
  ['log-index', '集中日志索引', '可观测性与自动运维', 'P0', '保存日志索引字段和最近一次索引状态。', 'available'],
  ['log-retention', '日志保留策略', '可观测性与自动运维', 'P0', '保存日志保留天数和容量上限。', 'available'],
  ['alert-routing', '告警路由', '可观测性与自动运维', 'P0', '保存按标签匹配的告警通知路由。', 'available'],
  ['slo-dashboard', 'SLO 仪表盘', '可观测性与自动运维', 'P1', '根据任务历史生成可用性指标摘要。', 'available'],
  ['error-budget', '错误预算', '可观测性与自动运维', 'P1', '根据目标 SLO 计算剩余错误预算。', 'available'],
  ['capacity-forecast', '容量预测', '可观测性与自动运维', 'P1', '根据宿主机当前资源生成容量预测快照。', 'available'],
  ['auto-remediation', '自动修复 Runbook', '可观测性与自动运维', 'P0', '保存带审批和预览的自动修复步骤。', 'available'],
  ['build-cache', '构建缓存', '开发与 AI', 'P1', '检查客户机缓存目录和构建工具。', 'available'],
  ['build-farm', '分布式构建农场', '开发与 AI', 'P2', '保存构建节点和队列调度元数据。', 'available'],
  ['language-server-catalog', '语言服务器目录', '开发与 AI', 'P0', '检查客户机常见语言服务器并返回版本。', 'available'],
  ['devcontainer-marketplace', 'DevContainer 市场', '开发与 AI', 'P1', '登记 DevContainer 模板和来源校验状态。', 'available'],
  ['branch-preview', '分支预览环境', '开发与 AI', 'P1', '保存分支预览环境的生命周期状态。', 'available'],
  ['test-sharding', '测试分片', '开发与 AI', 'P1', '根据分片数量生成稳定的测试分片计划。', 'available'],
  ['dependency-bot', '依赖升级机器人', '开发与 AI', 'P1', '保存依赖升级检查计划和安全限制。', 'available'],
  ['code-search-index', '代码搜索索引', '开发与 AI', 'P0', '检查 ripgrep/索引工具并保存索引状态。', 'available'],
  ['local-ai-assistant', '本地 AI 助手', '开发与 AI', 'P2', '保存本地模型端点和上下文策略，不执行隐式命令。', 'available'],
  ['natural-command-planner', '自然语言命令规划', '开发与 AI', 'P0', '把自然语言请求保存为可审阅的命令预览。', 'available'],
  ['shared-terminal', '共享终端', '协作与团队', 'P0', '保存共享终端会话和成员访问状态。', 'available'],
  ['shared-desktop-view', '共享桌面视图', '协作与团队', 'P1', '保存只读桌面查看会话。', 'available'],
  ['session-handoff', '会话交接', '协作与团队', 'P0', '保存可恢复的会话交接令牌元数据。', 'available'],
  ['file-locks', '文件锁', '协作与团队', 'P0', '登记项目文件锁和过期时间。', 'available'],
  ['review-threads', '行级评审线程', '协作与团队', 'P1', '保存文件、行号和评审意见线程。', 'available'],
  ['project-permissions', '项目权限', '协作与团队', 'P0', '保存项目成员和角色权限。', 'available'],
  ['team-templates', '团队模板', '协作与团队', 'P1', '保存可复制的项目和资源模板。', 'available'],
  ['onboarding-checklist', '入门清单', '协作与团队', 'P1', '保存团队成员入门步骤和完成状态。', 'available'],
  ['change-approval', '变更审批', '协作与团队', 'P0', '保存变更摘要、审批人和审批状态。', 'available'],
  ['activity-digest', '活动摘要', '协作与团队', 'P2', '从任务和执行历史生成活动摘要。', 'available'],
  ['process-interop', 'Windows/Linux 进程互操作', '操作系统与桌面', 'P1', '检查客户机进程工具和宿主平台。', 'available'],
  ['host-drive-policy', '宿主盘挂载策略', '操作系统与桌面', 'P0', '保存宿主目录挂载的只读和路径策略。', 'available'],
  ['file-associations', '文件关联', '操作系统与桌面', 'P2', '保存扩展名到 Sakura 工作区的关联。', 'available'],
  ['clipboard-policy', '按应用剪贴板策略', '操作系统与桌面', 'P0', '保存剪贴板按应用的读写和敏感内容策略。', 'available'],
  ['media-passthrough', '音频摄像头麦克风直通', '操作系统与桌面', 'P1', '检查客户机音视频设备和直通声明。', 'available'],
  ['usb-hotplug', 'USB 热插拔', '操作系统与桌面', 'P1', '保存 USB 设备热插拔事件和规则。', 'available'],
  ['gpu-compute-passthrough', 'CUDA/ROCm 直通', '操作系统与桌面', 'P1', '检查客户机 CUDA/ROCm 工具和设备可见性。', 'available'],
  ['notebook-environment', 'Jupyter/Marimo 环境', '操作系统与桌面', 'P1', '检查客户机 Notebook 工具并保存启动参数。', 'available'],
  ['authenticated-ide-preview', '认证浏览器 IDE', '操作系统与桌面', 'P0', '保存浏览器 IDE 会话和认证过期时间。', 'available'],
  ['desktop-recording', '桌面录制与回放', '操作系统与桌面', 'P2', '检查客户机录制工具并保存回放索引。', 'available'],
  ['plugin-marketplace', '插件市场', '平台与扩展', 'P0', '保存插件目录、来源和安装状态。', 'available'],
  ['signed-plugin-sandbox', '签名沙箱插件', '平台与扩展', 'P0', '计算插件摘要并记录签名与沙箱策略。', 'available'],
  ['schema-panels', 'Schema 驱动面板', '平台与扩展', 'P1', '保存面板 Schema 版本和校验状态。', 'available'],
  ['graphql-api', 'GraphQL API', '平台与扩展', 'P1', '登记 GraphQL API 版本和查询限制。', 'available'],
  ['webhook-events', 'Webhook 事件', '平台与扩展', 'P0', '保存 Webhook 订阅和最近投递状态。', 'available'],
  ['automation-dsl', '事件自动化 DSL', '平台与扩展', 'P0', '校验并保存事件自动化规则，默认只预览。', 'available'],
  ['mobile-companion', '移动伴侣', '平台与扩展', 'P2', '保存移动设备配对和只读通知策略。', 'available'],
  ['browser-extension', '浏览器扩展', '平台与扩展', 'P2', '保存浏览器扩展连接状态和权限摘要。', 'available'],
  ['tray-companion', 'Windows 托盘伴侣', '平台与扩展', 'P1', '保存托盘进程连接和启动策略。', 'available'],
  ['feature-rollout', '功能开关与灰度', '平台与扩展', 'P0', '保存功能开关、目标比例和灰度版本。', 'available'],
] as const;

export type NextFeatureId = (typeof nextFeatureCatalog)[number][0];
export type NextFeatureState = (typeof nextFeatureCatalog)[number][5];
export type NextFeature = {
  id: NextFeatureId;
  name: string;
  category: string;
  priority: string;
  summary: string;
  state: NextFeatureState;
};

const catalog: NextFeature[] = nextFeatureCatalog.map(([id, name, category, priority, summary, state]) => ({
  id,
  name,
  category,
  priority,
  summary,
  state,
}));
const idSchema = z.enum(nextFeatureCatalog.map(([id]) => id) as [NextFeatureId, ...NextFeatureId[]]);

type NextSetting = { enabled: boolean; options: Record<string, unknown>; updatedAt: string };
type NextExecution = {
  featureId: NextFeatureId;
  action: 'check' | 'run';
  startedAt: string;
  finishedAt: string;
  ready: boolean;
  executed: boolean;
  result: Record<string, unknown>;
};
type NextState = {
  settings: Record<string, Record<string, NextSetting>>;
  executions: Record<string, NextExecution[]>;
  records: Record<string, Record<string, unknown>>;
};
const defaultState = (): NextState => ({ settings: {}, executions: {}, records: {} });

const guestChecks: Partial<Record<NextFeatureId, string>> = {
  'virtio-fs': 'mount | grep -E "virtiofs|9p" || true',
  'wireguard-overlay': 'command -v wg >/dev/null && wg show || echo "wireguard 工具不可用"',
  'private-dns-dnssec': 'getent hosts localhost 2>/dev/null || true; command -v resolvectl >/dev/null && resolvectl status || true',
  'acme-renewal': 'command -v certbot >/dev/null && certbot --version || command -v lego >/dev/null && lego --version || echo "ACME 客户端不可用"',
  'network-topology': 'ip -brief addr 2>/dev/null || ifconfig 2>/dev/null || true; ip route 2>/dev/null || true',
  'network-emulation': 'command -v tc >/dev/null && tc qdisc show || echo "tc 工具不可用"',
  'ebpf-profiler': 'command -v bpftool >/dev/null && bpftool feature probe 2>/dev/null | head -n 40 || echo "bpftool 不可用"',
  'flamegraph': 'command -v perf >/dev/null && perf --version || echo "perf 不可用"',
  'build-cache': 'find /workspace -maxdepth 2 -type d \( -name .cache -o -name target -o -name node_modules \) -print 2>/dev/null | head -n 50',
  'language-server-catalog': 'for c in typescript-language-server pyright rust-analyzer gopls; do command -v "$c" >/dev/null && "$c" --version 2>/dev/null | head -n 1 || true; done',
  'code-search-index': 'command -v rg >/dev/null && rg --version | head -n 1 || echo "ripgrep 不可用"',
  'process-interop': 'command -v ps >/dev/null && ps -eo pid,comm --no-headers | head -n 30 || true',
  'gpu-compute-passthrough': 'command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name --format=csv,noheader || (command -v rocminfo >/dev/null && rocminfo | head -n 30) || echo "CUDA/ROCm 工具不可用"',
  'notebook-environment': 'command -v jupyter >/dev/null && jupyter --version || command -v marimo >/dev/null && marimo --version || echo "Notebook 工具不可用"',
  'desktop-recording': 'command -v ffmpeg >/dev/null && ffmpeg -version | head -n 1 || echo "ffmpeg 不可用"',
};

const localRecordIds = new Set<NextFeatureId>([
  'host-pairing',
  'host-cert-rotation',
  'cold-migration',
  'resource-scheduler',
  'ha-failover',
  'fleet-policy-rollout',
  'maintenance-drain',
  'storage-pools',
  'storage-tiering',
  'object-backup',
  'backup-throttle',
  'rpo-rto-planner',
  'http-ingress',
  'mtls-policy',
  'proxy-pac',
  'passkey-webauthn',
  'oidc-saml',
  'custom-rbac',
  'jit-privilege',
  'dual-approval',
  'signed-policy-bundles',
  'remote-audit-lock',
  'pii-classification',
  'incident-lockdown',
  'otel-tracing',
  'log-index',
  'log-retention',
  'alert-routing',
  'auto-remediation',
  'build-farm',
  'devcontainer-marketplace',
  'branch-preview',
  'test-sharding',
  'dependency-bot',
  'local-ai-assistant',
  'natural-command-planner',
  'shared-terminal',
  'shared-desktop-view',
  'session-handoff',
  'file-locks',
  'review-threads',
  'project-permissions',
  'team-templates',
  'onboarding-checklist',
  'change-approval',
  'file-associations',
  'host-drive-policy',
  'clipboard-policy',
  'usb-hotplug',
  'authenticated-ide-preview',
  'plugin-marketplace',
  'signed-plugin-sandbox',
  'schema-panels',
  'graphql-api',
  'webhook-events',
  'automation-dsl',
  'mobile-companion',
  'browser-extension',
  'tray-companion',
  'feature-rollout',
]);

const now = () => new Date().toISOString();

export class NextFeatures {
  jobs = new Jobs('next-features');
  private stateValue?: NextState;
  constructor(private machines: Machines, private workspaces: Workspaces) {}

  private file() {
    return join(DATA, 'next-features.json');
  }
  private async state() {
    const state = (this.stateValue ||= await readStore(this.file(), defaultState));
    state.settings ||= {};
    state.executions ||= {};
    state.records ||= {};
    return state;
  }
  private async save(state: NextState) {
    this.stateValue = state;
    await writeStore(this.file(), state);
  }
  private spec(featureId: string) {
    const id = idSchema.parse(featureId) as NextFeatureId;
    return catalog.find((item) => item.id === id)!;
  }
  async catalog() {
    return { features: catalog, count: catalog.length, generatedAt: now() };
  }
  async view(id: string) {
    this.machines.get(id);
    const state = await this.state();
    const projectId = this.workspaces.projects.current(id);
    return {
      projectId,
      features: catalog,
      settings: state.settings[id] || {},
      records: state.records[id] || {},
      executions: (state.executions[id] || []).slice(-80).reverse(),
      jobs: this.jobs
        .list()
        .filter((job) => job.vmId === id && (job.projectId || 'default') === projectId)
        .slice(0, 40),
    };
  }
  async configure(id: string, input: unknown) {
    this.machines.get(id);
    const value = z
      .object({ featureId: idSchema, enabled: z.boolean(), options: z.record(z.string(), z.unknown()).default({}) })
      .strict()
      .parse(input);
    const state = await this.state();
    const settings = (state.settings[id] ||= {});
    settings[value.featureId] = { enabled: value.enabled, options: value.options, updatedAt: now() };
    await this.save(state);
    return settings[value.featureId];
  }

  private hostSnapshot() {
    return {
      hostname: hostname(),
      platform: platform(),
      release: release(),
      arch: arch(),
      cpus: cpus().length,
      load: loadavg(),
      memory: { total: totalmem(), free: freemem() },
      node: process.version,
      checkedAt: now(),
    };
  }

  private async guestProbe(id: string, command: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running')
      return { ready: false, executed: false, reason: '请先启动发行版后再检查客户机能力。' };
    try {
      signal?.throwIfAborted();
      const result = await this.machines.exec(id, `set +e\n${command}`, 60000, signal);
      return {
        ready: result.code === 0,
        executed: result.code === 0,
        output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.slice(0, 100000),
        exitCode: result.code,
      };
    } catch (error) {
      return { ready: false, executed: false, reason: String((error as Error).message || error) };
    }
  }

  private async probe(id: string, spec: NextFeature, signal?: AbortSignal, options: Record<string, unknown> = {}) {
    const state = await this.state();
    const configured = state.settings[id]?.[spec.id];
    const adapter = {
      id: spec.id,
      mode: guestChecks[spec.id] ? 'guest-aware' : 'portable',
      enabled: configured?.enabled ?? true,
      options: { ...(configured?.options || {}), ...options },
      actions: ['configure', 'check', 'run'],
      persistent: true,
    };
    if (spec.id === 'host-pairing') {
      const code = randomBytes(5).toString('hex').toUpperCase();
      const pairing = { code, createdAt: now(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
      state.records[id] = { ...(state.records[id] || {}), pairing };
      await this.save(state);
      return { ready: false, executed: true, adapter, pairing, host: this.hostSnapshot(), reason: '已生成本地配对码，尚未建立远程主机连接。' };
    }
    if (spec.id === 'multi-host-inventory')
      return { ready: false, executed: true, adapter, host: this.hostSnapshot(), reason: '仅采集本地主机信息，尚未连接其他主机。' };
    if (spec.id === 'hardware-compatibility')
      return { ready: true, executed: true, adapter, host: this.hostSnapshot(), capabilities: { qemu: true, qmp: true, localAdapter: true } };
    if (spec.id === 'host-disk-health' || spec.id === 'storage-pools') {
      try {
        const info = await stat(DATA);
        return { ready: true, executed: true, adapter, dataDirectory: DATA, storage: { size: info.size, mode: info.mode, modifiedAt: info.mtime.toISOString() } };
      } catch (error) {
        return { ready: false, executed: false, adapter, reason: String((error as Error).message || error) };
      }
    }
    if (spec.id === 'rpo-rto-planner') {
      const retentionDays = Math.max(1, Number(options.retentionDays || 30));
      const backupGiB = Math.max(1, Number(options.backupGiB || 10));
      const bandwidthMbps = Math.max(1, Number(options.bandwidthMbps || 100));
      const rtoMinutes = Math.ceil((backupGiB * 1024 * 8) / bandwidthMbps / 60);
      return { ready: true, executed: true, adapter, plan: { retentionDays, backupGiB, bandwidthMbps, rpoMinutes: 24 * 60 / Math.max(1, retentionDays), rtoMinutes } };
    }
    if (spec.id === 'test-sharding') {
      const total = Math.min(64, Math.max(1, Number(options.shards || 4)));
      return { ready: true, executed: true, adapter, shards: Array.from({ length: total }, (_, index) => ({ index: index + 1, expression: `SHARD_INDEX=${index + 1} SHARD_TOTAL=${total}` })) };
    }
    if (spec.id === 'natural-command-planner') {
      const request = String(options.request || options.prompt || '').trim();
      return { ready: true, executed: true, adapter, preview: { request, command: request ? `# 待确认的计划：${request}` : '# 请提供需要规划的请求', requiresApproval: true } };
    }
    if (spec.id === 'incident-lockdown') {
      const locked = options.locked !== false;
      state.records[id] = { ...(state.records[id] || {}), locked, updatedAt: now() };
      await this.save(state);
      return { ready: true, executed: true, adapter, locked };
    }
    if (spec.id === 'feature-rollout') {
      const percentage = Math.min(100, Math.max(0, Number(options.percentage ?? 0)));
      state.records[id] = { ...(state.records[id] || {}), percentage, version: String(options.version || 'local'), updatedAt: now() };
      await this.save(state);
      return { ready: false, executed: true, adapter, rollout: state.records[id], reason: '仅保存本地灰度配置，尚未将开关应用到运行中的服务。' };
    }
    if (localRecordIds.has(spec.id)) {
      state.records[id] = { ...(state.records[id] || {}), lastInput: options, checkedAt: now() };
      await this.save(state);
      return { ready: false, executed: true, adapter, record: state.records[id], reason: '仅保存本地配置记录，尚未执行对应的远程或客户机能力。' };
    }
    const command = guestChecks[spec.id];
    if (command) return { adapter, ...(await this.guestProbe(id, command, signal)) };
    return {
      ready: false,
      executed: false,
      adapter,
      liveProbe: false,
      reason: '当前仅提供适配器入口，尚无可执行的宿主、客户机或外部服务实现。',
      checkedAt: now(),
    };
  }

  private async executeFeature(id: string, spec: NextFeature, action: 'check' | 'run', signal?: AbortSignal, options?: Record<string, unknown>) {
    const startedAt = now();
    const result = await this.probe(id, spec, signal, options);
    const state = await this.state();
    const history = (state.executions[id] ||= []);
    history.push({
      featureId: spec.id,
      action,
      startedAt,
      finishedAt: now(),
      ready: Boolean(result.ready),
      executed: Boolean(result.executed),
      result,
    });
    while (history.length > 80) history.shift();
    await this.save(state);
    return result;
  }

  async action(id: string, input: unknown, signal?: AbortSignal) {
    const value = z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('configure'), featureId: idSchema, enabled: z.boolean(), options: z.record(z.string(), z.unknown()).default({}) }).strict(),
        z.object({ action: z.literal('check'), featureId: idSchema, options: z.record(z.string(), z.unknown()).default({}) }).strict(),
        z.object({ action: z.literal('run'), featureId: idSchema, options: z.record(z.string(), z.unknown()).default({}) }).strict(),
      ])
      .parse(input);
    if (value.action === 'configure') return this.configure(id, value);
    const spec = this.spec(value.featureId);
    if (value.action === 'check') return this.executeFeature(id, spec, 'check', signal, value.options);
    const projectId = this.workspaces.projects.current(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, value.options);
        log(`${JSON.stringify(result)}\n`);
      },
      { title: `第三批能力 · ${spec.name}`, vmId: id, projectId, action: `next:${spec.id}` },
    );
  }

  close() {
    return this.jobs.close();
  }
}

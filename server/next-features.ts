import { cpus, freemem, hostname, loadavg, platform, release, totalmem, arch } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import { CapabilityActions } from './capability-actions.ts';
import { capabilityViews, capabilityParameters, hasCapability } from './capability-definitions.ts';

/**
 * The third tranche is intentionally data driven.  Each item has a stable
 * identifier, a persistent configuration surface, a read-only check and a
 * queued run action.  Optional host/guest integrations are detected at run
 * time. Planned functionality never claims readiness from stored configuration.
 */
export const nextFeatureCatalog = [
  [
    'host-pairing',
    '短代码主机配对',
    '远程主机与集群',
    'P0',
    '生成可撤销的短代码，把另一台 Sakura 主机加入当前控制面。',
    'planned',
  ],
  [
    'host-cert-rotation',
    '主机证书轮换',
    '远程主机与集群',
    'P0',
    '登记主机证书的轮换策略和下一次轮换时间。',
    'planned',
  ],
  [
    'multi-host-inventory',
    '多主机资源总览',
    '远程主机与集群',
    'P0',
    '汇总当前主机的系统、CPU、内存和 Sakura 运行时信息。',
    'experimental',
  ],
  [
    'live-migration',
    '虚拟机在线迁移',
    '远程主机与集群',
    'P1',
    '检查在线迁移前置条件并生成迁移计划。',
    'planned',
  ],
  ['cold-migration', '冷迁移队列', '远程主机与集群', 'P1', '为停止状态的实例保存可重试迁移队列。', 'planned'],
  [
    'resource-scheduler',
    '资源评分调度',
    '远程主机与集群',
    'P1',
    '根据 CPU、内存和负载为实例计算主机选择分数。',
    'planned',
  ],
  [
    'ha-failover',
    '故障自动接管',
    '远程主机与集群',
    'P0',
    '保存高可用接管策略和最后一次健康检查。',
    'planned',
  ],
  [
    'cross-host-snapshots',
    '跨主机快照复制',
    '远程主机与集群',
    'P1',
    '记录快照复制目标、校验和与重试状态。',
    'planned',
  ],
  [
    'fleet-policy-rollout',
    '集群策略发布',
    '远程主机与集群',
    'P1',
    '以版本化批次保存集群策略发布计划。',
    'planned',
  ],
  [
    'maintenance-drain',
    '主机维护排空',
    '远程主机与集群',
    'P0',
    '在维护前登记排空计划并追踪实例迁移状态。',
    'planned',
  ],
  [
    'uefi-ovmf',
    'UEFI 与 OVMF 固件',
    '虚拟硬件与固件',
    'P1',
    '检测宿主机是否有 UEFI/OVMF 固件并保存选择。',
    'planned',
  ],
  [
    'vtpm-key-enrollment',
    'vTPM 密钥登记',
    '虚拟硬件与固件',
    'P1',
    '保存 vTPM 密钥登记元数据和轮换提醒。',
    'planned',
  ],
  [
    'pci-usb-passthrough',
    'PCI 与 USB 直通',
    '虚拟硬件与固件',
    'P1',
    '校验直通设备声明并生成安全预览。',
    'planned',
  ],
  [
    'gpu-vgpu-profiles',
    'GPU 与 vGPU 档案',
    '虚拟硬件与固件',
    'P1',
    '登记 GPU 配置档案及其兼容性要求。',
    'planned',
  ],
  [
    'nested-virtualization',
    '嵌套虚拟化',
    '虚拟硬件与固件',
    'P2',
    '检测嵌套虚拟化能力并记录结果。',
    'planned',
  ],
  [
    'vcpu-hotplug',
    '在线 vCPU 热插拔',
    '虚拟硬件与固件',
    'P1',
    '保存在线 vCPU 调整计划和目标值。',
    'experimental',
  ],
  ['memory-hotplug', '在线内存热插拔', '虚拟硬件与固件', 'P1', '保存在线内存调整计划和目标值。', 'available'],
  [
    'virtio-fs',
    'Virtio-FS 共享目录',
    '虚拟硬件与固件',
    'P0',
    '检查客户机是否识别 virtio-fs 或 9p 共享目录。',
    'planned',
  ],
  [
    'virtual-media-devices',
    '虚拟音视频设备',
    '虚拟硬件与固件',
    'P2',
    '保存虚拟声卡、摄像头和媒体设备配置。',
    'planned',
  ],
  [
    'hardware-compatibility',
    '硬件兼容矩阵',
    '虚拟硬件与固件',
    'P0',
    '按宿主机能力生成可用硬件功能矩阵。',
    'experimental',
  ],
  [
    'storage-pools',
    '存储池管理',
    '存储与灾备',
    'P0',
    '登记 Sakura 数据目录和可用存储池元数据。',
    'experimental',
  ],
  ['storage-tiering', 'SSD/HDD 分层', '存储与灾备', 'P1', '保存热数据与冷数据的分层策略。', 'planned'],
  [
    'object-backup',
    'S3/MinIO 备份目标',
    '存储与灾备',
    'P1',
    '校验对象存储目标配置并保存脱敏连接信息。',
    'planned',
  ],
  ['snapshot-merge', '快照分支合并', '存储与灾备', 'P1', '生成快照分支合并预览并记录来源。', 'planned'],
  [
    'file-level-restore',
    '文件级恢复',
    '存储与灾备',
    'P0',
    '保存文件级恢复请求和目标路径校验结果。',
    'planned',
  ],
  [
    'global-dedup',
    '全局备份去重',
    '存储与灾备',
    'P1',
    '复用跨实例备份内容块，统计实际占用并清理无引用块。',
    'available',
  ],
  [
    'backup-throttle',
    '备份带宽限速',
    '存储与灾备',
    'P2',
    '限制备份输出速率；每个实例串行备份。',
    'available',
  ],
  [
    'rpo-rto-planner',
    'RPO/RTO 计算器',
    '存储与灾备',
    'P0',
    '根据保留周期、容量和带宽计算灾备计划。',
    'available',
  ],
  [
    'host-disk-health',
    '主机磁盘健康',
    '存储与灾备',
    'P0',
    '检查数据目录所在磁盘的可访问性和基本容量信息。',
    'available',
  ],
  ['disaster-recovery-drill', '灾备演练', '存储与灾备', 'P1', '保存可审计的灾备演练计划和结果。', 'planned'],
  [
    'wireguard-overlay',
    'WireGuard 覆盖网络',
    '网络与服务治理',
    'P1',
    '检查客户机 WireGuard 工具和当前接口状态。',
    'planned',
  ],
  [
    'private-dns-dnssec',
    '私有 DNS 与 DNSSEC',
    '网络与服务治理',
    'P1',
    '检查客户机解析器和 DNSSEC 工具。',
    'planned',
  ],
  [
    'http-ingress',
    'HTTP 反向代理',
    '网络与服务治理',
    'P0',
    '保存服务入口、路径和上游健康检查配置。',
    'planned',
  ],
  [
    'acme-renewal',
    'ACME 证书续期',
    '网络与服务治理',
    'P1',
    '检查客户机 ACME 客户端并保存续期窗口。',
    'planned',
  ],
  [
    'mtls-policy',
    'mTLS 服务策略',
    '网络与服务治理',
    'P0',
    '保存服务间双向 TLS 策略和证书轮换时间。',
    'planned',
  ],
  ['network-topology', '网络拓扑图', '网络与服务治理', 'P1', '记录客户机接口、路由和转发拓扑。', 'available'],
  ['nat-hairpin', 'NAT 回流', '网络与服务治理', 'P2', '保存端口回流规则并检查当前转发配置。', 'planned'],
  ['proxy-pac', 'PAC 代理策略', '网络与服务治理', 'P2', '保存按域名分流的 PAC 规则。', 'available'],
  [
    'network-emulation',
    '延迟丢包模拟',
    '网络与服务治理',
    'P1',
    '检查 tc/netem 工具并预览网络仿真参数。',
    'planned',
  ],
  ['service-mesh', '服务网格边车', '网络与服务治理', 'P2', '登记服务边车策略和可选代理检测结果。', 'planned'],
  [
    'passkey-webauthn',
    'Passkey/WebAuthn',
    '安全与合规',
    'P0',
    '保存控制面 Passkey 策略和注册统计。',
    'planned',
  ],
  [
    'oidc-saml',
    'OIDC 与 SAML 单点登录',
    '安全与合规',
    'P0',
    '校验身份提供商元数据并保存非敏感配置。',
    'planned',
  ],
  ['custom-rbac', '自定义 RBAC', '安全与合规', 'P0', '保存项目角色、权限和成员映射。', 'planned'],
  ['jit-privilege', 'JIT 临时授权', '安全与合规', 'P1', '登记有时限的临时权限请求。', 'planned'],
  ['dual-approval', '双人审批', '安全与合规', 'P0', '保存需要第二位成员确认的高风险操作。', 'planned'],
  ['signed-policy-bundles', '签名策略包', '安全与合规', 'P1', '计算策略包摘要并记录签名状态。', 'planned'],
  [
    'remote-audit-lock',
    '远程不可变审计',
    '安全与合规',
    'P0',
    '保存远程审计目标和本地链式记录摘要。',
    'planned',
  ],
  [
    'compliance-evidence',
    '合规证据导出',
    '安全与合规',
    'P1',
    '导出当前能力和操作记录的证据摘要。',
    'available',
  ],
  [
    'pii-classification',
    'PII 数据分类',
    '安全与合规',
    'P1',
    '对输入路径和字段声明生成隐私分类结果。',
    'available',
  ],
  [
    'incident-lockdown',
    '事件应急锁定',
    '安全与合规',
    'P0',
    '保存锁定状态并阻止后续高风险自动化。',
    'available',
  ],
  [
    'otel-tracing',
    'OpenTelemetry 链路',
    '可观测性与自动运维',
    'P1',
    '生成当前 Sakura 请求和任务的链路适配状态。',
    'available',
  ],
  [
    'ebpf-profiler',
    'eBPF 性能分析',
    '可观测性与自动运维',
    'P2',
    '检查客户机 eBPF 工具和内核能力。',
    'planned',
  ],
  ['flamegraph', '火焰图生成', '可观测性与自动运维', 'P2', '检查 perf/stack 工具并保存采样配置。', 'planned'],
  [
    'log-index',
    '集中日志索引',
    '可观测性与自动运维',
    'P0',
    '保存日志索引字段和最近一次索引状态。',
    'available',
  ],
  [
    'log-retention',
    '日志保留策略',
    '可观测性与自动运维',
    'P0',
    '按保留天数和总容量清理已结束任务的日志正文，保护运行中任务。',
    'available',
  ],
  ['alert-routing', '告警路由', '可观测性与自动运维', 'P0', '按实例、项目、标签和告警类型匹配 Webhook 接收端，签名投递并记录结果。', 'available'],
  [
    'slo-dashboard',
    'SLO 仪表盘',
    '可观测性与自动运维',
    'P1',
    '根据任务历史生成可用性指标摘要。',
    'available',
  ],
  ['error-budget', '错误预算', '可观测性与自动运维', 'P1', '根据目标 SLO 计算剩余错误预算。', 'available'],
  [
    'capacity-forecast',
    '容量预测',
    '可观测性与自动运维',
    'P1',
    '根据宿主机当前资源生成容量预测快照。',
    'available',
  ],
  [
    'auto-remediation',
    '自动修复 Runbook',
    '可观测性与自动运维',
    'P0',
    '保存带审批和预览的自动修复步骤。',
    'planned',
  ],
  ['build-cache', '构建缓存', '开发与 AI', 'P1', '检查客户机缓存目录和构建工具。', 'available'],
  ['build-farm', '分布式构建农场', '开发与 AI', 'P2', '保存构建节点和队列调度元数据。', 'planned'],
  [
    'language-server-catalog',
    '语言服务器目录',
    '开发与 AI',
    'P0',
    '检查客户机常见语言服务器并返回版本。',
    'available',
  ],
  [
    'devcontainer-marketplace',
    'DevContainer 市场',
    '开发与 AI',
    'P1',
    '登记 DevContainer 模板和来源校验状态。',
    'planned',
  ],
  ['branch-preview', '分支预览环境', '开发与 AI', 'P1', '保存分支预览环境的生命周期状态。', 'available'],
  [
    'test-sharding',
    '测试分片',
    '开发与 AI',
    'P1',
    '稳定分片并实际执行测试，保留每片日志、耗时与退出码。',
    'available',
  ],
  ['dependency-bot', '依赖升级机器人', '开发与 AI', 'P1', '保存依赖升级检查计划和安全限制。', 'planned'],
  [
    'code-search-index',
    '代码搜索索引',
    '开发与 AI',
    'P0',
    '检查 ripgrep/索引工具并保存索引状态。',
    'available',
  ],
  [
    'local-ai-assistant',
    '本地 AI 助手',
    '开发与 AI',
    'P2',
    '连接本机 Ollama 的本地模型，审阅脱敏文本后生成编程建议，可取消并导出结果。',
    'available',
  ],
  [
    'natural-command-planner',
    '自然语言命令规划',
    '开发与 AI',
    'P0',
    '使用本机模型生成含命令、用途、影响与验证方式的结构化计划，供人工审阅和导出。',
    'available',
  ],
  ['shared-terminal', '共享终端', '协作与团队', 'P0', '保存共享终端会话和成员访问状态。', 'planned'],
  ['shared-desktop-view', '共享桌面视图', '协作与团队', 'P1', '保存只读桌面查看会话。', 'planned'],
  ['session-handoff', '会话交接', '协作与团队', 'P0', '保存可恢复的会话交接令牌元数据。', 'planned'],
  ['file-locks', '文件锁', '协作与团队', 'P0', '登记项目文件锁和过期时间。', 'planned'],
  ['review-threads', '行级评审线程', '协作与团队', 'P1', '保存文件、行号和评审意见线程。', 'available'],
  ['project-permissions', '项目权限', '协作与团队', 'P0', '保存项目成员和角色权限。', 'planned'],
  ['team-templates', '团队模板', '协作与团队', 'P1', '保存可复制的项目和资源模板。', 'planned'],
  ['onboarding-checklist', '入门清单', '协作与团队', 'P1', '保存团队成员入门步骤和完成状态。', 'available'],
  ['change-approval', '变更审批', '协作与团队', 'P0', '保存变更摘要、审批人和审批状态。', 'planned'],
  ['activity-digest', '活动摘要', '协作与团队', 'P2', '从任务和执行历史生成活动摘要。', 'available'],
  [
    'process-interop',
    'Windows/Linux 进程互操作',
    '操作系统与桌面',
    'P1',
    '检查客户机进程工具和宿主平台。',
    'planned',
  ],
  [
    'host-drive-policy',
    '宿主盘挂载策略',
    '操作系统与桌面',
    'P0',
    '保存宿主目录挂载的只读和路径策略。',
    'planned',
  ],
  ['file-associations', '文件关联', '操作系统与桌面', 'P2', '保存扩展名到 Sakura 工作区的关联。', 'available'],
  [
    'clipboard-policy',
    '按应用剪贴板策略',
    '操作系统与桌面',
    'P0',
    '保存剪贴板按应用的读写和敏感内容策略。',
    'planned',
  ],
  [
    'media-passthrough',
    '音频摄像头麦克风直通',
    '操作系统与桌面',
    'P1',
    '检查客户机音视频设备和直通声明。',
    'planned',
  ],
  ['usb-hotplug', 'USB 热插拔', '操作系统与桌面', 'P1', '保存 USB 设备热插拔事件和规则。', 'planned'],
  [
    'gpu-compute-passthrough',
    'CUDA/ROCm 直通',
    '操作系统与桌面',
    'P1',
    '检查客户机 CUDA/ROCm 工具和设备可见性。',
    'planned',
  ],
  [
    'notebook-environment',
    'Jupyter/Marimo 环境',
    '操作系统与桌面',
    'P1',
    '检查客户机 Notebook 工具并保存启动参数。',
    'planned',
  ],
  [
    'authenticated-ide-preview',
    '认证浏览器 IDE',
    '操作系统与桌面',
    'P0',
    '保存浏览器 IDE 会话和认证过期时间。',
    'planned',
  ],
  [
    'desktop-recording',
    '桌面录制与回放',
    '操作系统与桌面',
    'P2',
    '检查客户机录制工具并保存回放索引。',
    'planned',
  ],
  ['plugin-marketplace', '插件市场', '平台与扩展', 'P0', '保存插件目录、来源和安装状态。', 'planned'],
  [
    'signed-plugin-sandbox',
    '签名沙箱插件',
    '平台与扩展',
    'P0',
    '计算插件摘要并记录签名与沙箱策略。',
    'planned',
  ],
  ['schema-panels', 'Schema 驱动面板', '平台与扩展', 'P1', '保存面板 Schema 版本和校验状态。', 'available'],
  ['graphql-api', 'GraphQL API', '平台与扩展', 'P1', '按 Schema 查询主机、实例、任务元数据与插件状态，限制查询大小和展开成本。', 'available'],
  ['webhook-events', 'Webhook 事件', '平台与扩展', 'P0', '持久排队并签名投递任务完成与告警事件，支持失败重试、取消和密钥轮换。', 'available'],
  [
    'automation-dsl',
    '事件自动化 DSL',
    '平台与扩展',
    'P0',
    '校验并保存事件自动化规则，默认只预览。',
    'planned',
  ],
  ['mobile-companion', '移动伴侣', '平台与扩展', 'P2', '保存移动设备配对和只读通知策略。', 'planned'],
  ['browser-extension', '浏览器扩展', '平台与扩展', 'P2', '保存浏览器扩展连接状态和权限摘要。', 'planned'],
  ['tray-companion', 'Windows 托盘伴侣', '平台与扩展', 'P1', '保存托盘进程连接和启动策略。', 'planned'],
  ['feature-rollout', '功能开关与灰度', '平台与扩展', 'P0', '保存功能开关、目标比例和灰度版本。', 'planned'],
] as const;

export type NextFeatureId = (typeof nextFeatureCatalog)[number][0];
export type NextFeatureState = 'available' | 'experimental' | 'planned';
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
  'virtio-fs': 'mount | grep -E "virtiofs|9p"',
  'wireguard-overlay': 'command -v wg >/dev/null && wg show',
  'private-dns-dnssec': 'command -v resolvectl >/dev/null && resolvectl status',
  'acme-renewal':
    'if command -v certbot >/dev/null; then certbot --version; else command -v lego >/dev/null && lego --version; fi',
  'network-topology': 'command -v ip >/dev/null && ip addr && ip route',
  'network-emulation': 'command -v tc >/dev/null && tc qdisc show',
  'ebpf-profiler': 'command -v bpftool >/dev/null && bpftool feature probe',
  flamegraph: 'command -v perf >/dev/null && perf --version',
  'build-cache': 'test -d /workspace/.cache || test -d /workspace/target',
  'language-server-catalog':
    'found=0; for c in typescript-language-server pyright rust-analyzer gopls; do if command -v "$c" >/dev/null; then printf "%s\\n" "$c"; found=1; fi; done; test "$found" = 1',
  'code-search-index': 'command -v rg >/dev/null && rg --version',
  'process-interop': 'command -v ps >/dev/null && ps -eo pid,comm',
  'gpu-compute-passthrough':
    'if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=name --format=csv,noheader; else command -v rocminfo >/dev/null && rocminfo; fi',
  'notebook-environment':
    'if command -v jupyter >/dev/null; then jupyter --version; else command -v marimo >/dev/null && marimo --version; fi',
  'desktop-recording': 'command -v ffmpeg >/dev/null && ffmpeg -version',
};

const now = () => new Date().toISOString();

export class NextFeatures {
  jobs = new Jobs('next-features');
  private stateValue?: NextState;
  private stateLoading?: Promise<NextState>;
  private writes = Promise.resolve();
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {}

  private file() {
    return join(DATA, 'next-features.json');
  }
  private async state() {
    const state = (this.stateValue ||= await (this.stateLoading ||= readStore(this.file(), defaultState)));
    state.settings ||= {};
    state.executions ||= {};
    state.records ||= {};
    return state;
  }
  private async save(state: NextState) {
    this.stateValue = state;
    const snapshot = structuredClone(state);
    this.writes = this.writes.catch(() => {}).then(() => writeStore(this.file(), snapshot));
    await this.writes;
  }
  private spec(featureId: string) {
    const id = idSchema.parse(featureId) as NextFeatureId;
    return catalog.find((item) => item.id === id)!;
  }
  async catalog() {
    return {
      features: catalog,
      capabilities: capabilityViews('next'),
      count: catalog.length,
      generatedAt: now(),
    };
  }
  async view(id: string) {
    this.machines.get(id);
    const state = await this.state();
    const projectId = this.workspaces.projects.current(id);
    return {
      projectId,
      features: catalog,
      capabilities: capabilityViews('next'),
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
      .object({
        featureId: idSchema,
        enabled: z.boolean(),
        options: z.record(z.string(), z.unknown()).default({}),
      })
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

  private async probe(
    id: string,
    spec: NextFeature,
    signal?: AbortSignal,
    options: Record<string, unknown> = {},
    action: 'check' | 'run' = 'check',
  ) {
    const state = await this.state();
    const configured = state.settings[id]?.[spec.id];
    const merged = { ...configured?.options, ...options };
    const adapter = {
      id: spec.id,
      enabled: configured?.enabled ?? true,
      options: merged,
      actions: spec.state === 'available' ? ['configure', 'check', 'run'] : ['configure', 'check'],
    };
    if (action === 'run' && configured?.enabled === false) throw new AppError('此能力已禁用', 409);
    if (spec.id === 'file-associations') return {
      ready: process.platform === 'win32', executed: false, adapter,
      message: '系统设置 → 管理 Windows 集成，选择扩展名与已配置同步的工作区，保存后添加到 Windows 打开方式；仅接受映射目录中的文件。',
    };
    if (spec.id === 'local-ai-assistant' || spec.id === 'natural-command-planner') return {
      ready: true, executed: false, adapter,
      message: '系统设置 → 本地 AI 助手，保存本机模型连接；审阅脱敏发送内容后生成建议或命令计划。需要运行中的 Ollama 和已下载的本地模型。',
    };
    if (spec.id === 'webhook-events' || spec.id === 'alert-routing') return {
      ready: true, executed: false, adapter,
      message: '系统设置 → 管理事件通知，配置接收端和标签条件，可测试签名投递、查看结果、重试或取消。',
    };
    if (spec.id === 'graphql-api') return {
      ready: true, executed: false, adapter,
      message: '打开系统设置 → GraphQL 查询，执行只读查询或下载 Schema；POST /api/graphql 继续使用本机控制凭证。',
    };
    if (spec.id === 'log-retention')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '请在系统设置 → 任务日志保留中预览并保存主机级策略；服务每分钟执行已启用的清理策略。',
      };
    if (hasCapability(spec.id)) {
      const runner = new CapabilityActions(this.machines, this.workspaces);
      return action === 'run'
        ? runner.run(id, spec.id, merged, signal || new AbortController().signal)
        : runner.check(id, spec.id, signal);
    }
    if (spec.id === 'incident-lockdown') {
      if (action === 'check')
        return { ready: true, executed: false, adapter, locked: this.machines.incidentLocked(id) };
      const input = z.object({ locked: z.boolean() }).strict().parse(options);
      const result = await this.machines.setIncidentLockdown(id, input.locked);
      return { ready: true, executed: true, adapter, ...result };
    }
    if (action === 'run' && spec.state !== 'available')
      throw new AppError('此功能尚未完成实现；保存配置不会执行对应能力', 501);
    if (spec.id === 'rpo-rto-planner') {
      const input = z
        .object({
          retentionDays: z.number().int().min(1).max(3650).default(30),
          backupGiB: z.number().positive().max(1000000).default(10),
          bandwidthMbps: z.number().positive().max(1000000).default(100),
          backupIntervalMinutes: z.number().positive().max(10080).default(1440),
        })
        .strict()
        .parse(merged);
      return {
        ready: true,
        executed: action === 'run',
        adapter,
        plan: {
          ...input,
          rpoMinutes: input.backupIntervalMinutes,
          rtoMinutes: Math.ceil((input.backupGiB * 1024 * 8) / input.bandwidthMbps / 60),
        },
        message: '按备份间隔估算 RPO、按传输带宽估算恢复时间；不包含恢复执行耗时。',
      };
    }
    const command = guestChecks[spec.id];
    if (command) {
      const probe = await this.guestProbe(id, command, signal);
      return {
        ...probe,
        adapter,
        ready: false,
        executed: false,
        probePassed: probe.exitCode === 0,
        reason: '这里只检查工具或环境；对应功能尚无完整执行器。',
      };
    }
    if (['hardware-compatibility', 'multi-host-inventory', 'storage-pools'].includes(spec.id))
      return {
        ready: false,
        executed: false,
        adapter,
        host: this.hostSnapshot(),
        reason: '当前只提供本机信息；不代表硬件验证、多主机管理或存储池已经实现。',
      };
    return {
      ready: false,
      executed: false,
      adapter,
      record: state.records[id]?.[spec.id],
      reason: '当前仅有目录与配置入口，尚无对应功能执行器。',
    };
  }

  private async executeFeature(
    id: string,
    spec: NextFeature,
    action: 'check' | 'run',
    signal?: AbortSignal,
    options?: Record<string, unknown>,
  ) {
    const startedAt = now();
    const result = await this.probe(id, spec, signal, options, action);
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
        z
          .object({
            action: z.literal('configure'),
            featureId: idSchema,
            enabled: z.boolean(),
            options: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
        z
          .object({
            action: z.literal('check'),
            featureId: idSchema,
            options: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
        z
          .object({
            action: z.literal('run'),
            featureId: idSchema,
            options: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      ])
      .parse(input);
    if (value.featureId !== 'incident-lockdown' && value.action !== 'check')
      this.machines.requireUnlocked(id);
    if (value.action === 'configure') {
      const { action: _, ...configuration } = value;
      return this.configure(id, configuration);
    }
    const spec = this.spec(value.featureId);
    if (value.action === 'check' || spec.id === 'incident-lockdown')
      return this.executeFeature(id, spec, value.action, signal, value.options);
    if (spec.state !== 'available') throw new AppError('此功能尚未完成实现', 501);
    if (hasCapability(spec.id)) {
      const configured = (await this.state()).settings[id]?.[spec.id]?.options || {};
      capabilityParameters(spec.id, { ...configured, ...value.options });
    }
    const projectId = this.workspaces.projects.current(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal, _update, saveResult) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, value.options);
        await saveResult(result);
        log(`${JSON.stringify(result)}\n`);
        if (!result.ready) throw new AppError('能力尚未就绪或执行失败', 409);
      },
      { title: `第三批能力 · ${spec.name}`, vmId: id, projectId, action: `next:${spec.id}` },
    );
  }

  close() {
    return this.jobs.close();
  }
}

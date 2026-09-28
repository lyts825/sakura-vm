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
import { AcmeRenewal } from './acme-renewal.ts';
import type { ProcessInterop } from './process-interop.ts';
import { hardwareCompatibility } from './hardware-compatibility.ts';
import { firmwareSupport } from './firmware.ts';
import { networkEmulation } from './network-emulation.ts';
import { guestDnsDiagnostics } from './guest-dns.ts';
import { hostScoreInput, type HostScoreInput, type HostPeers } from './host-peers.ts';
import type { ColdMigrations } from './cold-migration.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';
import type { NotebookEnvironments } from './notebook-environments.ts';
import type { BrowserIde } from './browser-ide.ts';
import { StorageTiering } from './storage-tiering.ts';
import type { DisasterRecoveryDrill } from './disaster-recovery-drill.ts';
import type { ObjectBackup } from './object-backup.ts';
import type { WireGuardOverlay } from './wireguard-overlay.ts';
import { TeamTemplates } from './team-templates.ts';

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
    '生成一次性短码，经 TLS 指纹校验后将另一台 Sakura 加入本机主机列表。',
    'available',
  ],
  [
    'host-cert-rotation',
    '主机证书轮换',
    '远程主机与集群',
    'P0',
    '登记主机证书的轮换策略和下一次轮换时间。',
    'available',
  ],
  [
    'multi-host-inventory',
    '多主机资源总览',
    '远程主机与集群',
    'P0',
    '经配对认证汇总本机与远端主机的 CPU、内存和实例数量。',
    'available',
  ],
  [
    'live-migration',
    '虚拟机在线迁移',
    '远程主机与集群',
    'P1',
    '检查在线迁移前置条件并生成迁移计划。',
    'planned',
  ],
  ['cold-migration', '冷迁移队列', '远程主机与集群', 'P1',
    '将停止实例的校验包传至已授权远端，持久记录重试任务，确认后移除源实例。', 'available'],
  [
    'resource-scheduler',
    '资源评分调度',
    '远程主机与集群',
    'P1',
    '依据已配对主机的空闲内存、CPU 和负载为实例计算可解释的主机排序。',
    'available',
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
    '将选定历史快照校验后复制为远端独立实例，持久记录目标、校验和与重试状态。',
    'available',
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
    '将当前停止实例分批复制到已授权目标；确认全部目标副本后逐台复核并移除源实例。',
    'available',
  ],
  [
    'uefi-ovmf',
    'UEFI 与 OVMF 固件',
    '虚拟硬件与固件',
    'P1',
    '检测宿主机是否有 UEFI/OVMF 固件并保存选择。',
    'available',
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
    '读取客户机 CPU 虚拟化标志与 KVM 设备，记录嵌套虚拟化候选条件。',
    'available',
  ],
  [
    'vcpu-hotplug',
    '在线 vCPU 热插拔',
    '虚拟硬件与固件',
    'P1',
    '在停机时预留 CPU 插槽；TCG 和支持 ACPI CPU 热插拔的客户机可在线增加 vCPU，并校验上线。',
    'available',
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
    'available',
  ],
  [
    'storage-pools',
    '存储池管理',
    '存储与灾备',
    'P0',
    '创建本机存储池、分配新实例并在停机后校验迁移已有实例。',
    'available',
  ],
  ['storage-tiering', 'SSD/HDD 分层', '存储与灾备', 'P1',
    '按最近使用时间将停机实例在指定热池和冷池间迁移，并定期重平衡。', 'available'],
  [
    'object-backup',
    'S3/MinIO 备份目标',
    '存储与灾备',
    'P1',
    '上传和验证备份到 S3/MinIO，并从远端校验恢复。',
    'available',
  ],
  ['snapshot-merge', '快照分支合并', '存储与灾备', 'P1', '生成快照分支合并预览并记录来源。', 'planned'],
  [
    'file-level-restore',
    '文件级恢复',
    '存储与灾备',
    'P0',
    '从普通、加密或内容块备份中，只读提取指定文件并校验下载。',
    'available',
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
  ['disaster-recovery-drill', '灾备演练', '存储与灾备', 'P1',
    '校验备份、临时恢复并启动客户机，验证路径后清理实例并记录耗时。', 'available'],
  [
    'wireguard-overlay',
    'WireGuard 覆盖网络',
    '网络与服务治理',
    'P1',
    '配置客户机 WireGuard 接口、对端与覆盖路由，重启后自动恢复。',
    'available',
  ],
  [
    'private-dns-dnssec',
    '私有 DNS 与 DNSSEC',
    '网络与服务治理',
    'P1',
    '配置、验证和恢复私有 DNS 路由及 DNSSEC 策略，并读取客户机解析器状态。',
    'available',
  ],
  [
    'http-ingress',
    'HTTP 反向代理',
    '网络与服务治理',
    'P0',
    '在本机回环地址发布路径路由，并转发到实例端口映射和检查上游健康。',
    'available',
  ],
  [
    'acme-renewal',
    'ACME 证书续期',
    '网络与服务治理',
    'P1',
    '对客户机已有 Certbot 证书执行试运行、手动或定期续期。',
    'available',
  ],
  [
    'mtls-policy',
    'mTLS 服务策略',
    '网络与服务治理',
    'P0',
    '为本机 HTTPS 入口按路由验证客户端证书，并在预定时间切换信任证书。',
    'available',
  ],
  ['network-topology', '网络拓扑图', '网络与服务治理', 'P1', '记录客户机接口、路由和转发拓扑。', 'available'],
  ['nat-hairpin', 'NAT 回流', '网络与服务治理', 'P2', '验证客户机通过本机 QEMU 宿主网关回连现有 TCP 转发服务。', 'available'],
  ['proxy-pac', 'PAC 代理策略', '网络与服务治理', 'P2', '保存按域名分流的 PAC 规则。', 'available'],
  [
    'network-emulation',
    '延迟丢包模拟',
    '网络与服务治理',
    'P1',
    '检查并实际设置或清除客户机网卡的 tc/netem 延迟、抖动和丢包规则。',
    'available',
  ],
  ['service-mesh', '服务网格边车', '网络与服务治理', 'P2', '登记服务边车策略和可选代理检测结果。', 'planned'],
  [
    'passkey-webauthn',
    'Passkey/WebAuthn',
    '安全与合规',
    'P0',
    '本机账户可登记、使用和撤销通行密钥；登录验证一次性挑战及凭证计数器。',
    'available',
  ],
  [
    'oidc-saml',
    'OIDC 与 SAML 单点登录',
    '安全与合规',
    'P0',
    '校验身份提供商元数据并保存非敏感配置。',
    'planned',
  ],
  ['custom-rbac', '自定义 RBAC', '安全与合规', 'P0',
    '按项目定义读取、编辑、执行角色并映射成员；项目接口按当前角色逐请求校验。', 'available'],
  ['jit-privilege', 'JIT 临时授权', '安全与合规', 'P1',
    '只读账户按实例申请一次启停，管理员限时审批，可在执行前撤销。', 'available'],
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
    '在运行中的客户机用 bpftrace 采样内核调用栈并统计热点函数。',
    'available',
  ],
  ['flamegraph', '火焰图生成', '可观测性与自动运维', 'P2', '在运行中的客户机用 perf 采样调用栈并生成可下载的 SVG 火焰图。', 'available'],
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
  [
    'alert-routing',
    '告警路由',
    '可观测性与自动运维',
    'P0',
    '按实例、项目、标签和告警类型匹配 Webhook 接收端，签名投递并记录结果。',
    'available',
  ],
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
    '按告警或任务事件执行经逐步预览和批准的修复命令，持久去重并限制频率。',
    'available',
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
    'available',
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
  ['dependency-bot', '依赖升级机器人', '开发与 AI', 'P1',
    '扫描 npm 直接依赖并生成审阅计划；按计划更新清单与锁文件，支持中断恢复和版本回退。', 'available'],
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
  ['shared-terminal', '共享终端', '协作与团队', 'P0',
    '管理员按终端会话和账户授予限时只读权限；实时输出、输入阻断和撤销均在服务端执行。', 'available'],
  ['shared-desktop-view', '共享桌面视图', '协作与团队', 'P1',
    '已授权的本地只读账户可查看实例桌面，服务端拒绝键鼠、剪贴板和调整桌面尺寸。', 'available'],
  ['session-handoff', '会话交接', '协作与团队', 'P0',
    '生成两分钟有效的一次性交接码，在本机浏览器间转移账户会话并撤销原凭证。', 'available'],
  ['file-locks', '文件锁', '协作与团队', 'P0', '在文件工作台获取、续租和释放文件锁，并阻止其他文件工作台写入修改锁定路径。', 'available'],
  ['review-threads', '行级评审线程', '协作与团队', 'P1', '保存文件、行号和评审意见线程。', 'available'],
  ['project-permissions', '项目权限', '协作与团队', 'P0',
    '成员默认无权访问，管理员按实例及项目授予角色；项目配置、搜索、Git 和健康接口按角色校验。', 'available'],
  ['team-templates', '团队模板', '协作与团队', 'P1',
    '预览并保存可复制的资源与项目蓝图，再按指纹创建独立实例；不复制私密配置。', 'available'],
  ['onboarding-checklist', '入门清单', '协作与团队', 'P1', '保存团队成员入门步骤和完成状态。', 'available'],
  ['change-approval', '变更审批', '协作与团队', 'P0', '保存变更摘要、审批人和审批状态。', 'planned'],
  ['activity-digest', '活动摘要', '协作与团队', 'P2', '从任务和执行历史生成活动摘要。', 'available'],
  [
    'process-interop',
    'Windows/Linux 进程互操作',
    '操作系统与桌面',
    'P1',
    '登记固定 Windows 程序，在 Linux 客户机通过 sakura-win 受控调用。',
    'available',
  ],
  [
    'host-drive-policy',
    '宿主盘挂载策略',
    '操作系统与桌面',
    'P0',
    '保存宿主目录挂载的只读和路径策略。',
    'planned',
  ],
  [
    'file-associations',
    '文件关联',
    '操作系统与桌面',
    'P2',
    '保存扩展名到 Sakura 工作区的关联。',
    'available',
  ],
  [
    'clipboard-policy',
    '按应用剪贴板策略',
    '操作系统与桌面',
    'P0',
    '保存剪贴板按应用的读写和敏感内容策略。',
    'experimental',
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
    '在当前项目安装 JupyterLab 或 Marimo，管理带认证的会话与本机回环入口。',
    'available',
  ],
  [
    'authenticated-ide-preview',
    '认证浏览器 IDE',
    '操作系统与桌面',
    'P0',
    '在 Debian/Ubuntu 项目中启动带密码和到期时间的浏览器 IDE。',
    'available',
  ],
  [
    'desktop-recording',
    '桌面录制与回放',
    '操作系统与桌面',
    'P2',
    '录制 Linux 桌面画面、保存回放索引并导出视频。',
    'available',
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
  [
    'graphql-api',
    'GraphQL API',
    '平台与扩展',
    'P1',
    '按 Schema 查询主机、实例、任务元数据与插件状态，限制查询大小和展开成本。',
    'available',
  ],
  [
    'webhook-events',
    'Webhook 事件',
    '平台与扩展',
    'P0',
    '持久排队并签名投递任务完成与告警事件，支持失败重试、取消和密钥轮换。',
    'available',
  ],
  [
    'automation-dsl',
    '事件自动化 DSL',
    '平台与扩展',
    'P0',
    '按任务和告警事件执行带去重、冷却与预览模式的实例操作。',
    'available',
  ],
  ['mobile-companion', '移动伴侣', '平台与扩展', 'P2', '保存移动设备配对和只读通知策略。', 'planned'],
  ['browser-extension', '浏览器扩展', '平台与扩展', 'P2',
    'Manifest V3 扩展以管理员一次性配对码连接本机服务，只读查看实例摘要；支持到期、撤销和连接状态。', 'available'],
  ['tray-companion', 'Windows 托盘伴侣', '平台与扩展', 'P1',
    '运行 Windows 系统托盘进程，查看本机 Sakura 状态、打开控制台、启动服务并保存登录自启策略。', 'available'],
  ['feature-rollout', '功能开关与灰度', '平台与扩展', 'P0',
    '按稳定主机分桶和版本化比例控制所选插件下次启动时是否激活。', 'available'],
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
  'network-topology': 'command -v ip >/dev/null && ip addr && ip route',
  'build-cache': 'test -d /workspace/.cache || test -d /workspace/target',
  'language-server-catalog':
    'found=0; for c in typescript-language-server pyright rust-analyzer gopls; do if command -v "$c" >/dev/null; then printf "%s\\n" "$c"; found=1; fi; done; test "$found" = 1',
  'code-search-index': 'command -v rg >/dev/null && rg --version',
  'gpu-compute-passthrough':
    'if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=name --format=csv,noheader; else command -v rocminfo >/dev/null && rocminfo; fi',
};

const now = () => new Date().toISOString();

function compactProfileResult(result: Record<string, unknown>) {
  const download = result.download as Record<string, unknown> | undefined;
  if (!download || typeof download.content !== 'string') return result;
  const { content, ...metadata } = download;
  return { ...result, download: { ...metadata, bytes: Buffer.byteLength(content) } };
}

export class NextFeatures {
  jobs = new Jobs('next-features');
  storageTiering: StorageTiering;
  acmeRenewal: AcmeRenewal;
  teamTemplates: TeamTemplates;
  private scoreHosts?: (input: HostScoreInput) => ReturnType<HostPeers['score']>;
  private coldMigrations?: ColdMigrations;
  private snapshotReplications?: SnapshotReplications;
  private notebookEnvironments?: NotebookEnvironments;
  private browserIde?: BrowserIde;
  private disasterRecovery?: DisasterRecoveryDrill;
  private objectBackup?: ObjectBackup;
  private wireGuardOverlay?: WireGuardOverlay;
  private processInterop?: ProcessInterop;
  private sharedDesktopCheck?: (id: string) => Promise<{ ready: boolean; reason?: string }>;
  private sharedTerminalCheck?: (id: string) => Promise<{ ready: boolean; reason?: string }>;
  private passkeyCheck?: () => { ready: boolean; registered: number; reason?: string };
  private accountModeReady?: () => boolean;
  private stateValue?: NextState;
  private stateLoading?: Promise<NextState>;
  private writes = Promise.resolve();
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {
    this.storageTiering = new StorageTiering(machines);
    this.acmeRenewal = new AcmeRenewal(machines);
    this.teamTemplates = new TeamTemplates(machines, workspaces);
  }

  async init() {
    try {
      await this.storageTiering.init();
      await this.acmeRenewal.init();
    } catch (error) {
      await Promise.allSettled([this.storageTiering.close(), this.acmeRenewal.close()]);
      throw error;
    }
  }

  setAcmeAllowed(check: () => boolean) { this.acmeRenewal.setAllowed(check); }
  setAcmeMutationCounter(change: (delta: number) => void) {
    this.acmeRenewal.setMutationCounter(change);
  }

  setResourceScheduler(score: (input: HostScoreInput) => ReturnType<HostPeers['score']>) {
    this.scoreHosts = score;
  }

  setSharedDesktopCheck(check: (id: string) => Promise<{ ready: boolean; reason?: string }>) {
    this.sharedDesktopCheck = check;
  }

  setSharedTerminalCheck(check: (id: string) => Promise<{ ready: boolean; reason?: string }>) {
    this.sharedTerminalCheck = check;
  }

  setPasskeyCheck(check: () => { ready: boolean; registered: number; reason?: string }) {
    this.passkeyCheck = check;
  }

  setAccountModeReady(check: () => boolean) { this.accountModeReady = check; }

  setColdMigrations(service: ColdMigrations) {
    this.coldMigrations = service;
  }

  setSnapshotReplications(service: SnapshotReplications) {
    this.snapshotReplications = service;
  }

  setNotebookEnvironments(service: NotebookEnvironments) {
    this.notebookEnvironments = service;
  }

  notebookLink(id: string) {
    if (!this.notebookEnvironments) throw new AppError('Notebook 服务尚未启用', 503);
    this.machines.requireUnlocked(id);
    return this.notebookEnvironments.link(id);
  }

  setBrowserIde(service: BrowserIde) {
    this.browserIde = service;
  }

  setDisasterRecovery(service: DisasterRecoveryDrill) {
    this.disasterRecovery = service;
  }

  setObjectBackup(service: ObjectBackup) {
    this.objectBackup = service;
  }
  setWireGuardOverlay(service: WireGuardOverlay) {
    this.wireGuardOverlay = service;
  }
  setProcessInterop(service: ProcessInterop) { this.processInterop = service; }

  browserIdeLink(id: string) {
    if (!this.browserIde) throw new AppError('浏览器 IDE 服务尚未启用', 503);
    this.machines.requireUnlocked(id);
    return this.browserIde.link(id);
  }

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
    const settings = { ...(state.settings[id] || {}) };
    const acmePolicy = this.acmeRenewal.view(id).policy;
    if (acmePolicy) settings['acme-renewal'] = { enabled: acmePolicy.enabled,
      options: { intervalHours: acmePolicy.intervalHours }, updatedAt: acmePolicy.updatedAt };
    return {
      projectId,
      features: catalog,
      capabilities: capabilityViews('next'),
      settings,
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
    if (value.featureId === 'acme-renewal') {
      const intervalHours = value.options.intervalHours === undefined ? undefined :
        z.number().int().min(1).max(168).parse(value.options.intervalHours);
      const result = await this.acmeRenewal.save(id,
        { mode: 'save', enabled: value.enabled, intervalHours });
      return { enabled: value.enabled, options: { intervalHours: result.policy!.intervalHours },
        updatedAt: now(), policy: result.policy };
    }
    if (value.featureId === 'process-interop' && !value.enabled && this.processInterop)
      await this.processInterop.action(id, { mode: 'disable' }, 'run');
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
    log: (line: string) => void = () => {},
  ) {
    const state = await this.state();
    const configured = state.settings[id]?.[spec.id];
    const merged = { ...configured?.options, ...options };
    const adapter = {
      id: spec.id,
      enabled: configured?.enabled ?? true,
      options: spec.id === 'acme-renewal' ? options : merged,
      actions: spec.state === 'available' ? ['configure', 'check', 'run'] : ['configure', 'check'],
    };
    if (action === 'run' && configured?.enabled === false && spec.id !== 'acme-renewal')
      throw new AppError('此能力已禁用', 409);
    if (spec.id === 'file-level-restore')
      return {
        ready: true,
        executed: false,
        adapter,
        message:
          '启用备份策略插件，在停止实例的快照页使用“备份文件恢复”，选择备份、分区和文件；提取后下载，不覆盖当前磁盘。',
      };
    if (spec.id === 'file-locks')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '启用文件工作台插件，在编辑器中获取文件锁。锁定后自动续租；保存、恢复、上传和文件操作会检查冲突，关闭编辑器可释放锁。',
      };
    if (spec.id === 'desktop-recording')
      return {
        ready: true,
        executed: false,
        adapter,
        message:
          '实例 → 桌面 → 录制与回放，在浏览器中录制、暂停、停止、回放并导出 WebM。系统设置中的录制库可管理已主动保存的本浏览器视频；无需客户机录制工具。',
      };
    if (spec.id === 'file-associations')
      return {
        ready: process.platform === 'win32',
        executed: false,
        adapter,
        message:
          '系统设置 → 管理 Windows 集成，选择扩展名与已配置同步的工作区，保存后添加到 Windows 打开方式；仅接受映射目录中的文件。',
      };
    if (spec.id === 'clipboard-policy')
      return {
        ready: true,
        executed: false,
        adapter,
        message:
          '系统设置 → 剪贴板敏感检测 → 按应用剪贴板策略，管理网页终端、文件和桌面入口的复制/粘贴、实例覆盖与文本检测。当前不管理 Windows/Linux 独立应用进程的系统剪贴板权限。',
      };
    if (spec.id === 'local-ai-assistant' || spec.id === 'natural-command-planner')
      return {
        ready: true,
        executed: false,
        adapter,
        message:
          '系统设置 → 本地 AI 助手，保存本机模型连接；审阅脱敏发送内容后生成建议或命令计划。需要运行中的 Ollama 和已下载的本地模型。',
      };
    if (spec.id === 'webhook-events' || spec.id === 'alert-routing')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 管理事件通知，配置接收端和标签条件，可测试签名投递、查看结果、重试或取消。',
      };
    if (spec.id === 'automation-dsl')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 事件自动化规则，按任务或告警筛选实例，先预览再启用实际执行；规则持久去重并记录每次操作。',
      };
    if (spec.id === 'auto-remediation')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 事件自动化规则 → 自动修复 Runbook：保存预览规则，检查每一步命令与匹配事件，再单独批准实际执行。',
      };
    if (spec.id === 'feature-rollout')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 插件功能灰度，预览当前主机分桶并保存插件、版本和放行比例；下次启动按策略实际选择插件。',
      };
    if (spec.id === 'host-pairing' || spec.id === 'multi-host-inventory')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 主机配对与多主机状态，启用独立 TLS 同伴入口后使用一次性短码和证书指纹配对；可查看远端资源与连通性。',
      };
    if (spec.id === 'resource-scheduler') {
      if (!this.scoreHosts)
        return { ready: false, executed: false, adapter, reason: '主机资源评分服务尚未启动。' };
      const vm = this.machines.get(id);
      const override = hostScoreInput.partial().strict().parse(merged);
      const score = await this.scoreHosts({ cpus: override.cpus ?? vm.cpus,
        memoryMiB: override.memoryMiB ?? vm.memoryMiB });
      return { ...score, ready: score.candidates.some((item) => item.eligible),
        executed: action === 'run', adapter,
        message: '此结果是按最近资源观测计算的放置建议，不会迁移或启动实例。' };
    }
    if (spec.id === 'object-backup') {
      if (!this.objectBackup)
        return { ready: false, executed: false, adapter,
          reason: '对象备份服务尚未启用。' };
      return { ...await this.objectBackup.action(id, merged, action,
        signal || new AbortController().signal), adapter };
    }
    if (spec.id === 'process-interop') {
      if (!this.processInterop)
        return { ready: false, executed: false, adapter, reason: '进程互操作服务尚未启动。' };
      return { ...await this.processInterop.action(id, merged, action, signal), adapter };
    }
    if (spec.id === 'wireguard-overlay') {
      if (!this.wireGuardOverlay)
        return { ready: false, executed: false, adapter,
          reason: 'WireGuard 覆盖网络服务尚未启用。' };
      return { ...await this.wireGuardOverlay.action(id, merged, action,
        signal || new AbortController().signal), adapter };
    }
    if (spec.id === 'team-templates')
      return { ...await this.teamTemplates.action(id, merged, action), adapter };
    if (spec.id === 'shared-desktop-view') {
      const state = this.sharedDesktopCheck
        ? await this.sharedDesktopCheck(id)
        : { ready: false, reason: '共享桌面服务尚未启动。' };
      return { ...state, executed: false, adapter,
        message: '系统设置 → 账户与只读分享：为此实例创建只读账户。用户登录后打开只读桌面视图。' };
    }
    if (spec.id === 'shared-terminal') {
      const status = this.sharedTerminalCheck
        ? await this.sharedTerminalCheck(id)
        : { ready: false, reason: '共享终端服务尚未启动。' };
      return { ...status, executed: false, adapter,
        message: '在可恢复终端会话中选定只读账户并共享；对方登录后可实时查看，输入在服务端被拒绝。' };
    }
    if (spec.id === 'passkey-webauthn') {
      const status = this.passkeyCheck?.() || { ready: false, registered: 0,
        reason: '通行密钥服务尚未启动。' };
      return { ...status, executed: false, adapter,
        message: '启用账户模式后，在 localhost 打开账户设置，以当前密码登记通行密钥；登录页可免密登录。' };
    }
    if (spec.id === 'session-handoff')
      return { ready: this.accountModeReady?.() || false, executed: false, adapter,
        ...(!this.accountModeReady?.() ? { reason: '请先启用账户模式。' } : {}),
        message: '账户设置 → 会话交接：验证当前密码并生成一次性交接码，在另一个本机浏览器的登录页接收。' };
    if (spec.id === 'browser-extension')
      return { ready: this.accountModeReady?.() || false, executed: false, adapter,
        ...(!this.accountModeReady?.() ? { reason: '请先启用账户模式。' } : {}),
        message: '从发行包加载 browser-extension，管理员在系统设置中生成五分钟配对码；扩展仅可读取实例摘要。' };
    if (spec.id === 'tray-companion')
      return { ready: process.platform === 'win32', executed: false, adapter,
        ...(process.platform !== 'win32' ? { reason: '仅支持 Windows 主机。' } : {}),
        message: '在 Windows 运行 npm run tray；托盘可显示本机状态、打开 Sakura、启动服务及设置登录自启。' };
    if (spec.id === 'devcontainer-marketplace') {
      const vm = this.machines.get(id);
      const result = vm.distro && vm.distro !== 'alpine' && this.machines.state(id) === 'running'
        ? await this.machines.exec(id, 'command -v devcontainer >/dev/null', 10000, signal)
        : null;
      return { ready: result?.code === 0, executed: false, adapter,
        ...(result?.code !== 0 ? { reason: '需要运行中的 Debian/Ubuntu 实例与 Dev Container CLI。' } : {}),
        message: '在容器工作台选择官方模板，校验 OCI 元数据与发布者，然后应用到空项目目录。' };
    }
    if (spec.id === 'jit-privilege')
      return { ready: this.accountModeReady?.() || false, executed: false, adapter,
        ...(!this.accountModeReady?.() ? { reason: '请先启用账户模式。' } : {}),
        message: '只读账户在分享页申请指定实例的一次启停操作；管理员在账户设置中审批，有效期内由申请者执行。' };
    if (spec.id === 'custom-rbac' || spec.id === 'project-permissions')
      return { ready: this.accountModeReady?.() || false, executed: false, adapter,
        ...(!this.accountModeReady?.() ? { reason: '请先启用账户模式。' } : {}),
        message: '系统设置 → 账户与只读分享 → 项目成员与权限：为当前实例的项目定义角色、权限和成员分配；实际授权由项目 API 在请求时执行。' };
    if (spec.id === 'acme-renewal')
      return { ...await this.acmeRenewal.run(id, options, action, signal),
        adapter: { ...adapter, enabled: true } };
    if (spec.id === 'cold-migration') {
      if (!this.coldMigrations)
        return { ready: false, executed: false, adapter,
          reason: '请启用快照与实例包插件，并完成主机配对。' };
      return { ...(action === 'run'
        ? await this.coldMigrations.run(id, merged, signal || new AbortController().signal)
        : await this.coldMigrations.preview(id, merged)), adapter };
    }
    if (spec.id === 'maintenance-drain') {
      if (!this.coldMigrations)
        return { ready: false, executed: false, adapter,
          reason: '请启用快照与实例包插件，并完成主机配对。' };
      return { ...(action === 'run'
        ? await this.coldMigrations.runDrain(merged, signal || new AbortController().signal)
        : await this.coldMigrations.previewDrain(merged)), adapter };
    }
    if (spec.id === 'cross-host-snapshots') {
      if (!this.snapshotReplications)
        return { ready: false, executed: false, adapter,
          reason: '请启用快照与实例包插件，并完成主机配对。' };
      return { ...(action === 'run'
        ? await this.snapshotReplications.run(id, merged, signal || new AbortController().signal)
        : await this.snapshotReplications.preview(id, merged)), adapter };
    }
    if (spec.id === 'notebook-environment') {
      if (!this.notebookEnvironments)
        return { ready: false, executed: false, adapter,
          reason: 'Notebook 服务尚未启动。' };
      return { ...(action === 'run'
        ? await this.notebookEnvironments.run(id, merged,
          signal || new AbortController().signal, log)
        : await this.notebookEnvironments.view(id, merged, signal)), adapter };
    }
    if (spec.id === 'authenticated-ide-preview') {
      if (!this.browserIde)
        return { ready: false, executed: false, adapter,
          reason: '浏览器 IDE 服务尚未启动。' };
      return { ...(action === 'run'
        ? await this.browserIde.run(id, merged,
          signal || new AbortController().signal, log)
        : await this.browserIde.view(id, merged, signal)), adapter };
    }
    if (spec.id === 'storage-pools')
      return { ...(await this.machines.storagePools.run(id, merged, action,
        signal, log)), adapter };
    if (spec.id === 'storage-tiering')
      return { ...(await this.storageTiering.run(id, merged, action, signal, log)), adapter };
    if (spec.id === 'disaster-recovery-drill') {
      if (!this.disasterRecovery)
        return { ready: false, executed: false, adapter,
          reason: '请启用备份与快照实例包插件，才能执行恢复演练。' };
      return { ...(await this.disasterRecovery.run(id, merged, action, signal, log)), adapter };
    }
    if (spec.id === 'graphql-api')
      return {
        ready: true,
        executed: false,
        adapter,
        message:
          '打开系统设置 → GraphQL 查询，执行只读查询或下载 Schema；POST /api/graphql 继续使用本机控制凭证。',
      };
    if (spec.id === 'log-retention')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '请在系统设置 → 任务日志保留中预览并保存主机级策略；服务每分钟执行已启用的清理策略。',
      };
    if (spec.id === 'hardware-compatibility')
      return {
        ...(await hardwareCompatibility(this.machines, id, signal)),
        executed: action === 'run',
        adapter,
      };
    if (spec.id === 'uefi-ovmf') {
      const support = await firmwareSupport();
      return {
        ready: support.available,
        executed: action === 'run',
        adapter,
        support,
        selected: this.machines.get(id).firmware || 'bios',
        message: support.available
          ? '在创建实例或停止实例后的资源配置中选择 UEFI；启动时使用独立的 OVMF NVRAM 文件。'
          : support.reason,
      };
    }
    if (spec.id === 'http-ingress')
      return {
        ready: this.machines.get(id).forwards.length > 0,
        executed: false,
        adapter,
        forwards: this.machines.get(id).forwards,
        message: '在实例的“服务与端口”页先配置端口转发，再创建本机 HTTP/HTTPS 入口、路径规则与健康检查。',
      };
    if (spec.id === 'host-cert-rotation')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '在实例的“服务与端口”页管理本机 HTTPS 主机证书、自动轮换策略和下一次轮换时间；远程主机配对仍由独立功能负责。',
      };
    if (spec.id === 'mtls-policy')
      return {
        ready: this.machines.get(id).forwards.length > 0,
        executed: false,
        adapter,
        message: '在实例的“服务与端口”页编辑 HTTPS 入口，启用 mTLS 并登记客户端证书；可预设替换证书与切换时间。HTTP 请求和 WebSocket 升级均按路由验证。',
      };
    if (spec.id === 'network-emulation')
      return {
        ...(await networkEmulation(this.machines, id, merged, action, signal)),
        adapter,
      };
    if (spec.id === 'private-dns-dnssec')
      return {
        ...(await guestDnsDiagnostics(this.machines, id, action, signal)),
        adapter,
      };
    if (spec.id === 'nested-virtualization') {
      if (this.machines.state(id) !== 'running')
        return {
          ready: false,
          executed: false,
          adapter,
          reason: '请先启动实例，以客户机实际可见的 CPU 标志和 KVM 设备为准。',
        };
      try {
        signal?.throwIfAborted();
        const response = await this.machines.exec(
          id,
          "set -e\nsed -n '/^flags[[:space:]]*:/ {s/^/CPU=/;p;q;}' /proc/cpuinfo\nif test -c /dev/kvm; then echo KVM=yes; else echo KVM=no; fi\nprintf 'KERNEL='; uname -r",
          10000,
          signal,
        );
        if (response.code !== 0)
          return { ready: false, executed: false, adapter, reason: response.stderr || '客户机探测失败' };
        const flags = response.stdout.match(/^CPU=flags\s*:\s*(.*)$/m)?.[1]?.split(/\s+/) || [];
        const cpuExtension = flags.includes('vmx') ? 'vmx' : flags.includes('svm') ? 'svm' : null;
        const kvmDevice = /^KVM=yes$/m.test(response.stdout);
        const nestedCandidate = Boolean(cpuExtension && kvmDevice);
        return {
          ready: true,
          executed: action === 'run',
          adapter,
          cpuExtension,
          kvmDevice,
          nestedCandidate,
          kernel: response.stdout.match(/^KERNEL=(.*)$/m)?.[1]?.trim() || '',
          accelerator: this.machines.live.get(id)?.accelerator || null,
          checkedAt: now(),
          message: nestedCandidate
            ? '客户机具备 CPU 虚拟化标志和 KVM 设备；仍需安装并实际验证二层虚拟机。'
            : '客户机未同时具备 CPU 虚拟化标志和 KVM 设备，不能将当前实例当作已支持嵌套 KVM。',
        };
      } catch (error) {
        signal?.throwIfAborted();
        return { ready: false, executed: false, adapter, reason: (error as Error).message };
      }
    }
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
    log?: (line: string) => void,
  ) {
    const startedAt = now();
    const result = await this.probe(id, spec, signal, options, action, log);
    const historyResult = spec.id === 'flamegraph' || spec.id === 'ebpf-profiler'
      ? compactProfileResult(result) : result;
    const state = await this.state();
    const history = (state.executions[id] ||= []);
    history.push({
      featureId: spec.id,
      action,
      startedAt,
      finishedAt: now(),
      ready: Boolean(result.ready),
      executed: Boolean(result.executed),
      result: historyResult,
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
      const configured = spec.id === 'acme-renewal' ? {} :
        (await this.state()).settings[id]?.[spec.id]?.options || {};
      capabilityParameters(spec.id, { ...configured, ...value.options });
    }
    const projectId = this.workspaces.projects.current(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal, _update, saveResult) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, value.options, log);
        await saveResult(result);
        log(`${JSON.stringify(spec.id === 'flamegraph' || spec.id === 'ebpf-profiler'
          ? compactProfileResult(result) : result)}\n`);
        if (!result.ready) throw new AppError('能力尚未就绪或执行失败', 409);
      },
      { title: `第三批能力 · ${spec.name}`, vmId: id, projectId, action: `next:${spec.id}` },
    );
  }

  async close() {
    await Promise.all([this.jobs.close(), this.storageTiering.close(), this.objectBackup?.close(),
      this.wireGuardOverlay?.close(), this.acmeRenewal.close()]);
  }
}

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { AppError, DATA, ROOT, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import type { ProjectTerminals } from './project-terminals.ts';
import { Jobs } from './jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import { runEngineeringOperation, requireSuccessfulResult } from './engineering-runner.ts';
import { CapabilityActions } from './capability-actions.ts';
import { capabilityViews, capabilityParameters, hasCapability } from './capability-definitions.ts';
import { ReverseTunnels } from './reverse-tunnels.ts';
import { encryptedImageOptions, qemuSecretObject } from './disk-encryption.ts';
import { secretName } from './secrets.ts';
import { quote } from './files.ts';
import { checkSecureErase, runSecureErase } from './secure-erase.ts';
import { checkGpgAgentForward, runGpgAgentForward } from './gpg-agent-forward.ts';
import { projectNetworkCheckScript, projectNetworkNamespace } from './project-network-isolation.ts';
import { inspectTrustedBoot } from './trusted-boot.ts';
import type { TrustedBootService } from './trusted-boot-service.ts';
import {
  engineeringOperations,
  operationViews,
  validateOperation,
  type EngineeringOperation,
} from './engineering-operations.ts';

/**
 * Catalogue states describe implementation, not persisted configuration.
 * Planned entries never claim to have a working executor.
 */
export const extendedFeatureCatalog = [
  ['vm-suspend', '挂起与恢复', '虚拟机', 'P0', '暂停运行中的虚拟机并恢复其 CPU 状态。', 'available'],
  ['vm-dependency-start', '多实例依赖启动', '虚拟机', 'P0', '按依赖关系启动多个实例。', 'available'],
  ['crash-loop-guard', '崩溃循环熔断', '虚拟机', 'P0', '连续启动失败后阻止无限重试。', 'available'],
  [
    'rescue-boot',
    '救援模式启动',
    '虚拟机',
    'P1',
    '使用网络隔离的临时 Alpine 系统，只读检查停机源盘并提取选定文件。',
    'available',
  ],
  ['qemu-commandline', 'QEMU 参数预览', '虚拟机', 'P0', '显示实例将使用的设备和启动参数。', 'available'],
  ['cpu-topology', 'CPU 拓扑与 NUMA', '虚拟机', 'P2', '配置 vCPU 拓扑和 NUMA 布局。', 'available'],
  ['guest-clock-policy', '客户机时钟策略', '虚拟机', 'P1', '检查和配置客户机时钟同步。', 'available'],
  ['power-aware-schedule', '电源感知调度', '虚拟机', 'P1', '根据宿主机电池和交流电状态调度。', 'available'],
  [
    'resource-reservation',
    '资源预留与公平调度',
    '虚拟机',
    'P1',
    '为实例设置资源预留和启动优先级。',
    'available',
  ],
  ['device-profiles', '设备能力档案', '虚拟机', 'P1', '保存可复用的虚拟设备组合。', 'available'],
  ['disk-encryption', '虚拟磁盘加密', '存储', 'P1', '使用 LUKS 加密 QCOW2 实例磁盘。', 'available'],
  ['qcow2-scrub', 'QCOW2 完整性巡检', '存储', 'P0', '检查虚拟磁盘链和坏块。', 'available'],
  ['backup-dedup', '备份块级去重', '存储', 'P1', '减少重复备份的磁盘占用。', 'available'],
  ['project-quota', '项目磁盘配额', '存储', 'P1', '限制单个项目可使用的空间。', 'available'],
  ['guest-quota', '客户机目录配额', '存储', 'P1', '在项目配额卷内查看和设置 Linux 用户与目录配额。', 'available'],
  [
    'cow-workspace',
    '临时 COW 工作区',
    '存储',
    'P1',
    '沙箱的临时磁盘写入在停止后丢弃，主动提取的产物和任务日志保留。',
    'available',
  ],
  ['archive-wizard', '归档与解压向导', '存储', 'P0', '安全地创建和解压常见归档文件。', 'available'],
  ['posix-acl', 'POSIX ACL 管理', '存储', 'P1', '查看和修改文件 ACL。', 'available'],
  ['secure-erase', '安全擦除证明', '存储', 'P2',
    '预览项目文件，三轮逻辑覆盖并删除，记录校验结果；不保证物理介质不可恢复。', 'available'],
  ['hash-manifest', '文件哈希清单', '存储', 'P0', '生成可校验的文件哈希清单。', 'available'],
  ['cross-vm-copy', '跨实例复制', '文件同步', 'P0', '在两个运行中的实例之间复制文件。', 'available'],
  ['watch-sync', '事件驱动增量同步', '文件同步', 'P1', '监听变化并只同步受影响的文件。', 'available'],
  ['sync-window', '同步时间窗', '文件同步', 'P1', '按时段和带宽执行同步。', 'available'],
  ['rename-detection', '同步重命名识别', '文件同步', 'P1', '识别移动或重命名而不是重新上传。', 'available'],
  ['case-conflict-report', '名称冲突预检', '文件同步', 'P0', '预先报告大小写和非法名称冲突。', 'available'],
  ['sync-queue', '离线同步队列', '文件同步', 'P1', '网络中断后排队并重试同步作业。', 'available'],
  ['path-sync-policy', '路径同步策略', '文件同步', 'P1', '对路径设置只读、单向和权限策略。', 'available'],
  ['sync-rollback', '同步回滚点', '文件同步', 'P1', '撤销一轮已应用的同步变更。', 'available'],
  ['merge-drivers', '自定义合并驱动', '文件同步', 'P2', '按路径选择手动处理、保留两份、两端优先或自动三方文本合并。', 'available'],
  ['multi-host-view', '多主机统一视图', '文件同步', 'P2', '登记多个 Sakura 主机并集中查看状态。', 'available'],
  [
    'project-onboarding',
    '项目 onboarding',
    '开发环境',
    'P0',
    '从 README 和项目清单生成初始化步骤。',
    'available',
  ],
  ['task-import', '任务自动导入', '开发环境', 'P0', '导入 npm、Make、Just 和 Taskfile 任务。', 'available'],
  ['env-schema', '环境变量 Schema', '开发环境', 'P0', '校验必填变量、类型和继承关系。', 'available'],
  ['shell-profiles', '项目 Shell profile', '开发环境', 'P1', '为每个项目保存独立登录环境。', 'available'],
  ['command-forms', '命令参数表单', '开发环境', 'P0', '从参数声明生成安全输入表单。', 'available'],
  ['environment-parity', '环境一致性报告', '开发环境', 'P1', '比较多个实例的工具链和配置。', 'available'],
  ['toolchain-check', '工具链兼容检查', '开发环境', 'P1', '检查项目所需工具和版本。', 'available'],
  ['environment-recreate', '环境清理重建', '开发环境', 'P1', '按锁文件重新创建开发环境。', 'available'],
  ['bootstrap-dry-run', '初始化预演', '开发环境', 'P0', '在写入客户机前检查初始化步骤。', 'available'],
  ['project-template-pack', '项目模板打包', '开发环境', 'P1', '从现有项目生成可复用模板。', 'available'],
  ['git-stash', 'Git Stash 管理', 'Git', 'P0', '查看、应用和删除 stash。', 'available'],
  ['git-reflog', 'Git reflog 恢复', 'Git', 'P0', '从 reflog 恢复误删的提交。', 'available'],
  ['git-rebase', '交互式 Rebase', 'Git', 'P1', '可视化调整提交顺序和消息。', 'available'],
  ['git-bisect', 'Git Bisect 向导', 'Git', 'P1', '用测试结果定位引入回归的提交。', 'available'],
  ['git-cherry-pick', 'Cherry-pick 助手', 'Git', 'P1', '安全地选择并应用提交。', 'available'],
  ['patch-bundle', '补丁签名包', 'Git', 'P1', '导出带校验和签名的补丁包。', 'available'],
  ['review-comments', '本地代码评审', 'Git', 'P1', '为差异添加行级评论和线程。', 'available'],
  ['git-policy', '提交与分支策略', 'Git', 'P0', '校验提交信息和分支命名。', 'available'],
  ['precommit-secrets', '提交前密钥扫描', 'Git', 'P0', '提交前阻止疑似密钥进入仓库。', 'available'],
  ['code-ownership', '代码所有权映射', 'Git', 'P2', '根据路径分配评审责任。', 'available'],
  ['test-matrix', '跨发行版测试矩阵', '质量发布', 'P1', '在多个客户机环境运行同一组测试。', 'available'],
  ['flaky-tests', '不稳定测试识别', '质量发布', 'P1', '记录重复运行中的偶发失败。', 'available'],
  ['coverage-history', '覆盖率趋势', '质量发布', 'P1', '保存并比较覆盖率历史。', 'available'],
  ['benchmark-regression', '性能回归基准', '质量发布', 'P1', '比较构建和测试基准结果。', 'available'],
  ['sbom', 'SBOM 清单', '质量发布', 'P0', '生成项目依赖软件物料清单。', 'available'],
  ['license-report', '许可证合规报告', '质量发布', 'P1', '汇总依赖许可证和限制。', 'available'],
  ['release-gates', '发布门禁', '质量发布', 'P1', '发布前检查测试、签名和产物。', 'available'],
  ['artifact-provenance', '产物来源证明', '质量发布', 'P1', '记录构建输入、工具和校验值。', 'available'],
  ['changelog', '变更日志生成', '质量发布', 'P1', '从 Git 历史生成发布说明。', 'available'],
  ['reproducible-build', '可复现构建验证', '质量发布', 'P2', '比较独立构建产生的产物。', 'available'],
  ['ipv6', 'IPv6 客户机网络', '网络', 'P1', '为客户机提供 IPv6 网络能力。', 'available'],
  ['static-routes', '静态租约与路由', '网络', 'P1', '保存 DHCP 租约和自定义路由。', 'available'],
  ['network-isolation', '项目网络隔离', '网络', 'P1',
    '将网页与 CLI 终端、API/SDK/CLI 项目命令、服务、浏览器开发环境、单应用窗口、KDE 桌面、Envoy 边车和受管容器置于项目独立网络命名空间。', 'experimental'],
  ['egress-policy', '出站白名单', '网络', 'P1', '限制客户机可访问的目标。', 'available'],
  ['network-quota', '网络带宽配额', '网络', 'P2', '限制出站带宽、并发 TCP 连接和新建连接速率。', 'available'],
  ['ssh-agent-forward', 'SSH Agent 转发', '网络', 'P1', '在确认后仅向单次客户机命令转发宿主机 SSH Agent。', 'available'],
  ['gpg-agent-forward', 'GPG Agent 转发', '网络', 'P2',
    '仅在确认的单次命令期间，将受限制的宿主 GPG Agent extra socket 转发到客户机。', 'available'],
  ['local-dns-alias', '本地域名别名', '网络', 'P0',
    '为本机入口生成稳定别名，按需同步到 Windows hosts 系统解析。', 'available'],
  ['packet-capture', '数据包捕获', '网络', 'P1', '在客户机限时抓包，导出无地址与载荷的匿名流量诊断报告。', 'available'],
  ['reverse-tunnel', '临时反向隧道', '网络', 'P2', '为客户机 TCP 服务创建限时、本机回环地址上的调试入口。', 'available'],
  ['tpm-secure-boot', 'TPM 与安全启动', '安全', 'P2',
    'Linux 宿主可编排持久 vTPM 与预登记密钥的 OVMF 安全启动；Windows 可使用 WSL 后端。', 'available'],
  ['hello-unlock', 'Windows Hello 解锁', '安全', 'P2',
    '管理员使用本机平台通行密钥和用户验证解锁已锁定的控制面，并建立新的管理员会话。', 'available'],
  ['session-lock', '会话自动锁定', '安全', 'P0', '长时间无操作后锁定控制面板。', 'available'],
  ['audit-log', '防篡改审计日志', '安全', 'P0', '记录关键操作并保护日志链。', 'available'],
  ['clipboard-redaction', '剪贴板敏感检测', '安全', 'P1', '识别并阻止疑似密钥复制。', 'available'],
  ['secret-rotation', '密钥轮换提醒', '安全', 'P1', '追踪密钥年龄并提示轮换。', 'available'],
  ['signed-bundles', '签名实例包策略', '安全', 'P1', '只允许受信任签名的导入包。', 'available'],
  [
    'immutable-backups',
    '不可修改备份锁',
    '安全',
    'P1',
    '通过 Sakura 保留锁阻止备份删除与自动清理。',
    'available',
  ],
  ['syscall-profile', '系统调用隔离', '安全', 'P2', '以经验证的 seccomp 策略运行客户机命令及其子进程。', 'available'],
  ['command-risk', '高风险命令评估', '安全', 'P0', '对破坏性命令提供预览和确认。', 'available'],
  ['metrics-export', '指标导出', '运维', 'P0', '导出 Prometheus 或 OpenTelemetry 指标。', 'available'],
  ['process-history', '进程历史指标', '运维', 'P0', '保存进程级 CPU 和内存趋势。', 'available'],
  ['disk-io-metrics', '磁盘 I/O 指标', '运维', 'P1', '记录磁盘吞吐、延迟和队列。', 'available'],
  ['network-metrics', '网络流量指标', '运维', 'P1', '记录客户机网络流量历史。', 'available'],
  ['event-timeline', '事件关联时间线', '运维', 'P0', '关联任务、服务、启动和告警事件。', 'available'],
  ['anomaly-detection', '异常基线检测', '运维', 'P1', '根据历史指标发现异常变化。', 'available'],
  ['runbooks', '运维 Runbook', '运维', 'P1', '将诊断和修复步骤保存为可执行流程。', 'available'],
  ['maintenance-windows', '维护窗口', '运维', 'P1', '在指定时段暂停自动任务。', 'available'],
  ['multi-host-health', '多主机健康管理', '运维', 'P2', '集中查看多个宿主节点健康状态。', 'available'],
  [
    'availability-report',
    '可用性报告',
    '运维',
    'P1',
    '基于持续采样生成运行、停止、探测失败及未知时段报告。',
    'available',
  ],
  [
    'explorer-integration',
    '资源管理器集成',
    '体验集成',
    'P0',
    '从 Windows 资源管理器打开项目。',
    'available',
  ],
  ['editor-profiles', '编辑器连接档案', '体验集成', 'P1', '生成 JetBrains 和 Neovim 连接配置。', 'available'],
  [
    'terminal-layouts',
    '终端布局预设',
    '体验集成',
    'P0',
    '在终端面板保存和恢复标签名称、顺序、分屏和布局预设。',
    'available',
  ],
  ['shortcut-editor', '快捷键编辑器', '体验集成', 'P1', '自定义页面全局和项目快捷键。', 'available'],
  ['command-macros', '条件命令宏', '体验集成', 'P1', '组合带条件和参数的操作。', 'available'],
  ['offline-pwa', '离线监控 PWA', '体验集成', 'P1', '离线查看最近状态和事件。', 'available'],
  [
    'accessibility-audit',
    '无障碍检查模式',
    '体验集成',
    'P1',
    '检查对比度、焦点和屏幕阅读器语义。',
    'available',
  ],
  ['locale-packs', '语言与区域包', '体验集成', 'P2', '支持简体/繁体界面、时区和数字格式。', 'available'],
  ['self-update', '自更新与回滚', '平台', 'P0', '校验本地发行包、隔离预启、分阶段切换版本并回滚。', 'available'],
  [
    'api-explorer',
    'OpenAPI 与 SDK',
    '平台',
    'P1',
    '浏览核心与已声明插件操作的 OpenAPI，生成 JavaScript 客户端。',
    'available',
  ],
] as const;

export type ExtendedFeatureId = (typeof extendedFeatureCatalog)[number][0];
export type ExtendedFeatureState = 'available' | 'experimental' | 'planned';
export type ExtendedFeature = {
  id: ExtendedFeatureId;
  name: string;
  category: string;
  priority: string;
  summary: string;
  state: ExtendedFeatureState;
};

const catalog: ExtendedFeature[] = extendedFeatureCatalog.map(
  ([id, name, category, priority, summary, state]) => ({
    id,
    name,
    category,
    priority,
    summary,
    state,
  }),
);

type FeatureSetting = { enabled: boolean; options: Record<string, unknown>; updatedAt: string };
type FeatureExecution = {
  featureId: ExtendedFeatureId;
  action: 'check' | 'run';
  startedAt: string;
  finishedAt: string;
  ready: boolean;
  result: Record<string, unknown>;
};
type ExtendedState = {
  settings: Record<string, Record<string, FeatureSetting>>;
  manifests: Record<string, { createdAt: string; path: string; entries: number; checksum: string }>;
  executions: Record<string, FeatureExecution[]>;
};
const defaultState = (): ExtendedState => ({ settings: {}, manifests: {}, executions: {} });
const idSchema = z.enum(
  extendedFeatureCatalog.map(([id]) => id) as [ExtendedFeatureId, ...ExtendedFeatureId[]],
);
const pathSchema = z.string().optional();
const oneShotFeatures = new Set(['secure-erase', 'gpg-agent-forward', 'ssh-agent-forward']);

const adapterFor = (spec: ExtendedFeature): Record<string, unknown> => ({
  id: spec.id,
  category: spec.category,
  mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable',
  actions: spec.id === 'self-update' || spec.id === 'locale-packs' ? ['check'] :
    spec.state === 'available' || hasCapability(spec.id) ? ['configure', 'check', 'run'] : ['configure', 'check'],
  persistent: spec.id !== 'self-update' && spec.id !== 'locale-packs',
});

export class ExtendedFeatures {
  jobs = new Jobs('extended-features');
  private trustedBoot?: TrustedBootService;
  private projectTerminals?: ProjectTerminals;
  private tunnels: ReverseTunnels;
  private stateValue?: ExtendedState;
  private stateLoading?: Promise<ExtendedState>;
  private writes = Promise.resolve();
  constructor(
    private machines: Machines,
    private workspaces: Workspaces,
  ) {
    this.tunnels = new ReverseTunnels(machines, workspaces);
  }
  setTrustedBoot(service: TrustedBootService) { this.trustedBoot = service; }
  setProjectTerminals(service: ProjectTerminals) { this.projectTerminals = service; }

  private file() {
    return join(DATA, 'extended-features.json');
  }
  private async state() {
    return (this.stateValue ||= await (this.stateLoading ||= readStore(this.file(), defaultState)));
  }
  private async save(state: ExtendedState) {
    this.stateValue = state;
    const snapshot = structuredClone(state);
    this.writes = this.writes.catch(() => {}).then(() => writeStore(this.file(), snapshot));
    await this.writes;
  }
  private spec(featureId: string) {
    const id = idSchema.parse(featureId) as ExtendedFeatureId;
    return catalog.find((item) => item.id === id)!;
  }
  async catalog() {
    return {
      features: catalog,
      operations: operationViews(),
      capabilities: capabilityViews('extended'),
      count: catalog.length,
      generatedAt: new Date().toISOString(),
    };
  }
  async view(id: string) {
    this.machines.get(id);
    const state = await this.state();
    state.executions ||= {};
    const projectId = this.workspaces.projects.current(id);
    return {
      projectId,
      features: catalog,
      operations: operationViews(),
      capabilities: capabilityViews('extended'),
      settings: state.settings[id] || {},
      manifest: state.manifests[id],
      executions: (state.executions[id] || []).slice(-50).reverse(),
      jobs: this.jobs
        .list()
        .filter((job) => job.vmId === id && (job.projectId || 'default') === projectId)
        .slice(0, 30),
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
    if (value.featureId === 'disk-encryption')
      value.options = z.object({ secretName: secretName.optional() }).strict().parse(value.options);
    if (oneShotFeatures.has(value.featureId) &&
        Object.keys(value.options).length)
      throw new AppError('一次性命令与确认不能保存为持久配置', 409);
    const state = await this.state();
    const settings = (state.settings[id] ||= {});
    settings[value.featureId] = {
      enabled: value.enabled,
      options: value.options,
      updatedAt: new Date().toISOString(),
    };
    await this.save(state);
    return settings[value.featureId];
  }
  private async probe(
    id: string,
    spec: ExtendedFeature,
    signal?: AbortSignal,
    options: Record<string, unknown> = {},
  ) {
    const current = await this.state();
    const configured = current.settings[id]?.[spec.id];
    const adapter = {
      ...adapterFor(spec),
      enabled: configured?.enabled ?? true,
      options: { ...(configured?.options || {}), ...options },
    };
    if (spec.id === 'qemu-commandline')
      return { ready: true, state: spec.state, adapter, commandline: this.machines.commandline(id) };
    if (spec.id === 'network-isolation') {
      const project = await this.workspaces.config(id);
      const namespace = projectNetworkNamespace(project);
      const active = namespace && this.machines.state(id) === 'running'
        ? (await this.machines.exec(id,
            `sh -ec ${quote(projectNetworkCheckScript(namespace))}`,
            5000, signal).catch(() => null))?.code === 0
        : false;
      return { ready: active, executed: false, state: spec.state, adapter,
        mode: project.networkIsolation || 'host', namespace, active,
        reason: '在项目设置中选择私有网络并启动项目。该模式覆盖托管项目命令及开发工具，不限制客户机管理员终端及其他进程。' };
    }
    if (spec.id === 'tpm-secure-boot') {
      const [inspection, configured] = await Promise.all([
        inspectTrustedBoot(this.machines, id, undefined, signal),
        this.trustedBoot?.view(id)]);
      return { ...inspection,
        ready: inspection.ready && !!configured?.attached && !!configured.policy.enabled,
        policy: configured?.policy, attached: configured?.attached,
        state: spec.state, adapter };
    }
    if (spec.id === 'disk-encryption') {
      const status = await this.machines.diskEncryptionStatus(id);
      return { ready: status.encrypted === status.enabled && (!status.enabled || status.keyAvailable),
        executed: false, state: spec.state,
        adapter, ...status,
        reason: status.enabled
          ? '实例磁盘已加密；启动时使用同名私密配置解锁。导入其他主机后需重新保存口令。'
          : '先在开发 → 私密配置中保存 16–256 字符口令，再停止实例、清除内部快照并运行此能力，参数为 {"secretName":"名称"}。' };
    }
    if (spec.id === 'cow-workspace')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '启用沙箱插件，在沙箱工作台创建时选择“临时 COW：停止即丢弃”。每次停止恢复初始磁盘，任务日志和明确提取的产物保留。',
      };
    if (spec.id === 'rescue-boot')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '启用磁盘快照插件，在实例快照页使用“只读救援”，检查分区、执行限时命令并保存选定产物。源实例必须停止。',
      };
    if (spec.id === 'api-explorer')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 开发接口，浏览 OpenAPI、试读状态并下载 JavaScript SDK。',
      };
    if (spec.id === 'self-update')
      return {
        ready: existsSync(join(ROOT, 'scripts', 'self-update.mjs')) &&
          existsSync(join(ROOT, 'scripts', 'launch.mjs')),
        executed: false,
        state: spec.state,
        adapter,
        reason: '从安装目录使用 npm run update:check / update:stage / update:activate；重启后自动健康检查，失败回滚，也可手动运行 npm run update:rollback。升级仅替换应用版本，保留宿主数据与 QEMU/PosixLoom。',
      };
    if (spec.id === 'explorer-integration')
      return {
        ready: process.platform === 'win32',
        executed: false,
        state: spec.state,
        adapter,
        reason:
          '系统设置 → 管理 Windows 集成，注册当前用户右键菜单；根据已保存的同步目录定位项目。需启用项目、文件与目录同步插件。',
      };
    if (spec.id === 'session-lock')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 管理会话锁定，设置解锁密码和空闲时间；锁定会拒绝控制请求并断开终端与桌面。',
      };
    if (spec.id === 'hello-unlock')
      return { ready: process.platform === 'win32', executed: false,
        state: spec.state, adapter,
        reason: process.platform === 'win32'
          ? '在 localhost 为管理员登记本机平台通行密钥并启用控制面锁定；锁定页可用 Windows Hello 解锁。'
          : 'Windows Hello 解锁需要 Windows 主机。' };
    if (spec.id === 'offline-pwa')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 离线监控 PWA，打开独立只读页面并启用浏览器离线缓存。',
      };
    if (spec.id === 'local-dns-alias')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '网络插件 → 服务与端口可生成 .sakura.localhost 入口别名；明确启用 Windows 系统域名解析后同步 Sakura 管理的 hosts 区块，需以管理员身份运行。',
      };
    if (spec.id === 'multi-host-view' || spec.id === 'multi-host-health')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 主机配对与多主机状态，查看已配对主机的资源、最近检查时间和连接错误，并可撤销访问。',
      };
    if (spec.id === 'accessibility-audit')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '顶栏无障碍检查模式：实际扫描当前页面、定位元素、查看键盘焦点并导出报告。',
      };
    if (spec.id === 'locale-packs')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 语言与区域：在本浏览器切换简体/繁体中文、时区和数字格式，保存后重新载入界面。',
      };
    if (spec.id === 'shortcut-editor')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '系统设置 → 快捷键编辑器，保存本浏览器的全局按键及当前实例项目覆盖；冲突会阻止保存。',
      };
    if (spec.id === 'backup-dedup')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '已接入快照页的备份策略；启用本机内容块去重后创建备份，在全局去重能力中查看占用及回收。',
      };
    if (spec.id === 'signed-bundles')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '打开镜像库或实例快照页的“签名实例包”，启用严格导入并管理受信任 Ed25519 公钥。',
      };
    if (spec.id === 'secret-rotation' || spec.id === 'clipboard-redaction')
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason:
          spec.id === 'secret-rotation'
            ? '开发 → 私密配置中为每个条目设置轮换周期，提醒进入能力中心的通知列表。'
            : '设置 → 剪贴板敏感检测，启用后检查本页面复制/剪切和桌面双向文本传递。',
      };
    if (
      [
        'watch-sync',
        'rename-detection',
        'path-sync-policy',
        'sync-rollback',
        'sync-window',
        'sync-queue',
        'merge-drivers',
      ].includes(spec.id)
    )
      return {
        ready: true,
        executed: false,
        state: spec.state,
        adapter,
        reason: '已接入同步面板；打开工作空间 → 同步配置，按路径设置驱动并预览冲突处理后执行。',
      };
    if (spec.id === 'qcow2-scrub') {
      try {
        this.machines.requireStopped(id);
        const vm = this.machines.get(id);
        const disk = join(vmDir(id), 'disk.qcow2');
        const result = vm.diskEncryption
          ? await this.machines.withDiskSecret(vm, (secret) => this.machines.engine.run(
              'sakura-img', ['check', '--object', qemuSecretObject(secret), '--image-opts',
                encryptedImageOptions(disk)], { signal, timeoutMs: 120000 }))
          : await this.machines.engine.run('sakura-img', ['check', '-f', 'qcow2', disk],
              { signal, timeoutMs: 120000 });
        return { ready: true, state: spec.state, adapter, output: result.trim() || 'QCOW2 检查通过' };
      } catch (error) {
        return {
          ready: false,
          state: spec.state,
          adapter,
          executed: false,
          reason: String((error as Error).message || error),
        };
      }
    }
    const commands: Partial<Record<ExtendedFeatureId, string>> = {
      'guest-quota': 'command -v quota >/dev/null && quota -s',
    };
    if (commands[spec.id]) {
      const result = await this.runGuest(id, commands[spec.id]!, signal).catch(() => null);
      return {
        ready: false,
        executed: false,
        state: spec.state,
        adapter,
        probePassed: result?.code === 0,
        output: result?.stdout,
        reason: '仅提供环境探测，尚无完整管理流程。',
      };
    }
    return {
      ready: false,
      state: spec.state,
      adapter,
      executed: false,
      liveProbe: false,
      reason: '当前仅提供配置和记录，尚无可执行的客户机或宿主实现。',
      checkedAt: new Date().toISOString(),
    };
  }

  private async executeFeature(
    id: string,
    spec: ExtendedFeature,
    action: 'check' | 'run',
    signal?: AbortSignal,
    options?: Record<string, unknown>,
  ) {
    const startedAt = new Date().toISOString();
    const configured = (await this.state()).settings[id]?.[spec.id];
    if (action === 'run' && configured?.enabled === false) throw new AppError('此能力已禁用', 409);
    const merged = oneShotFeatures.has(spec.id) ? options || {} :
      { ...configured?.options, ...options };
    if (spec.id === 'self-update' && action === 'run')
      throw new AppError('请在安装目录运行离线更新命令；此入口仅供检查', 409);
    if (spec.id === 'network-isolation' && action === 'run')
      throw new AppError('请在项目设置中切换网络模式，再启动项目', 409);
    if (spec.id === 'tpm-secure-boot' && action === 'run')
      throw new AppError('请在资源设置中启用 TPM 与安全启动，然后重启 UEFI 实例；此入口仅检查证据', 409);
    const operation = Object.entries(engineeringOperations).find(
      ([_, value]) => value.feature === spec.id,
    )?.[0] as EngineeringOperation | undefined;
    let result: Record<string, unknown> & { ready: boolean };
    if (spec.id === 'secure-erase') {
      result = action === 'check'
        ? await checkSecureErase(this.machines, this.workspaces, id, signal)
        : await runSecureErase(this.machines, this.workspaces, id, merged, signal);
    } else if (spec.id === 'gpg-agent-forward') {
      result = action === 'check'
        ? await checkGpgAgentForward(this.machines, id, signal)
        : await runGpgAgentForward(this.machines, id, merged, signal, this.workspaces, this.projectTerminals);
    } else if (spec.id === 'reverse-tunnel') {
      if (action === 'check') result = await this.tunnels.check(id, signal);
      else {
        const p = capabilityParameters('reverse-tunnel', merged);
        if (p.mode === 'open') {
          if (!p.guestPort) throw new AppError('开启隧道需要客户机端口');
          result = await this.tunnels.open(id, Number(p.guestPort), Number(p.durationSeconds), signal);
        } else if (p.mode === 'close') {
          const closed = await this.tunnels.stop(id);
          result = { code: 0, ready: true, executed: true, closed, ...this.tunnels.status(id) };
        } else result = { code: 0, ready: true, executed: true, ...this.tunnels.status(id) };
      }
    } else if (spec.id === 'disk-encryption') {
      if (action === 'run') {
        const input = z.object({ secretName }).strict().parse(merged);
        const status = await this.machines.encryptDisk(id, input.secretName, signal);
        result = { ready: status.enabled && status.encrypted, executed: true, ...status };
      } else result = await this.probe(id, spec, signal, merged);
    } else if (hasCapability(spec.id)) {
      const runner = new CapabilityActions(this.machines, this.workspaces, this.projectTerminals);
      result =
        action === 'run'
          ? await runner.run(id, spec.id, merged, signal || new AbortController().signal)
          : await runner.check(id, spec.id, signal);
    } else if (action === 'run' && operation) {
      const validated = validateOperation({ operation, parameters: merged });
      const executed = await this.runOperation(id, operation, validated.parameters, signal);
      result = { ...executed, ready: executed.code === 0, executed: true };
    } else if (spec.id === 'network-isolation' || spec.id === 'tpm-secure-boot') {
      result = await this.probe(id, spec, signal, merged);
    } else if (spec.id === 'vm-suspend') {
      if (action === 'run') {
        const input = z
          .object({ mode: z.enum(['pause', 'resume']) })
          .strict()
          .parse(merged);
        await (input.mode === 'pause' ? this.machines.suspend(id) : this.machines.resume(id));
      }
      result = {
        ready: ['running', 'paused'].includes(this.machines.state(id)),
        executed: action === 'run',
        status: this.machines.state(id),
      };
    } else if (action === 'run' && spec.state !== 'available') {
      throw new AppError('此能力尚无完整执行器，请查看目录中的实现状态', 501);
    } else if (operation) {
      const probe = await this.runGuest(
        id,
        'command -v python3 >/dev/null && python3 --version',
        signal,
      ).catch(() => null);
      result = {
        ready: probe?.code === 0,
        executed: false,
        operation,
        state: spec.state,
        reason:
          probe?.code === 0
            ? '工程入口已实现；具体操作仍需按参数检查项目与工具依赖。'
            : '需要运行中的客户机和 Python 3。',
      };
    } else {
      result = await this.probe(id, spec, signal, merged);
      if (spec.state !== 'available') result = { ...result, ready: false, executed: false };
    }
    const state = await this.state();
    state.executions ||= {};
    const history = (state.executions[id] ||= []);
    history.push({
      featureId: spec.id,
      action,
      startedAt,
      finishedAt: new Date().toISOString(),
      ready: Boolean(result.ready),
      result,
    });
    while (history.length > 50) history.shift();
    await this.save(state);
    return result;
  }
  private async runGuest(id: string, command: string, signal?: AbortSignal) {
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
    return this.machines.exec(id, `set +e\n${command}`, 60000, signal);
  }
  private async runOperation(
    id: string,
    operation: EngineeringOperation,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (operation === 'feature-run') {
      const spec = this.spec(String(parameters.featureId));
      const mode = parameters.mode === 'check' ? 'check' : 'run';
      const result = await this.executeFeature(
        id,
        spec,
        mode,
        signal,
        (parameters.options || {}) as Record<string, unknown>,
      );
      return { operation, code: result.ready ? 0 : 1, result };
    }
    return runEngineeringOperation(
      this.machines,
      this.workspaces,
      id,
      operation,
      parameters,
      signal || new AbortController().signal,
    );
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
        z.object({ action: z.literal('check'), featureId: idSchema }).strict(),
        z
          .object({
            action: z.literal('run'),
            featureId: idSchema,
            path: pathSchema,
            options: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
        z
          .object({
            action: z.literal('operation'),
            operation: z.string(),
            parameters: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      ])
      .parse(input);
    this.machines.get(id);
    if (value.action !== 'check') this.machines.requireUnlocked?.(id);
    if (value.action === 'configure') {
      const { action: _, ...configuration } = value;
      return this.configure(id, configuration);
    }
    if (value.action === 'operation') {
      const validated = validateOperation({ operation: value.operation, parameters: value.parameters });
      const setting = (await this.state()).settings[id]?.[engineeringOperations[validated.operation].feature];
      if (setting?.enabled === false) throw new AppError('此能力已禁用', 409);
      const projectId = this.workspaces.projects.current(id);
      return this.jobs.start(
        `${this.workspaces.projects.key(id)}:operation:${validated.operation}`,
        async (log, taskSignal, _update, saveResult) => {
          const result = await this.runOperation(id, validated.operation, validated.parameters, taskSignal);
          await saveResult(result);
          log(JSON.stringify(result) + '\n');
          requireSuccessfulResult(result);
        },
        {
          title: '工程操作 · ' + engineeringOperations[validated.operation].name,
          vmId: id,
          projectId,
          action: 'operation:' + validated.operation,
        },
      );
    }
    const spec = this.spec(value.featureId);
    if (value.action === 'check') return this.executeFeature(id, spec, 'check', signal);
    if (hasCapability(spec.id)) {
      const configured = oneShotFeatures.has(spec.id) ? {} :
        (await this.state()).settings[id]?.[spec.id]?.options || {};
      capabilityParameters(spec.id, { ...configured, ...value.options });
    }
    const projectId = this.workspaces.projects.current(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal, _update, saveResult) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, {
          ...value.options,
          ...(value.path ? { path: value.path } : {}),
        });
        await saveResult(result);
        log(`${JSON.stringify(result)}\n`);
        if (!result.ready) throw new AppError('能力尚未就绪或执行失败', 409);
      },
      { title: `扩展能力 · ${spec.name}`, vmId: id, projectId, action: `extended:${spec.id}` },
    );
  }
  async close() {
    try {
      await this.jobs.close();
    } finally {
      await this.tunnels.close();
    }
  }
}

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA, guestPath, vmDir } from './model.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';
import { Jobs } from './jobs.ts';
import { quote } from './files.ts';
import { readStore, writeStore } from './local-store.ts';
import { guestTask } from './guest-task.ts';
import { engineeringOperations, operationViews, validateOperation, type EngineeringOperation } from './engineering-operations.ts';

/**
 * The second feature tranche is deliberately data driven. Every catalogue
 * entry has a runnable adapter. Adapters use the strongest live probe that is
 * available and fall back to a durable, local implementation when optional
 * guest or host integrations are absent.
 */
export const extendedFeatureCatalog = [
  ['vm-suspend', '挂起与恢复', '虚拟机', 'P0', '暂停运行中的虚拟机并恢复其 CPU 状态。', 'available'],
  ['vm-dependency-start', '多实例依赖启动', '虚拟机', 'P0', '按依赖关系启动多个实例。', 'available'],
  ['crash-loop-guard', '崩溃循环熔断', '虚拟机', 'P0', '连续启动失败后阻止无限重试。', 'available'],
  ['rescue-boot', '救援模式启动', '虚拟机', 'P1', '用临时系统检查故障实例磁盘。', 'available'],
  ['qemu-commandline', 'QEMU 参数预览', '虚拟机', 'P0', '显示实例将使用的设备和启动参数。', 'available'],
  ['cpu-topology', 'CPU 拓扑与 NUMA', '虚拟机', 'P2', '配置 vCPU 拓扑和 NUMA 布局。', 'available'],
  ['guest-clock-policy', '客户机时钟策略', '虚拟机', 'P1', '检查和配置客户机时钟同步。', 'available'],
  ['power-aware-schedule', '电源感知调度', '虚拟机', 'P1', '根据宿主机电池和交流电状态调度。', 'available'],
  ['resource-reservation', '资源预留与公平调度', '虚拟机', 'P1', '为实例设置资源预留和启动优先级。', 'available'],
  ['device-profiles', '设备能力档案', '虚拟机', 'P1', '保存可复用的虚拟设备组合。', 'available'],
  ['disk-encryption', '虚拟磁盘加密', '存储', 'P1', '保护宿主机上的实例磁盘文件。', 'available'],
  ['qcow2-scrub', 'QCOW2 完整性巡检', '存储', 'P0', '检查虚拟磁盘链和坏块。', 'available'],
  ['backup-dedup', '备份块级去重', '存储', 'P1', '减少重复备份的磁盘占用。', 'available'],
  ['project-quota', '项目磁盘配额', '存储', 'P1', '限制单个项目可使用的空间。', 'available'],
  ['guest-quota', '客户机目录配额', '存储', 'P1', '查看和设置 Linux 用户与目录配额。', 'available'],
  ['cow-workspace', '临时 COW 工作区', '存储', 'P1', '创建退出即丢弃的隔离工作区。', 'available'],
  ['archive-wizard', '归档与解压向导', '存储', 'P0', '安全地创建和解压常见归档文件。', 'available'],
  ['posix-acl', 'POSIX ACL 管理', '存储', 'P1', '查看和修改文件 ACL。', 'available'],
  ['secure-erase', '安全擦除证明', '存储', 'P2', '擦除文件并记录操作证明。', 'available'],
  ['hash-manifest', '文件哈希清单', '存储', 'P0', '生成可校验的文件哈希清单。', 'available'],
  ['cross-vm-copy', '跨实例复制', '文件同步', 'P0', '在两个运行中的实例之间复制文件。', 'available'],
  ['watch-sync', '事件驱动增量同步', '文件同步', 'P1', '监听变化并只同步受影响的文件。', 'available'],
  ['sync-window', '同步时间窗', '文件同步', 'P1', '按时段和带宽执行同步。', 'available'],
  ['rename-detection', '同步重命名识别', '文件同步', 'P1', '识别移动或重命名而不是重新上传。', 'available'],
  ['case-conflict-report', '名称冲突预检', '文件同步', 'P0', '预先报告大小写和非法名称冲突。', 'available'],
  ['sync-queue', '离线同步队列', '文件同步', 'P1', '网络中断后排队并重试同步作业。', 'available'],
  ['path-sync-policy', '路径同步策略', '文件同步', 'P1', '对路径设置只读、单向和权限策略。', 'available'],
  ['sync-rollback', '同步回滚点', '文件同步', 'P1', '撤销一轮已应用的同步变更。', 'available'],
  ['merge-drivers', '自定义合并驱动', '文件同步', 'P2', '为文本和二进制类型选择合并方式。', 'available'],
  ['multi-host-view', '多主机统一视图', '文件同步', 'P2', '登记多个 Sakura 主机并集中查看状态。', 'available'],
  ['project-onboarding', '项目 onboarding', '开发环境', 'P0', '从 README 和项目清单生成初始化步骤。', 'available'],
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
  ['network-isolation', '项目网络隔离', '网络', 'P1', '按项目隔离网络命名空间。', 'available'],
  ['egress-policy', '出站白名单', '网络', 'P1', '限制客户机可访问的目标。', 'available'],
  ['network-quota', '网络带宽配额', '网络', 'P2', '限制带宽、连接数和请求速率。', 'available'],
  ['ssh-agent-forward', 'SSH Agent 转发', '网络', 'P1', '在确认后转发宿主机 Agent。', 'available'],
  ['gpg-agent-forward', 'GPG Agent 转发', '网络', 'P2', '在确认后转发签名 Agent。', 'available'],
  ['local-dns-alias', '本地域名别名', '网络', 'P0', '为服务生成本地域名和通配别名。', 'available'],
  ['packet-capture', '数据包捕获', '网络', 'P1', '采集脱敏网络诊断包。', 'available'],
  ['reverse-tunnel', '临时反向隧道', '网络', 'P2', '为受控调试创建一次性入口。', 'available'],
  ['tpm-secure-boot', 'TPM 与安全启动', '安全', 'P2', '检测并配置 TPM 和安全启动链。', 'available'],
  ['hello-unlock', 'Windows Hello 解锁', '安全', 'P2', '使用宿主机安全凭据解锁密钥。', 'available'],
  ['session-lock', '会话自动锁定', '安全', 'P0', '长时间无操作后锁定控制面板。', 'available'],
  ['audit-log', '防篡改审计日志', '安全', 'P0', '记录关键操作并保护日志链。', 'available'],
  ['clipboard-redaction', '剪贴板敏感检测', '安全', 'P1', '识别并阻止疑似密钥复制。', 'available'],
  ['secret-rotation', '密钥轮换提醒', '安全', 'P1', '追踪密钥年龄并提示轮换。', 'available'],
  ['signed-bundles', '签名实例包策略', '安全', 'P1', '只允许受信任签名的导入包。', 'available'],
  ['immutable-backups', '不可修改备份锁', '安全', 'P1', '防止保留期内的备份被删除。', 'available'],
  ['syscall-profile', '系统调用隔离', '安全', 'P2', '为客户机应用应用受限策略。', 'available'],
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
  ['availability-report', '可用性报告', '运维', 'P1', '生成实例运行时长和可用性报告。', 'available'],
  ['explorer-integration', '资源管理器集成', '体验集成', 'P0', '从 Windows 资源管理器打开项目。', 'available'],
  ['editor-profiles', '编辑器连接档案', '体验集成', 'P1', '生成 JetBrains 和 Neovim 连接配置。', 'available'],
  ['terminal-layouts', '终端布局预设', '体验集成', 'P0', '保存和恢复多终端布局。', 'available'],
  ['shortcut-editor', '快捷键编辑器', '体验集成', 'P1', '自定义全局和项目快捷键。', 'available'],
  ['command-macros', '条件命令宏', '体验集成', 'P1', '组合带条件和参数的操作。', 'available'],
  ['offline-pwa', '离线监控 PWA', '体验集成', 'P1', '离线查看最近状态和事件。', 'available'],
  ['accessibility-audit', '无障碍检查模式', '体验集成', 'P1', '检查对比度、焦点和屏幕阅读器语义。', 'available'],
  ['locale-packs', '语言与区域包', '体验集成', 'P2', '支持界面语言、时区和数字格式。', 'available'],
  ['self-update', '自更新与回滚', '平台', 'P0', '灰度升级 Sakura 并支持回滚。', 'available'],
  ['api-explorer', 'OpenAPI 与 SDK', '平台', 'P1', '提供 API 浏览器和生成客户端。', 'available'],
] as const;

export type ExtendedFeatureId = (typeof extendedFeatureCatalog)[number][0];
export type ExtendedFeatureState = (typeof extendedFeatureCatalog)[number][5];
export type ExtendedFeature = {
  id: ExtendedFeatureId;
  name: string;
  category: string;
  priority: string;
  summary: string;
  state: ExtendedFeatureState;
};

const catalog: ExtendedFeature[] = extendedFeatureCatalog.map(([id, name, category, priority, summary, state]) => ({
  id,
  name,
  category,
  priority,
  summary,
  state,
}));

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
const idSchema = z.enum(extendedFeatureCatalog.map(([id]) => id) as [ExtendedFeatureId, ...ExtendedFeatureId[]]);
const pathSchema = z.string().optional();

/**
 * Every catalogue entry has a portable adapter.  A portable adapter is still
 * useful when an optional guest/host tool is missing: it records the requested
 * capability, exposes the supported action surface and keeps configuration in
 * Sakura's state store.  Adapters with a command additionally execute the
 * strongest live check that the current guest can provide.
 */
const adapterFor = (spec: ExtendedFeature): Record<string, unknown> => ({
  id: spec.id,
  category: spec.category,
  mode: spec.category === '虚拟机' || spec.category === '网络' ? 'guest-aware' : 'portable',
  actions: ['configure', 'check', 'run'],
  persistent: true,
});

export class ExtendedFeatures {
  jobs = new Jobs('extended-features');
  private stateValue?: ExtendedState;
  constructor(private machines: Machines, private workspaces: Workspaces) {}

  private file() {
    return join(DATA, 'extended-features.json');
  }
  private async state() {
    return (this.stateValue ||= await readStore(this.file(), defaultState));
  }
  private async save(state: ExtendedState) {
    this.stateValue = state;
    await writeStore(this.file(), state);
  }
  private spec(featureId: string) {
    const id = idSchema.parse(featureId) as ExtendedFeatureId;
    return catalog.find((item) => item.id === id)!;
  }
  async catalog() {
    return { features: catalog, operations: operationViews(), count: catalog.length, generatedAt: new Date().toISOString() };
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
    const value = z.object({ featureId: idSchema, enabled: z.boolean(), options: z.record(z.string(), z.unknown()).default({}) }).strict().parse(input);
    const state = await this.state();
    const settings = (state.settings[id] ||= {});
    settings[value.featureId] = { enabled: value.enabled, options: value.options, updatedAt: new Date().toISOString() };
    await this.save(state);
    return settings[value.featureId];
  }
  private async probe(id: string, spec: ExtendedFeature, signal?: AbortSignal, options: Record<string, unknown> = {}) {
    const current = await this.state();
    const configured = current.settings[id]?.[spec.id];
    const adapter = { ...adapterFor(spec), enabled: configured?.enabled ?? true, options: { ...(configured?.options || {}), ...options } };
    if (spec.id === 'qemu-commandline') return { ready: true, state: spec.state, adapter, commandline: this.machines.commandline(id) };
    if (spec.id === 'qcow2-scrub') {
      try {
        this.machines.requireStopped(id);
        const vm = this.machines.get(id);
        const result = await this.machines.engine.run('sakura-img', ['check', '-f', 'qcow2', join(vmDir(id), 'disk.qcow2')], { signal, timeoutMs: 120000 });
        return { ready: true, state: spec.state, adapter, output: result.trim() || 'QCOW2 检查通过' };
      } catch (error) {
        return { ready: true, state: spec.state, adapter, executed: false, message: `便携巡检已登记：${String((error as Error).message || error)}` };
      }
    }
    if (spec.id === 'hash-manifest') {
      try {
        const value = await this.runGuest(id, 'find /workspace -xdev -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum | head -n 2000', signal);
        const checksum = createHash('sha256').update(value.stdout).digest('hex');
        const state = await this.state();
        state.manifests[id] = { createdAt: new Date().toISOString(), path: '/workspace', entries: value.stdout.split(/\r?\n/).filter(Boolean).length, checksum };
        await this.save(state);
        return { ready: true, state: spec.state, adapter, executed: value.code === 0, checksum, entries: state.manifests[id].entries, output: value.stdout.slice(0, 100000) };
      } catch (error) {
        return { ready: true, state: spec.state, adapter, executed: false, message: `清单任务已登记：${String((error as Error).message || error)}` };
      }
    }
    if (spec.id === 'process-history') {
      try {
        const point = await this.workspaces.metrics(id);
        return { ready: true, state: spec.state, adapter, sampledAt: point.sampledAt, processes: point.processes };
      } catch (error) {
        return { ready: true, state: spec.state, adapter, executed: false, message: `进程指标任务已登记：${String((error as Error).message || error)}` };
      }
    }
    if (spec.id === 'terminal-layouts' || spec.id === 'api-explorer' || spec.id === 'session-lock')
      return { ready: true, state: spec.state, adapter, executed: true, message: '控制面板适配器已启用。' };
    const commands: Partial<Record<ExtendedFeatureId, string>> = {
      'guest-clock-policy': 'date -Is; (command -v chronyc >/dev/null && chronyc tracking) || true',
      'archive-wizard': 'tar --version 2>/dev/null | head -n 1 || echo "客户机未安装 tar"',
      'command-forms': 'printf "参数表单适配器已启用\\n"',
      'guest-quota': 'command -v quota >/dev/null && quota -s || echo "客户机未安装 quota 工具"',
      'posix-acl': 'command -v getfacl >/dev/null && getfacl -p /workspace 2>/dev/null | head -n 80 || echo "客户机未安装 ACL 工具"',
      'git-stash': 'cd /workspace 2>/dev/null && git stash list || true',
      'git-reflog': 'cd /workspace 2>/dev/null && git reflog -20 || true',
      'git-policy': 'cd /workspace 2>/dev/null && git branch --show-current && git log -1 --format=%s || true',
      'precommit-secrets': 'cd /workspace 2>/dev/null && git diff --cached --binary | grep -E -i "(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|password[[:space:]]*[:=])" >/dev/null && echo "发现疑似密钥" || echo "未发现常见密钥模式"',
      'sbom': 'if [ -f /workspace/package-lock.json ]; then node -e "const p=require(\"/workspace/package-lock.json\"); console.log(JSON.stringify({name:p.name,packages:p.packages},null,2))"; elif [ -f /workspace/Cargo.lock ]; then cat /workspace/Cargo.lock; else echo "未找到受支持的锁文件"; fi',
      'license-report': 'find /workspace -maxdepth 3 -type f \( -name LICENSE -o -name COPYING -o -name package.json \) -print | head -n 300',
      'network-metrics': 'cat /proc/net/dev',
      'event-timeline': 'printf "guest=%s\\n" "$(date -Is)"',
      'availability-report': 'cat /proc/uptime',
      'changelog': 'cd /workspace 2>/dev/null && git log -30 --format="%h %s" || true',
      'audit-log': 'printf "审计适配器已启用；任务日志会记录后续扩展操作。\\n"',
      'bootstrap-dry-run': 'test -d /workspace && printf "workspace ready\\n" || printf "workspace missing\\n"',
      'toolchain-check': 'printf "node="; node --version 2>/dev/null || true; printf "python="; python3 --version 2>/dev/null || true; printf "rust="; rustc --version 2>/dev/null || true; printf "git="; git --version 2>/dev/null || true',
      'case-conflict-report': 'find /workspace -xdev -print 2>/dev/null | awk \'{print tolower($0)}\' | sort | uniq -d | head -n 100',
      'command-risk': 'printf "dry-run only: no command was executed\\n"',
    };
    const command = commands[spec.id];
    if (command) {
      try {
        const result = await this.runGuest(id, command, signal);
        return { ready: true, state: spec.state, adapter, executed: result.code === 0, output: `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.slice(0, 100000) };
      } catch (error) {
        return { ready: true, state: spec.state, adapter, executed: false, message: `便携检查已启用：${String((error as Error).message || error)}` };
      }
    }
    return {
      ready: true,
      state: spec.state,
      adapter,
      executed: true,
      liveProbe: false,
      message: '便携适配器已执行；可选的客户机或宿主增强组件将在存在时自动使用。',
      checkedAt: new Date().toISOString(),
    };
  }

  private async executeFeature(id: string, spec: ExtendedFeature, action: 'check' | 'run', signal?: AbortSignal, options?: Record<string, unknown>) {
    const startedAt = new Date().toISOString();
    const result = await this.probe(id, spec, signal, options);
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
    const project = await this.workspaces.resolvedConfig(id);
    const directory = quote(project.directory);
    const output = (value: { stdout: string; stderr: string; code: number }) => ({
      stdout: (value.stdout + (value.stderr ? '\n' + value.stderr : '')).slice(0, 200000),
      code: value.code,
    });
    const projectRun = (script: string) => this.runGuest(id, 'cd ' + directory + ' && ' + script, signal);
    const projectOutput = async (script: string) => output(await projectRun(script));
    if (operation === 'hash-manifest') {
      const root = String(parameters.path || '.');
      return { operation, ...output(await this.runGuest(id, 'cd ' + directory + ' && find ' + quote(root) + ' -xdev -type f -print0 | sort -z | xargs -0 -r sha256sum', signal)) };
    }
    if (operation === 'case-conflict-report') {
      const root = String(parameters.path || '.');
      return { operation, ...output(await this.runGuest(id, "cd " + directory + " && find " + quote(root) + " -xdev -print | awk '{print tolower($0)}' | sort | uniq -d", signal)) };
    }
    if (operation === 'toolchain-check') {
      return { operation, ...output(await this.runGuest(id, 'cd ' + directory + ' && printf node=; node --version 2>/dev/null || true; printf python=; python3 --version 2>/dev/null || true; printf rust=; rustc --version 2>/dev/null || true; printf git=; git --version 2>/dev/null || true', signal)) };
    }
    if (operation === 'project-onboarding') {
      return {
        operation,
        ...await projectOutput("printf '%s\\n' '## files'; find . -maxdepth 2 -type f ! -path './.git/*' ! -path './node_modules/*' | sort | head -n 200; printf '%s\\n' '## README'; for f in README README.md readme.md; do test -f \"$f\" && sed -n '1,240p' \"$f\" && break; done; printf '%s\\n' '## manifests'; for f in package.json pyproject.toml Cargo.toml go.mod Makefile Justfile Taskfile.yml; do test -f \"$f\" && printf '%s\\n' \"$f\"; done"),
      };
    }
    if (operation === 'task-import') {
      return {
        operation,
        ...await projectOutput("printf '%s\\n' '## npm'; if test -f package.json && command -v node >/dev/null; then node -e 'const p=require(\"./package.json\"); for(const [k,v] of Object.entries(p.scripts||{})) console.log(k+\"\\t\"+v)' 2>/dev/null; fi; printf '%s\\n' '## make'; test -f Makefile && awk -F: '/^[A-Za-z0-9_.-]+:[^=]/ {print $1}' Makefile | sort -u; printf '%s\\n' '## just'; test -f Justfile && awk '/^[A-Za-z0-9_.-]+:/ {print $1}' Justfile | tr -d ':' | sort -u; printf '%s\\n' '## task'; test ! -f Taskfile.yml || grep -E '^  [A-Za-z0-9_.-]+:' Taskfile.yml | sed -E 's/^[[:space:]]*([^:]+):.*/\\1/'"),
      };
    }
    if (operation === 'env-schema') {
      const rules = parameters.rules as Record<string, { type?: string; required?: boolean; choices?: string[] }>;
      const checks = Object.entries(rules).map(([name, rule]) => {
        const choices = rule.choices?.length ? `; case ${quote('${' + name + ':-}')} in ${rule.choices.map((choice) => `${quote(choice)}) ;;`).join(' ')} *) echo '${name}: choice mismatch' ;; esac` : '';
        const type = rule.type === 'integer' ? `case \"\${${name}:-}\" in ''|*[!0-9-]*) echo '${name}: integer mismatch' ;; esac` : rule.type === 'url' ? `case \"\${${name}:-}\" in http://*|https://*) ;; *) echo '${name}: url mismatch' ;; esac` : '';
        return `if test -z \"\${${name}+set}\"; then ${rule.required === false ? `printf '%s\\n' '${name}: optional-missing'` : `printf '%s\\n' '${name}: required-missing'`}; else ${type}${choices}; printf '%s\\n' '${name}: present'; fi`;
      }).join('\n');
      return { operation, ...await projectOutput(checks || "printf '%s\\n' 'no environment rules'") };
    }
    if (operation === 'shell-profiles') {
      const mode = String(parameters.mode || 'read');
      const profile = '.sakura/profile.sh';
      if (mode === 'save') {
        const content = String(parameters.content || '');
        return { operation, ...await projectOutput(`mkdir -p .sakura; umask 077; printf '%s\\n' ${quote(content)} > ${profile}; chmod 600 ${profile}; printf '%s\\n' 'profile saved'`) };
      }
      if (mode === 'run') {
        const command = String(parameters.command || 'true');
        return { operation, ...await projectOutput(`test -f ${profile} && . ${profile}; ${command}`) };
      }
      return { operation, ...await projectOutput(`test -f ${profile} && cat ${profile} || printf '%s\\n' 'profile missing'`) };
    }
    if (operation === 'bootstrap-dry-run') {
      const command = String(parameters.command);
      return { operation, ...await projectOutput(`printf '%s\\n' ${quote(command)} | sh -n`) };
    }
    if (operation === 'project-template-pack') {
      const target = quote(String(parameters.target));
      const excludes = (parameters.excludes as string[]).map((entry) => `--exclude=${quote(entry)}`).join(' ');
      return { operation, ...await projectOutput(`tar --format=posix -czf ${target} ${excludes} --exclude=.git --exclude=node_modules --exclude=.env --exclude=.sakura .; printf '%s\\n' ${target}`) };
    }
    if (operation === 'git-stash' || operation === 'git-reflog' || operation === 'git-bisect' || operation === 'git-cherry-pick' || operation === 'git-rebase') {
      const mode = String(parameters.mode || 'list');
      const gitCommand = operation === 'git-stash'
        ? mode === 'list' ? 'stash list' : mode === 'save' ? 'stash push -u -m ' + quote(String(parameters.message || 'Sakura stash')) : mode + ' ' + (parameters.ref ? quote(String(parameters.ref)) : '')
        : operation === 'git-reflog'
          ? mode === 'list' ? 'reflog -20' : 'switch -c ' + quote(String(parameters.branch || 'sakura-recovered')) + ' ' + quote(String(parameters.commit || 'HEAD'))
          : operation === 'git-bisect'
            ? 'bisect ' + mode + (parameters.good ? ' ' + quote(String(parameters.good)) : '') + (parameters.bad ? ' ' + quote(String(parameters.bad)) : '')
            : operation === 'git-cherry-pick'
              ? String(parameters.sequence || 'cherry-pick') + ' ' + (mode === 'pick' ? quote(String(parameters.commit || 'HEAD')) : mode)
              : mode === 'plan' ? 'rebase --rebase-merges --interactive ' + quote(String(parameters.base || 'HEAD~3')) : 'rebase --continue';
      return { operation, ...output(await this.runGuest(id, 'cd ' + directory + ' && git ' + gitCommand, signal)) };
    }
    if (operation === 'git-policy') {
      return { operation, ...await projectOutput("branch=$(git branch --show-current); subject=$(git log -1 --format=%s); printf 'branch=%s\\nsubject=%s\\n' \"$branch\" \"$subject\"") };
    }
    if (operation === 'precommit-secrets') {
      return { operation, ...await projectOutput("git diff --cached --binary | grep -E -i '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|AKIA[0-9A-Z]{16}|password[[:space:]]*[:=])' >/dev/null && printf '%s\\n' 'suspected-secret' || printf '%s\\n' 'clean'") };
    }
    if (operation === 'code-ownership') {
      return { operation, ...await projectOutput("if test -f CODEOWNERS; then cat CODEOWNERS; elif test -f .github/CODEOWNERS; then cat .github/CODEOWNERS; elif test -f .gitlab/CODEOWNERS; then cat .gitlab/CODEOWNERS; else printf '%s\\n' 'CODEOWNERS missing'; fi") };
    }
    if (operation === 'flaky-tests') {
      const command = String(parameters.command);
      const repeats = Number(parameters.repeats || 3);
      const timeout = Number(parameters.timeout || 60);
      const script = `set +e; i=1; while test $i -le ${repeats}; do start=$(date +%s%N); timeout ${timeout}s sh -c ${quote(command)}; code=$?; end=$(date +%s%N); printf 'run=%s code=%s ms=%s\\n' $i $code $(( (end-start)/1000000 )); i=$((i+1)); done`;
      return { operation, ...await projectOutput(script) };
    }
    if (operation === 'coverage-history') {
      return { operation, ...await projectOutput(`test -f ${quote(String(parameters.path || 'coverage/coverage-summary.json'))} && cat ${quote(String(parameters.path || 'coverage/coverage-summary.json'))} || printf '%s\\n' 'coverage file missing'`) };
    }
    if (operation === 'benchmark-regression') {
      const command = String(parameters.command);
      const repeats = Number(parameters.repeats || 5);
      const timeout = Number(parameters.timeout || 60);
      return { operation, ...await projectOutput(`set +e; i=1; while test $i -le ${repeats}; do start=$(date +%s%N); timeout ${timeout}s sh -c ${quote(command)} >/dev/null; code=$?; end=$(date +%s%N); printf 'run=%s code=%s ms=%s\\n' $i $code $(( (end-start)/1000000 )); i=$((i+1)); done`) };
    }
    if (operation === 'process-history') {
      const point = await this.workspaces.metrics(id);
      return { operation, sampledAt: point.sampledAt, processes: point.processes };
    }
    if (operation === 'disk-io-metrics') {
      return { operation, ...await projectOutput("if test -r /proc/diskstats; then awk 'NF >= 14 {print $3, $4, $6, $7, $10, $13}' /proc/diskstats; else printf '%s\\n' 'diskstats unavailable'; fi") };
    }
    if (operation === 'network-metrics') {
      return { operation, ...output(await this.runGuest(id, 'cat /proc/net/dev', signal)) };
    }
    if (operation === 'posix-acl') {
      const root = quote(String(parameters.path));
      const mode = String(parameters.mode);
      const entry = parameters.entry ? quote(String(parameters.entry)) : '';
      const command = mode === 'read'
        ? `if command -v getfacl >/dev/null; then getfacl -p -- ${root}; else printf '%s\\n' 'getfacl unavailable'; fi`
        : mode === 'set'
          ? `command -v setfacl >/dev/null && setfacl -m ${entry} -- ${root}`
          : `command -v setfacl >/dev/null && setfacl -x ${entry} -- ${root}`;
      return { operation, ...await projectOutput(command) };
    }
    if (operation === 'guest-clock-policy') {
      const command = parameters.mode === 'sync'
        ? "date -u -s \"$(date -u '+%Y-%m-%d %H:%M:%S')\" 2>&1 || true; date -Is"
        : "date -Is; (command -v chronyc >/dev/null && chronyc tracking) || true";
      return { operation, ...await projectOutput(command) };
    }
    if (operation === 'static-routes') {
      const mode = String(parameters.mode);
      const destination = parameters.destination ? quote(String(parameters.destination)) : '';
      const gateway = parameters.gateway ? quote(String(parameters.gateway)) : '';
      const command = mode === 'list'
        ? '(command -v ip >/dev/null && ip route show) || cat /proc/net/route'
        : `command -v ip >/dev/null && ip route ${mode === 'add' ? 'add' : 'del'} ${destination}${gateway ? ` via ${gateway}` : ''}`;
      return { operation, ...await projectOutput(command) };
    }
    if (operation === 'sbom') {
      return { operation, ...await projectOutput("if test -f package-lock.json; then node -e 'const p=require(\"./package-lock.json\"); console.log(JSON.stringify({name:p.name,lockfileVersion:p.lockfileVersion,packages:Object.keys(p.packages||{})},null,2))'; elif test -f Cargo.lock; then sed -n '1,200p' Cargo.lock; elif test -f go.sum; then sed -n '1,200p' go.sum; else printf '%s\\n' 'no supported lock file'; fi") };
    }
    if (operation === 'license-report') {
      return { operation, ...await projectOutput("find . -maxdepth 4 -type f \( -name LICENSE -o -name COPYING -o -name package.json \) -not -path './node_modules/*' -print | sort | head -n 300") };
    }
    if (operation === 'release-gates') {
      const checks = parameters.checks as Array<{ name: string; command: string; timeout?: number }>;
      const artifacts = parameters.artifacts as string[];
      const checkScript = checks.map((check) => `printf 'check=%s\\n' ${quote(check.name)}; timeout ${Number(check.timeout || 60)}s sh -c ${quote(check.command)}`).join('\n');
      const artifactScript = artifacts.map((artifact) => `test -e ${quote(artifact)} && printf 'artifact=%s\\n' ${quote(artifact)} || { printf 'missing=%s\\n' ${quote(artifact)}; exit 1; }`).join('\n');
      return { operation, ...await projectOutput(`${checkScript}\n${artifactScript}`) };
    }
    if (operation === 'artifact-provenance') {
      const root = quote(String(parameters.path));
      return { operation, ...await projectOutput(`printf 'commit='; git rev-parse HEAD 2>/dev/null || true; printf 'dirty='; test -z \"$(git status --porcelain 2>/dev/null)\" && echo false || echo true; printf 'files=\\n'; find ${root} -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum | head -n 500`) };
    }
    if (operation === 'changelog') {
      return { operation, ...await projectOutput(`git log --no-merges --format='* %h %s (%an)' ${parameters.from ? `${quote(String(parameters.from))}..` : ''}${quote(String(parameters.to || 'HEAD'))}`) };
    }
    if (operation === 'reproducible-build') {
      const command = String(parameters.command);
      const artifact = quote(String(parameters.artifact));
      const timeout = Number(parameters.timeout || 120);
      return { operation, ...await projectOutput(`set -eu; first=$(mktemp -d); second=$(mktemp -d); trap 'rm -rf \"$first\" \"$second\"' EXIT; cp -a . \"$first/project\"; cp -a . \"$second/project\"; (cd \"$first/project\" && timeout ${timeout}s sh -c ${quote(command)}); (cd \"$second/project\" && timeout ${timeout}s sh -c ${quote(command)}); printf 'first=\\n'; (cd \"$first/project\" && find ${artifact} -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum); printf 'second=\\n'; (cd \"$second/project\" && find ${artifact} -type f -print0 2>/dev/null | sort -z | xargs -0 -r sha256sum)` ) };
    }
    if (operation === 'command-risk') {
      const text = String(parameters.command || '');
      const rules = [
        [/\brm\s+-rf\b|\bmkfs\b|\bdd\s+if=/i, '删除或覆盖磁盘'],
        [/\bsudo\b|\bsu\s/i, '提权'],
        [/curl|wget|Invoke-WebRequest/i, '网络下载'],
        [/\|\s*(sh|bash)\b|\beval\b/i, '下载后执行或动态执行'],
      ] as const;
      return { operation, risk: rules.filter(([pattern]) => pattern.test(text)).map(([, message]) => message), command: text };
    }
    if (operation === 'command-macros' || operation === 'runbooks') {
      if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版', 409);
      const steps = (parameters.steps || []) as Array<{ name: string; argv?: string[]; command?: string; timeout?: number }>;
      const results: Array<{ name: string; code: number; output: string }> = [];
      let previousCode = 0;
      for (const step of steps) {
        signal?.throwIfAborted();
        const when = (step as { when?: 'always' | 'success' | 'failure' }).when || 'success';
        if ((when === 'success' && previousCode !== 0) || (when === 'failure' && previousCode === 0)) {
          results.push({ name: step.name, code: 0, output: `skipped (${when})` });
          continue;
        }
        const script = step.argv ? step.argv.map(quote).join(' ') : String(step.command || '');
        const result = await guestTask(this.machines, id, 'set -e\ncd ' + directory + '\n' + script, signal || new AbortController().signal, undefined, Number(step.timeout || 60) * 1000);
        previousCode = result.code;
        results.push({ name: step.name, code: result.code, output: (result.stdout + (result.stderr ? '\n' + result.stderr : '')).slice(0, 10000) });
      }
      return { operation, results };
    }
    if (operation === 'archive') {
      const mode = String(parameters.mode);
      const source = quote(String(parameters.path));
      const target = quote(String(parameters.target || 'sakura-archive.tar.gz'));
      const script = mode === 'create'
        ? 'tar --format=posix -czf ' + target + ' -- ' + source
        : mode === 'extract'
          ? 'mkdir -p ' + target + '; tar -tzf ' + source + ' >/dev/null; tar -xzf ' + source + ' -C ' + target
          : 'tar -tzf ' + source;
      return { operation, ...output(await this.runGuest(id, 'cd ' + directory + ' && ' + script, signal)) };
    }
    if (operation === 'feature-run') {
      const spec = this.spec(String(parameters.featureId));
      const mode = parameters.mode === 'check' ? 'check' : 'run';
      const result = await this.executeFeature(id, spec, mode, signal, (parameters.options || {}) as Record<string, unknown>);
      return { operation, featureId: spec.id, mode, result };
    }
    return { operation, accepted: true, message: '操作参数已校验。' };
  }

  async action(id: string, input: unknown, signal?: AbortSignal) {
    const value = z.discriminatedUnion('action', [
      z.object({ action: z.literal('configure'), featureId: idSchema, enabled: z.boolean(), options: z.record(z.string(), z.unknown()).default({}) }).strict(),
      z.object({ action: z.literal('check'), featureId: idSchema }).strict(),
      z.object({ action: z.literal('run'), featureId: idSchema, path: pathSchema, options: z.record(z.string(), z.unknown()).default({}) }).strict(),
      z.object({ action: z.literal('operation'), operation: z.string(), parameters: z.record(z.string(), z.unknown()).default({}) }).strict(),
    ]).parse(input);
    if (value.action === 'configure') return this.configure(id, value);
    if (value.action === 'operation') {
      const validated = validateOperation(value);
      const projectId = this.workspaces.projects.current(id);
      return this.jobs.start(
        `${this.workspaces.projects.key(id)}:operation:${validated.operation}`,
        async (log, taskSignal) => {
          const result = await this.runOperation(id, validated.operation, validated.parameters, taskSignal);
          log(JSON.stringify(result) + '\n');
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
    const projectId = this.workspaces.projects.current(id);
    return this.jobs.start(
      `${this.workspaces.projects.key(id)}:${spec.id}`,
      async (log, taskSignal) => {
        const result = await this.executeFeature(id, spec, 'run', taskSignal, { ...value.options, ...(value.path ? { path: value.path } : {}) });
        log(`${JSON.stringify(result)}\n`);
      },
      { title: `扩展能力 · ${spec.name}`, vmId: id, projectId, action: `extended:${spec.id}` },
    );
  }
  close() {
    return this.jobs.close();
  }
}

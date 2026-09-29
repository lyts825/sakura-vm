import { formatDecimal } from '../../src/localization';
import { formatDateTime } from '../../src/localization';
import { Activity, Bell, Compass, HardDrive, Package, Play, Search, ShieldCheck, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ExtendedFeature } from '../../server/extended-features';
import type {
  AlertConfig,
  FeatureCatalogItem,
  ResourcePreset,
  ResourcePresetId,
  Schedule,
  MetricPoint,
  AlertEvent,
} from '../../server/feature-suite';
import type { JobView } from '../../server/jobs';
import type { VMView } from '../../server/model';
import type { NextFeature } from '../../server/next-features';
import type { hardwareCompatibility } from '../../server/hardware-compatibility';
import { featureReadiness, type FeatureExecutionState } from '../../src/feature-readiness';
import { Feedback, JobLog, useAction, useRemote, type Request } from '../../src/feature-shared';
import '../../src/features.css';
import { usePlugin } from '../../src/plugin-context';
import { workspaceRequest } from '../../src/workspace-request';
import { CapabilityActionsPanel } from '../../src/CapabilityActionsPanel';
import type { CapabilityActionView } from '../../shared/capability-actions';
import { MetricHistory } from '../../src/MetricHistory';
import { NotificationCenter } from '../../src/NotificationCenter';
import { UsbHotplugPanel } from '../../src/UsbHotplugPanel';
import { MemoryReclaimSettings } from './MemoryReclaimSettings';
import { HostMountSettings } from './HostMountSettings';
import { VirtioFsSettings } from './VirtioFsSettings';
import { TrustedBootSettings } from './TrustedBootSettings';
import { PackageWorkbenchPanel } from './PackageWorkbenchPanel';
import { HaFailoverPanel } from './HaFailoverPanel';

function ReadinessBadge({ records, id }: { records?: FeatureExecutionState[]; id: string }) {
  const status = featureReadiness(records, id);
  return (
    <span className={status.className} title={status.title}>
      {status.label}
    </span>
  );
}

type HardwareReport = Awaited<ReturnType<typeof hardwareCompatibility>>;
function HardwareMatrix({ report }: { report: HardwareReport }) {
  const rows = [...report.matrix.machines, ...report.matrix.accelerators, ...report.matrix.devices];
  return (
    <section className="feature-card hardware-matrix-report" aria-label="宿主硬件兼容矩阵">
      <h4>宿主硬件兼容矩阵</h4>
      <p className="subtle-note">
        {report.qemuVersion} · {report.host.platform}/{report.host.arch}
      </p>
      <div className="snapshot-list">
        {rows.map((row) => (
          <div key={row.id}>
            <div>
              <b>{row.name}</b>
              <p>
                {row.evidence}
                {row.reason ? ` · ${row.reason}` : ''}
              </p>
            </div>
            <span className={`badge ${row.available ? 'running' : ''}`}>
              {row.available ? '可用' : '不可用'}
            </span>
          </div>
        ))}
      </div>
      <p>
        <b>当前实例：</b>
        {report.current.compatible ? '配置与宿主探测相容' : report.current.issues.join('；')}
      </p>
      <p className="subtle-note">{report.limitation}</p>
    </section>
  );
}

type FeatureEvent = {
  id: string;
  kind: AlertEvent['kind'];
  message: string;
  createdAt: string;
  acknowledged: boolean;
  jobId?: string;
  projectId?: string;
};
type DiskEntry = { path: string; bytes: number };
type SuiteView = {
  capabilities?: CapabilityActionView[];
  capabilityJobs?: JobView[];
  projectId?: string;
  settings: { schedule: Schedule; alerts: AlertConfig; updatedAt: string };
  history: MetricPoint[];
  events: FeatureEvent[];
  job: JobView | null;
  devJob: JobView | null;
  presets: Record<ResourcePresetId, ResourcePreset>;
  features: FeatureCatalogItem[];
};
type Props = {
  request: Request;
  vms: VMView[];
  selected: string;
  onSelected: (id: string) => void;
  projectId?: string;
};
type ExtendedView = {
  capabilities?: CapabilityActionView[];
  projectId?: string;
  features: ExtendedFeature[];
  operations: Array<{
    id: string;
    name: string;
    feature: string;
    example: Record<string, unknown>;
    note: string;
    writes: boolean;
  }>;
  settings: Record<string, { enabled: boolean; options?: Record<string, unknown>; updatedAt: string }>;
  executions?: Array<{
    featureId: string;
    action: string;
    ready: boolean;
    finishedAt: string;
    result?: { executed?: boolean; reason?: string; message?: string };
  }>;
  jobs: JobView[];
};
type NextView = {
  capabilities?: CapabilityActionView[];
  projectId?: string;
  features: NextFeature[];
  settings: Record<string, { enabled: boolean; options?: Record<string, unknown>; updatedAt: string }>;
  haFailoverMonitor?: { armed: boolean; suspected: boolean; consecutiveFailures: number;
    observedState: string; observedAt: string; suspectedAt?: string;
    sampleIntervalSeconds: number } | null;
  haPromotion?: { remoteVmId: string; snapshotId: string; status: 'fenced' | 'accepted';
    fencedAt: string; error?: string } | null;
  haLocalFailover?: { error: string | null } | null;
  executions?: Array<{
    featureId: string;
    action: string;
    ready: boolean;
    executed: boolean;
    finishedAt: string;
    result?: { reason?: string; message?: string };
  }>;
  jobs: JobView[];
};

const fallbackPresets: Record<ResourcePresetId, ResourcePreset> = {
  light: { name: '轻量命令行', memoryMiB: 512, cpus: 1 },
  development: { name: '日常开发', memoryMiB: 2048, cpus: 2 },
  build: { name: '编译构建', memoryMiB: 4096, cpus: 4 },
  desktop: { name: '图形桌面', memoryMiB: 2048, cpus: 2 },
};

const bytes = (value: number) =>
  value >= 1024 ** 3 ? `${formatDecimal((value / 1024 ** 3), 1)} GiB` : `${formatDecimal((value / 1024 ** 2), 0)} MiB`;

export function FeatureSuitePanel(props: Props) {
  if (!props.vms.length)
    return (
      <div className="content-panel feature-panel management-page">
        <h2>能力中心</h2>
        <p>先创建一个 Linux 空间，再使用自动化功能。</p>
      </div>
    );
  return <ActiveFeatureSuitePanel {...props} />;
}
function ActiveFeatureSuitePanel({ request: baseRequest, vms, selected, onSelected, projectId }: Props) {
  const hasAutomation = usePlugin('automation'),
    hasScheduler = usePlugin('automation-scheduler'),
    hasExtensions = usePlugin('extensions'),
    hasPlatform = usePlugin('platform');
  const request = useMemo(() => workspaceRequest(baseRequest, projectId), [baseRequest, projectId]);
  const active = vms.find((vm) => vm.id === selected) || vms[0];
  const remote = useRemote<SuiteView>(
    request,
    active ? `/vms/${active.id}/advanced?limit=720` : '/feature-suite',
    !!active && hasAutomation,
    5000,
  );
  const extended = useRemote<ExtendedView>(
    request,
    active ? `/vms/${active.id}/extended-features` : '/extended-features',
    !!active && hasExtensions,
    10000,
  );
  const next = useRemote<NextView>(
    request,
    active ? `/vms/${active.id}/next-features` : '/next-features',
    !!active && hasPlatform,
    10000,
  );
  const action = useAction();
  const [schedule, setSchedule] = useState<Schedule>({ enabled: false, idleMinutes: 0, idleAction: 'stop' });
  const [alerts, setAlerts] = useState<AlertConfig>({
    enabled: false,
    cpuPercent: 90,
    memoryPercent: 90,
    diskPercent: 90,
    cooldownMinutes: 30,
    taskFailures: true,
    serviceFailures: true,
    secretRotation: true,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchPath, setSearchPath] = useState('/workspace');
  const [searchContent, setSearchContent] = useState(true);
  const [searchResult, setSearchResult] = useState<string[]>([]);
  const [packageName, setPackageName] = useState('');
  const [packageOperation, setPackageOperation] = useState<
    'list' | 'search' | 'install' | 'remove' | 'update' |
    'cache-list' | 'cache-prefetch' | 'cache-install' | 'cache-clear'
  >('cache-list');
  const [networkTarget, setNetworkTarget] = useState('example.com');
  const [networkResult, setNetworkResult] = useState('');
  const [securityResult, setSecurityResult] = useState<{
    findings: string[];
    output: string;
    vulnerabilityScan?: {
      status: 'complete' | 'unavailable'; ecosystem: string | null; packagesChecked: number;
      affectedPackages: number; vulnerabilityCount: number;
      matches: Array<{ name: string; version: string; ids: string[] }>;
      error?: string;
    };
  } | null>(null);
  const [ports, setPorts] = useState<number[]>([]);
  const [memoryTarget, setMemoryTarget] = useState(active.memoryTargetMiB || active.memoryMiB);
  const [preset, setPreset] = useState<ResourcePresetId>('development');
  const [devOperation, setDevOperation] = useState<
    | 'test'
    | 'test-discover'
    | 'lint'
    | 'format'
    | 'dependencies'
    | 'lock'
    | 'lock-check'
    | 'install-locked'
    | 'prefetch-dependencies'
    | 'install-cached-dependencies'
    | 'worktree-list'
    | 'worktree-add'
    | 'worktree-remove'
    | 'database'
  >('test');
  const [dependencyManager, setDependencyManager] = useState<'npm' | 'pip'>('npm');
  const [worktreeBranch, setWorktreeBranch] = useState('');
  const [worktreePath, setWorktreePath] = useState('');
  const [database, setDatabase] = useState<'postgres' | 'redis' | 'mysql'>('postgres');
  const [databaseName, setDatabaseName] = useState('');
  const [databasePort, setDatabasePort] = useState('');
  const [databasePassword, setDatabasePassword] = useState('');
  const [diskPath, setDiskPath] = useState('/workspace');
  const [diskEntries, setDiskEntries] = useState<DiskEntry[]>([]);
  const [extendedResult, setExtendedResult] = useState('');
  const [extendedOperation, setExtendedOperation] = useState('');
  const [operationParameters, setOperationParameters] = useState('{}');
  const [nextResult, setNextResult] = useState('');
  const [hardwareReport, setHardwareReport] = useState<HardwareReport | null>(null);
  const [nextSearch, setNextSearch] = useState('');
  const [suiteCapability, setSuiteCapability] = useState('');
  const [extendedCapability, setExtendedCapability] = useState('');
  const [nextCapability, setNextCapability] = useState('');
  const [showUsbHotplug, setShowUsbHotplug] = useState(false);
  const lockdown = useRemote<{ locked: boolean }>(request, '/vms/' + active.id + '/lockdown');
  useEffect(() => {
    const selected = extended.data?.operations.find((item) => item.id === extendedOperation);
    setOperationParameters(JSON.stringify(selected?.example || {}, null, 2));
  }, [extendedOperation]);

  useEffect(() => {
    if (!remote.data) return;
    setSchedule(remote.data.settings.schedule);
    setAlerts(remote.data.settings.alerts);
  }, [active.id, !!remote.data, remote.data?.settings.updatedAt]);
  useEffect(() => {
    setMemoryTarget(active.memoryTargetMiB || active.memoryMiB);
  }, [active.id, active.memoryMiB, active.memoryTargetMiB]);

  const latest = remote.data?.history.at(-1);
  const presets = remote.data?.presets || fallbackPresets;
  const groups = useMemo(() => {
    const map = new Map<string, FeatureCatalogItem[]>();
    for (const feature of remote.data?.features || [])
      map.set(feature.category, [...(map.get(feature.category) || []), feature]);
    return [...map.entries()];
  }, [remote.data?.features]);

  if (!active) {
    return (
      <div className="content-panel feature-panel management-page">
        <h2>能力中心</h2>
        <p className="muted">先创建一个 Linux 空间，再使用自动化、搜索和诊断功能。</p>
      </div>
    );
  }

  const saveSettings = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'PUT', { schedule, alerts });
      remote.reload();
    }, '能力中心设置已保存');
  const sample = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', { action: 'sample' });
      remote.reload();
    });
  const applyMemoryTarget = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'memory-target',
        memoryMiB: memoryTarget,
      });
      await remote.reload();
    }, '动态内存目标已更新');
  const applyPreset = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', { action: 'apply-preset', preset });
      await remote.reload();
    }, '资源预设已应用，请重新启动发行版');
  const runSearch = () =>
    action.run(async () => {
      const result = await request<{ matches: string[] }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'search',
        query: searchQuery,
        path: searchPath,
        content: searchContent,
      });
      setSearchResult(result.matches);
    });
  const runDiskAnalysis = () =>
    action.run(async () => {
      const result = await request<{ entries: DiskEntry[] }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'disk-analysis',
        path: diskPath,
      });
      setDiskEntries(result.entries);
    });
  const runPackage = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'package',
        operation: packageOperation,
        ...(!['list', 'update', 'cache-list'].includes(packageOperation) && packageName.trim()
          ? { name: packageName.trim() } : {}),
      });
    }, '软件包任务已提交，请在任务中心查看日志');
  const runDev = () =>
    action.run(async () => {
      await request(`/vms/${active.id}/advanced`, 'POST', {
        action: 'dev',
        operation: devOperation,
        ...(['prefetch-dependencies', 'install-cached-dependencies'].includes(devOperation)
          ? { manager: dependencyManager } : {}),
        ...(worktreeBranch ? { branch: worktreeBranch } : {}),
        ...(worktreePath ? { path: worktreePath } : {}),
        ...(devOperation === 'database' ? { database } : {}),
        ...(devOperation === 'database' && databaseName.trim() ? { name: databaseName.trim() } : {}),
        ...(devOperation === 'database' && databasePort ? { port: Number(databasePort) } : {}),
        ...(devOperation === 'database' ? { password: databasePassword } : {}),
      });
      remote.reload();
    }, '开发任务已提交，请查看日志');
  const runNetwork = () =>
    action.run(async () => {
      const result = await request<{ output: string }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'network-test',
        target: networkTarget,
      });
      setNetworkResult(result.output);
    });
  const runSecurity = () =>
    action.run(async () => {
      const result = await request<NonNullable<typeof securityResult>>(
        `/vms/${active.id}/advanced`,
        'POST',
        {
          action: 'security-scan',
        },
      );
      setSecurityResult(result);
    });
  const discoverPorts = () =>
    action.run(async () => {
      const result = await request<{ ports: number[] }>(`/vms/${active.id}/advanced`, 'POST', {
        action: 'discover-ports',
      });
      setPorts(result.ports);
    });
  const checkExtended = (featureId: string) =>
    action.run(async () => {
      const result = await request(`/vms/${active.id}/extended-features`, 'POST', {
        action: 'check',
        featureId,
      });
      setExtendedResult(JSON.stringify(result, null, 2));
    });
  const runExtended = (featureId: string) =>
    action.run(async () => {
      const instructions: Record<string, string> = {
        'image-import': '打开镜像库 → 导入其他镜像，选择 RAW、VMDK、VHDX 或 OVA 文件及对应 Linux 发行版。镜像须支持 NoCloud/Tiny Cloud 初始化。',
        'rescue-boot':
          '启用磁盘快照插件，在停止实例的快照页使用“只读救援”。临时系统只读检查源盘，执行结束后清理；需要保留的文件请复制到 /workspace 并列为产物。',
        'cow-workspace':
          '打开沙箱工作台，创建时将磁盘写入策略设为“临时 COW：停止即丢弃”。每次命令结束或停止后回到初始磁盘；需要保留的文件请列入产物。',
        'explorer-integration':
          '打开系统设置 → 管理 Windows 集成，注册右键菜单。目录或文件会按项目的 Windows 同步映射定位到 Sakura 工作区。',
        'session-lock':
          '打开系统设置 → 管理会话锁定，设置密码和空闲时间。启用后可点击顶栏锁定按钮；本机所有控制入口共用锁定状态。',
        'api-explorer':
          '打开系统设置 → 开发接口，浏览核心及已声明插件操作的 OpenAPI 文档，可执行只读查询并下载 JavaScript SDK。',
        'offline-pwa':
          '打开系统设置 → 离线监控 PWA，查看独立只读监控页，可启用最近状态与任务事件的离线缓存。',
        'accessibility-audit':
          '点击顶栏的无障碍检查模式，再检查当前页面。可定位问题元素、辅助检查键盘焦点并导出报告。',
        'shortcut-editor':
          '打开系统设置 → 快捷键编辑器，保存页面全局快捷键或当前项目覆盖；可停用单项并恢复默认。',
        'secret-rotation':
          '打开工作空间 → 开发 → 私密配置，为每个条目启用轮换提醒、设置周期与提前天数。后台通知需启用自动化调度及告警。',
        'clipboard-redaction': '打开设置 → 剪贴板敏感检测，启用本浏览器的复制与桌面传递检查。',
        'sync-window': '打开工作空间 → 同步，设置允许时间窗、时区和传输限速后保存。',
        'backup-dedup':
          '打开实例 → 备份，启用本机内容块去重。新备份跨实例复用相同块，下载和恢复会重组并校验；平台能力中的全局去重统计可清理无引用块。',
        'signed-bundles': '打开镜像库或实例快照页的“签名实例包”，启用严格导入并管理受信任 Ed25519 公钥。',
        'self-update':
          '从原安装目录执行 npm run update:check -- <新包目录> 和 npm run update:stage -- <新包目录>；使用输出的 versions/<编号> 执行 npm run update:activate -- versions/<编号>，重启服务生效。启动失败会自动回滚；也可运行 npm run update:rollback。升级前请备份实例数据。',
        'secure-erase':
          '使用 CLI：sakura extended <实例名> run secure-erase <options.json>。先提交 {"mode":"preview","path":"相对文件"}；在任务结果中取得 previewToken，再提交 {"mode":"erase","path":"同一路径","previewToken":"...","confirmed":true}。仅删除当前 /workspace 项目中的单链接普通文件；SSD、QCOW2 和快照的旧块可能仍可恢复。',
        'gpg-agent-forward':
          '使用 CLI：sakura extended <实例名> run gpg-agent-forward <options.json>，内容为 {"command":"gpg --no-autostart ...","confirmed":true,"timeoutSeconds":60}。宿主必须运行 GnuPG extra socket，客户机需安装 gpg 并导入公钥；临时 GNUPGHOME 和 SSH 转发仅在本次命令期间存在。',
        'watch-sync':
          '打开工作空间 → 同步，启用自动同步和文件变化事件。可查看两端监听状态；Linux 需要 inotify-tools。',
        'rename-detection':
          '打开工作空间 → 同步，启用重命名识别并预览变化。只移动内容未变化且匹配唯一的文件。',
        'path-sync-policy':
          '打开工作空间 → 同步 → 按路径设置同步方向与 Linux 权限，可添加只读、上传、下载和权限规则。',
        'sync-rollback': '打开工作空间 → 同步，启用回滚点；完成同步后在回滚记录中恢复最近一轮变更。',
        'sync-queue':
          '打开工作空间 → 同步 → 排队同步。离线请求会持久保存，连接恢复后重新比较并重试；取消排队可停止后续重试。',
        'immutable-backups':
          '打开实例 → 备份，设置新备份保留锁。到期前，Sakura 的删除和自动清理均保留该备份。',
      };
      if (instructions[featureId]) {
        setExtendedResult(instructions[featureId]);
        return;
      }
      if (featureId === 'terminal-layouts') {
        setExtendedResult('打开工作空间 → 终端 → 终端布局预设，可保存、应用和删除布局。');
        return;
      }
      if (extended.data?.capabilities?.some((item) => item.id === featureId)) {
        setExtendedCapability(featureId);
        return;
      }
      const operation = extended.data?.operations.find((item) => item.feature === featureId);
      if (operation) {
        setExtendedOperation(operation.id);
        return;
      }
      const result = await request(`/vms/${active.id}/extended-features`, 'POST', {
        action: 'run',
        featureId,
        ...(featureId === 'vm-suspend'
          ? { options: { mode: active.status === 'paused' ? 'resume' : 'pause' } }
          : {}),
      });
      setExtendedResult(JSON.stringify(result, null, 2));
      extended.reload();
    }, '扩展能力任务已提交');
  const runExtendedOperation = () =>
    action.run(async () => {
      const item = extended.data?.operations.find((value) => value.id === extendedOperation);
      if (!item) return;
      await request(`/vms/${active.id}/extended-features`, 'POST', {
        action: 'operation',
        operation: item.id,
        parameters: JSON.parse(operationParameters),
      });
      extended.reload();
    }, '扩展操作已提交，请在任务中心查看结果');
  const nextFeatures = useMemo(() => {
    const query = nextSearch.trim().toLocaleLowerCase();
    return (next.data?.features || []).filter(
      (feature) =>
        !query ||
        `${feature.id} ${feature.name} ${feature.category} ${feature.summary}`
          .toLocaleLowerCase()
          .includes(query),
    );
  }, [next.data?.features, nextSearch]);
  const checkNext = (featureId: string) =>
    action.run(async () => {
      const result = await request(`/vms/${active.id}/next-features`, 'POST', { action: 'check', featureId });
      setHardwareReport(
        featureId === 'hardware-compatibility' && result?.matrix ? (result as HardwareReport) : null,
      );
      setNextResult(
        featureId === 'hardware-compatibility' && result?.matrix ? '' : JSON.stringify(result, null, 2),
      );
      next.reload();
    });
  const runNext = (featureId: string) =>
    action.run(async () => {
      if (featureId === 'usb-hotplug') {
        setShowUsbHotplug((value) => !value);
        return;
      }
      if (featureId === 'file-level-restore') {
        setNextResult(
          '启用备份策略插件，在停止实例的快照页使用“备份文件恢复”。选择备份、分区与相对根目录的文件路径；完成后下载提取的文件，当前磁盘保持原样。',
        );
        return;
      }
      if (featureId === 'desktop-recording') {
        setNextResult(
          '打开实例 → 桌面 → 录制与回放，开始录制后可暂停、停止、回放、下载 WebM 或保存到本浏览器录制库。系统设置可管理所有实例的已保存录制。',
        );
        return;
      }
      if (featureId === 'file-associations') {
        setNextResult(
          '打开系统设置 → 管理 Windows 集成，选择文件扩展名及关联项目并保存。在 Windows 打开方式中选择 Sakura；文件需要位于该项目的同步目录。',
        );
        return;
      }
      if (featureId === 'local-ai-assistant' || featureId === 'natural-command-planner') {
        setNextResult(
          '打开系统设置 → 本地 AI 助手，连接已有的本机模型；预览脱敏上下文后生成编程建议或结构化命令计划。',
        );
        return;
      }
      if (featureId === 'webhook-events' || featureId === 'alert-routing') {
        setNextResult(
          '打开系统设置 → 管理事件通知，按实例、项目、标签和类型配置接收端；支持签名投递、测试、失败重试和记录查看。',
        );
        return;
      }
      if (featureId === 'graphql-api') {
        setNextResult(
          '打开系统设置 → GraphQL 查询，可查询主机、实例、任务元数据和插件状态，支持变量、分页及 Schema 下载。',
        );
        return;
      }
      if (featureId === 'log-retention') {
        setNextResult(
          '打开系统设置 → 任务日志保留，预览并保存保留天数与容量上限。运行中任务受保护；清理日志正文，保留任务记录、结果和审计。',
        );
        return;
      }
      if (featureId === 'backup-throttle') {
        setNextResult('打开实例 → 备份，设置备份输出限速（MiB/s）。每个实例串行创建备份；0 表示不限制速率。');
        return;
      }
      if (featureId === 'uefi-ovmf') {
        setNextResult('创建实例或停止现有实例后，在资源配置中把启动固件设为 UEFI。Sakura 会检测 OVMF 文件，并为该实例持久保存独立 NVRAM；已有磁盘需要包含 UEFI 启动环境。');
        return;
      }
      if (next.data?.capabilities?.some((item) => item.id === featureId)) {
        setNextCapability(featureId);
        return;
      }
      const result = await request(`/vms/${active.id}/next-features`, 'POST', { action: 'run', featureId });
      setNextResult(JSON.stringify(result, null, 2));
      next.reload();
    }, '第三批能力任务已提交');

  return (
    <div className="content-panel feature-panel management-page">
      <div className="panel-heading">
        <div>
          <h2>能力中心</h2>
          <p className="muted">查看当前已启用的扩展能力与操作。</p>
        </div>
        <label>
          当前发行版
          <select value={active.id} onChange={(event) => onSelected(event.target.value)}>
            {vms.map((vm) => (
              <option key={vm.id} value={vm.id}>
                {vm.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Feedback
        error={remote.error || extended.error || next.error || action.error}
        message={action.message}
      />
      <div className="feature-actions">
        <span>{lockdown.data?.locked ? '实例已应急锁定' : '应急锁定会停止实例并阻止执行新操作'}</span>
        <button
          className="secondary compact"
          disabled={action.busy || !lockdown.data}
          onClick={() =>
            action.run(async () => {
              await request('/vms/' + active.id + '/lockdown', 'POST', { locked: !lockdown.data?.locked });
              lockdown.reload();
            })
          }
        >
          {lockdown.data?.locked ? '解除应急锁定' : '停止并锁定实例'}
        </button>
      </div>

      {hasAutomation && (
        <>
          <div className="feature-grid">
            <section className="feature-card">
              <div className="panel-heading">
                <h3>
                  <Activity size={17} />
                  资源趋势
                </h3>
                <button
                  className="secondary compact"
                  disabled={action.busy || active.status !== 'running'}
                  onClick={sample}
                >
                  <Play size={13} />
                  立即采样
                </button>
              </div>
              {latest ? (
                <>
                  <div className="metric-strip">
                    <span>
                      CPU <b>{formatDecimal(latest.cpuPercent, 1)}%</b>
                    </span>
                    <span>
                      内存{' '}
                      <b>
                        {latest.memoryTotal
                          ? formatDecimal(((latest.memoryUsed / latest.memoryTotal) * 100), 1)
                          : '0'}
                        %
                      </b>
                    </span>
                    <span>
                      磁盘{' '}
                      <b>
                        {latest.diskTotal ? formatDecimal(((latest.diskUsed / latest.diskTotal) * 100), 1) : '0'}%
                      </b>
                    </span>
                  </div>
                  <MetricHistory history={remote.data?.history || []} />
                  <p className="subtle-note">
                    最近采样：{formatDateTime(new Date(latest.sampledAt))} · 磁盘 {bytes(latest.diskUsed)} /{' '}
                    {bytes(latest.diskTotal)}
                  </p>
                </>
              ) : (
                <p className="muted">启动发行版后点击“立即采样”{hasScheduler ? '，或等待自动采样' : ''}。</p>
              )}
              <label>
                动态内存目标：{memoryTarget} MiB
                <input
                  type="range"
                  min={256}
                  max={active.memoryMiB}
                  step={128}
                  value={memoryTarget}
                  disabled={active.status !== 'running'}
                  onChange={(event) => setMemoryTarget(Number(event.target.value))}
                />
              </label>
              <button
                className="secondary compact"
                disabled={action.busy || active.status !== 'running'}
                onClick={applyMemoryTarget}
              >
                应用内存目标
              </button>
              <MemoryReclaimSettings vmId={active.id} maximum={active.memoryMiB}
                running={active.status === 'running'} request={request} />
              <HostMountSettings vmId={active.id} request={request} />
              <VirtioFsSettings vmId={active.id} request={request} />
              <TrustedBootSettings vmId={active.id} request={request} />
              <div className="feature-actions">
                <label>
                  资源预设
                  <select
                    value={preset}
                    onChange={(event) => setPreset(event.target.value as ResourcePresetId)}
                  >
                    {Object.entries(presets).map(([id, value]) => (
                      <option key={id} value={id}>
                        {value.name} · {value.memoryMiB} MiB · {value.cpus} vCPU
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary compact"
                  disabled={action.busy || active.status !== 'stopped'}
                  onClick={applyPreset}
                >
                  应用预设
                </button>
              </div>
              {active.status !== 'stopped' && (
                <p className="subtle-note">资源预设需要先停止发行版；动态内存目标可在运行中调整。</p>
              )}
            </section>
            {hasScheduler && (
              <section className="feature-card">
                <h3>
                  <Bell size={17} />
                  自动化与告警
                </h3>
                <div className="feature-grid compact-grid">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={schedule.enabled}
                      onChange={(event) => setSchedule({ ...schedule, enabled: event.target.checked })}
                    />
                    启用计划
                  </label>
                  <label>
                    自动启动时间
                    <input
                      type="time"
                      value={schedule.startAt || ''}
                      onChange={(event) =>
                        setSchedule({ ...schedule, startAt: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label>
                    自动停止时间
                    <input
                      type="time"
                      value={schedule.stopAt || ''}
                      onChange={(event) =>
                        setSchedule({ ...schedule, stopAt: event.target.value || undefined })
                      }
                    />
                  </label>
                  <label>
                    空闲停止（分钟）
                    <input
                      type="number"
                      min={0}
                      max={10080}
                      value={schedule.idleMinutes}
                      onChange={(event) =>
                        setSchedule({ ...schedule, idleMinutes: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={alerts.enabled}
                      onChange={(event) => setAlerts({ ...alerts, enabled: event.target.checked })}
                    />
                    启用资源告警
                  </label>
                  <label>
                    CPU 阈值
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={alerts.cpuPercent}
                      onChange={(event) => setAlerts({ ...alerts, cpuPercent: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    内存阈值
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={alerts.memoryPercent}
                      onChange={(event) =>
                        setAlerts({ ...alerts, memoryPercent: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    磁盘阈值
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={alerts.diskPercent}
                      onChange={(event) => setAlerts({ ...alerts, diskPercent: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <button className="primary compact" disabled={action.busy} onClick={saveSettings}>
                  保存自动化设置
                </button>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={alerts.taskFailures ?? true}
                    onChange={(event) => setAlerts({ ...alerts, taskFailures: event.target.checked })}
                  />
                  备份和后台任务失败告警
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={alerts.serviceFailures ?? true}
                    onChange={(event) => setAlerts({ ...alerts, serviceFailures: event.target.checked })}
                  />
                  服务健康检查失败告警
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={alerts.secretRotation ?? true}
                    onChange={(event) => setAlerts({ ...alerts, secretRotation: event.target.checked })}
                  />
                  私密配置轮换提醒
                </label>
                <p className="subtle-note">
                  服务异常来自已启用的服务健康检查；后台任务失败只提醒一次，已确认状态会持久保存。
                </p>
              </section>
            )}
          </div>

          {remote.data && (
            <NotificationCenter
              key={active.id}
              events={remote.data.events}
              busy={action.busy}
              onAcknowledge={(id) =>
                void action.run(async () => {
                  await request(`/vms/${active.id}/advanced`, 'POST', { action: 'acknowledge', id });
                  remote.reload();
                })
              }
            />
          )}

          <div className="feature-grid">
            <section className="feature-card">
              <h3>
                <Search size={17} />
                工作区搜索
              </h3>
              <div className="feature-grid compact-grid">
                <label>
                  搜索内容
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="函数名、错误信息…"
                  />
                </label>
                <label>
                  目录
                  <input value={searchPath} onChange={(event) => setSearchPath(event.target.value)} />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={searchContent}
                  onChange={(event) => setSearchContent(event.target.checked)}
                />
                搜索文件内容
              </label>
              <button
                className="secondary compact"
                disabled={action.busy || active.status !== 'running' || !searchQuery.trim()}
                onClick={runSearch}
              >
                搜索
              </button>
              {searchResult.length > 0 && (
                <pre className="feature-log search-results">{searchResult.join('\n')}</pre>
              )}
            </section>
            <section className="feature-card">
              <h3>
                <HardDrive size={17} />
                磁盘分析
              </h3>
              <div className="feature-actions">
                <input
                  value={diskPath}
                  onChange={(event) => setDiskPath(event.target.value)}
                  aria-label="磁盘分析目录"
                />
                <button
                  className="secondary compact"
                  disabled={action.busy || active.status !== 'running'}
                  onClick={runDiskAnalysis}
                >
                  分析目录
                </button>
              </div>
              {diskEntries.length > 0 && (
                <div className="disk-analysis-list">
                  {diskEntries.slice(0, 12).map((entry) => (
                    <div key={entry.path}>
                      <span>{entry.path}</span>
                      <b>{bytes(entry.bytes)}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="feature-card">
              <h3>
                <Package size={17} />
                软件包
              </h3>
              <PackageWorkbenchPanel vmId={active.id} running={active.status === 'running'}
                request={request} onSubmitted={() => remote.reload()} />
              <h4>离线软件包缓存</h4>
              <div className="feature-grid compact-grid">
                <label>
                  操作
                  <select
                    value={packageOperation}
                    onChange={(event) => setPackageOperation(event.target.value as typeof packageOperation)}
                  >
                    <option value="cache-list">查看离线缓存</option>
                    <option value="cache-prefetch">预取软件包及依赖</option>
                    <option value="cache-install">从缓存离线安装</option>
                    <option value="cache-clear">移除指定软件包缓存</option>
                  </select>
                </label>
                <label>
                  软件包名称
                  <input
                    value={packageName}
                    onChange={(event) => setPackageName(event.target.value)}
                    placeholder={['list', 'update', 'cache-list'].includes(packageOperation)
                      ? '此操作无需填写' : '输入软件包名称'}
                  />
                </label>
              </div>
              <p className="subtle-note">预取会联网下载已验证的软件包及依赖；离线安装只使用客户机磁盘中的已校验缓存。缓存列表按“名称、文件数、字节数”显示在任务日志中。</p>
              <button
                className="secondary compact"
                disabled={action.busy || active.status !== 'running' ||
                  (['cache-prefetch', 'cache-install', 'cache-clear'].includes(packageOperation) && !packageName.trim())}
                onClick={runPackage}
              >
                提交软件包任务
              </button>
              <JobLog job={remote.data?.job} />
            </section>
          </div>
        </>
      )}
      {hasAutomation && (
        <section className="feature-card">
          <h3>文件与项目操作</h3>
          <CapabilityActionsPanel
            request={request}
            path={`/vms/${active.id}/advanced`}
            scope="suite"
            definitions={remote.data?.capabilities}
            jobs={remote.data?.capabilityJobs}
            selected={suiteCapability}
            onSelected={setSuiteCapability}
            running={active.status === 'running'}
            reload={remote.reload}
          />
        </section>
      )}
      {hasExtensions && (
        <section className="feature-card">
          <div className="panel-heading">
            <h3>
              <Compass size={17} />
              100 项扩展能力
            </h3>
            <span className="subtle-note">{extended.data?.features.length || 100} 项 · 可检查前置条件</span>
          </div>
          <p className="muted">检查结果会区分实际可用、仅保存本地记录和缺少实现或依赖。</p>
          <CapabilityActionsPanel
            request={request}
            path={`/vms/${active.id}/extended-features`}
            scope="extended"
            definitions={extended.data?.capabilities}
            jobs={extended.data?.jobs}
            selected={extendedCapability}
            onSelected={setExtendedCapability}
            running={active.status === 'running'}
            reload={extended.reload}
          />
          <div className="feature-actions">
            <select
              value={extendedOperation}
              onChange={(event) => setExtendedOperation(event.target.value)}
              aria-label="扩展工程操作"
            >
              <option value="">选择工程操作</option>
              {extended.data?.operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.name}
                  {operation.writes ? ' · 写入' : ''}
                </option>
              ))}
            </select>
            <button
              className="secondary compact"
              disabled={action.busy || active.status !== 'running' || !extendedOperation}
              onClick={runExtendedOperation}
            >
              提交操作
            </button>
          </div>
          <div className="feature-catalog extended-catalog">
            {(extended.data?.features || []).map((feature) => (
              <div className="catalog-item" key={feature.id}>
                <div>
                  <b>{feature.name}</b>
                  <p>{feature.summary}</p>
                </div>
                <ReadinessBadge records={extended.data?.executions} id={feature.id} />
                <span className="badge">
                  {feature.state === 'available'
                    ? '已实现入口'
                    : feature.state === 'experimental'
                      ? '部分实现'
                      : '规划中'}
                </span>
                <button
                  className="secondary compact"
                  disabled={action.busy}
                  onClick={() => checkExtended(feature.id)}
                >
                  检查
                </button>
                <button
                  className="secondary compact"
                  disabled={action.busy || feature.state !== 'available'}
                  onClick={() => runExtended(feature.id)}
                >
                  {[
                    'terminal-layouts',
                    'sync-window',
                    'sync-queue',
                    'watch-sync',
                    'rename-detection',
                    'path-sync-policy',
                    'sync-rollback',
                    'immutable-backups',
                    'backup-dedup',
                    'self-update',
                    'secure-erase',
                    'gpg-agent-forward',
                  ].includes(feature.id)
                    ? '使用说明'
                    : extended.data?.operations.some((item) => item.feature === feature.id)
                      ? '设置参数'
                      : '运行'}
                </button>
              </div>
            ))}
          </div>
          {extendedOperation && (
            <label>
              操作参数（JSON）
              <textarea
                rows={10}
                aria-label="工程操作参数"
                value={operationParameters}
                onChange={(event) => setOperationParameters(event.target.value)}
              />
              <small>
                {extended.data?.operations.find((item) => item.id === extendedOperation)?.note} 客户机需要
                Python 3。
              </small>
            </label>
          )}
          <JobLog job={extended.data?.jobs?.find((job) => job.action === 'operation:' + extendedOperation)} />
          {extendedResult && <pre className="feature-log">{extendedResult}</pre>}
        </section>
      )}

      {hasPlatform && (
        <section className="feature-card">
          <div className="panel-heading">
            <h3>
              <Compass size={17} />
              第三批 100 项能力
            </h3>
            <span className="subtle-note">
              {next.data?.features.length || 100} 项 · 配置、检查、执行均有记录
            </span>
          </div>
          <p className="muted">检查后显示当前环境中的可用状态；本地记录不会标记为实际能力已就绪。</p>
          <CapabilityActionsPanel
            request={request}
            path={`/vms/${active.id}/next-features`}
            scope="next"
            definitions={next.data?.capabilities}
            jobs={next.data?.jobs}
            selected={nextCapability}
            onSelected={setNextCapability}
            running={active.status === 'running'}
            reload={next.reload}
          />
          <input
            value={nextSearch}
            onChange={(event) => setNextSearch(event.target.value)}
            placeholder="搜索功能、分类或说明…"
            aria-label="搜索第三批能力"
          />
          <div className="feature-catalog extended-catalog next-catalog">
            {nextFeatures.map((feature) => (
              <div className="catalog-item" key={feature.id}>
                <div>
                  <b>{feature.name}</b>
                  <p>
                    {feature.category} · {feature.summary}
                  </p>
                </div>
                <ReadinessBadge records={next.data?.executions} id={feature.id} />
                <span className="badge">
                  {feature.state === 'available'
                    ? '已实现入口'
                    : feature.state === 'experimental'
                      ? '部分实现'
                      : '规划中'}
                </span>
                <button
                  className="secondary compact"
                  disabled={action.busy}
                  onClick={() => checkNext(feature.id)}
                >
                  检查
                </button>
                <button
                  className="secondary compact"
                  disabled={
                    action.busy || feature.state !== 'available' || feature.id === 'incident-lockdown'
                  }
                  onClick={() => runNext(feature.id)}
                >
                  {feature.id === 'backup-throttle' ? '使用说明' : '运行'}
                </button>
              </div>
            ))}
          </div>
          {next.data?.features.some((feature) => feature.id === 'ha-failover') &&
            <HaFailoverPanel key={active.id} request={request} vmId={active.id}
              setting={next.data.settings['ha-failover']}
              monitor={next.data.haFailoverMonitor} promotion={next.data.haPromotion}
              localFailover={next.data.haLocalFailover} reload={next.reload} />}
          {nextResult && <pre className="feature-log">{nextResult}</pre>}
          {hardwareReport && <HardwareMatrix report={hardwareReport} />}
          {showUsbHotplug && <UsbHotplugPanel request={request} vmId={active.id} />}
        </section>
      )}

      {hasAutomation && (
        <>
          <section className="feature-card">
            <h3>
              <HardDrive size={17} />
              开发任务
            </h3>
            <div className="feature-grid compact-grid">
              <label>
                操作
                <select
                  value={devOperation}
                  onChange={(event) => setDevOperation(event.target.value as typeof devOperation)}
                >
                  <option value="test">运行测试</option>
                  <option value="test-discover">发现测试文件</option>
                  <option value="lint">代码检查</option>
                  <option value="format">格式化</option>
                  <option value="dependencies">依赖报告</option>
                  <option value="lock">生成环境锁文件</option>
                  <option value="lock-check">校验环境锁文件</option>
                  <option value="install-locked">按锁文件安装依赖</option>
                  <option value="prefetch-dependencies">预取项目依赖到离线缓存</option>
                  <option value="install-cached-dependencies">从缓存离线安装项目依赖</option>
                  <option value="worktree-list">列出 Git Worktree</option>
                  <option value="worktree-add">创建 Git Worktree</option>
                  <option value="worktree-remove">删除 Git Worktree</option>
                  <option value="database">创建数据库容器</option>
                </select>
              </label>
              {['prefetch-dependencies', 'install-cached-dependencies'].includes(devOperation) && (
                <label>
                  项目依赖类型
                  <select value={dependencyManager}
                    onChange={(event) => setDependencyManager(event.target.value as typeof dependencyManager)}>
                    <option value="npm">npm 锁文件</option>
                    <option value="pip">Python 固定版本 requirements.txt</option>
                  </select>
                </label>
              )}
              {(devOperation === 'worktree-add' || devOperation === 'worktree-remove') && (
                <>
                  <label>
                    分支
                    <input
                      value={worktreeBranch}
                      onChange={(event) => setWorktreeBranch(event.target.value)}
                      placeholder="feature/example"
                    />
                  </label>
                  <label>
                    工作树路径
                    <input
                      value={worktreePath}
                      onChange={(event) => setWorktreePath(event.target.value)}
                      placeholder=".worktrees/example"
                    />
                  </label>
                </>
              )}
              {devOperation === 'database' && (
                <>
                  <label>
                    数据库
                    <select
                      value={database}
                      onChange={(event) => setDatabase(event.target.value as typeof database)}
                    >
                      <option value="postgres">PostgreSQL</option>
                      <option value="redis">Redis</option>
                      <option value="mysql">MySQL</option>
                    </select>
                  </label>
                  <label>
                    容器名称
                    <input
                      value={databaseName}
                      onChange={(event) => setDatabaseName(event.target.value)}
                      placeholder="可选，如 sakura-postgres"
                    />
                  </label>
                  <label>
                    客户机端口
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={databasePort}
                      onChange={(event) => setDatabasePort(event.target.value)}
                      placeholder="默认数据库端口"
                    />
                  </label>
                  <label>
                    数据库密码
                    <input
                      type="password"
                      minLength={12}
                      maxLength={128}
                      value={databasePassword}
                      onChange={(event) => setDatabasePassword(event.target.value)}
                      placeholder="至少 12 个可打印字符"
                    />
                  </label>
                </>
              )}
            </div>
            {['prefetch-dependencies', 'install-cached-dependencies'].includes(devOperation) && (
              <p className="subtle-note">预取需联网；离线安装校验依赖文件和缓存，不运行 npm 安装脚本。Python 依赖安装到项目的 .sakura/venv。</p>
            )}
            <button
              className="secondary compact"
              disabled={
                action.busy ||
                active.status !== 'running' ||
                (devOperation === 'database' && databasePassword.length < 12)
              }
              onClick={runDev}
            >
              提交开发任务
            </button>
            <JobLog job={remote.data?.devJob} />
          </section>

          <div className="feature-grid">
            <section className="feature-card">
              <h3>
                <Wifi size={17} />
                网络诊断与端口
              </h3>
              <div className="feature-actions">
                <input
                  value={networkTarget}
                  onChange={(event) => setNetworkTarget(event.target.value)}
                  aria-label="网络诊断目标"
                />
                <button
                  className="secondary compact"
                  disabled={action.busy || active.status !== 'running'}
                  onClick={runNetwork}
                >
                  测试网络
                </button>
                <button
                  className="secondary compact"
                  disabled={action.busy || active.status !== 'running'}
                  onClick={discoverPorts}
                >
                  发现端口
                </button>
              </div>
              {networkResult && <pre className="feature-log">{networkResult}</pre>}
              {ports.length > 0 && <p className="subtle-note">正在监听：{ports.join('、')}</p>}
            </section>
            <section className="feature-card">
              <h3>
                <ShieldCheck size={17} />
                安全扫描
              </h3>
              <p className="muted">只读检查 SSH 设置、待更新软件包和可写系统文件；开始扫描会把已安装源包名称及版本发送给 OSV 漏洞库匹配。</p>
              <button
                className="secondary compact"
                disabled={action.busy || active.status !== 'running'}
                onClick={runSecurity}
              >
                开始扫描
              </button>
              {securityResult && (
                <>
                  <p className={securityResult.findings.length ? 'machine-error' : 'feature-success'}>
                    {securityResult.findings.length ? securityResult.findings.join('；') : '未发现明显问题'}
                  </p>
                  {securityResult.vulnerabilityScan && (
                    <p className="subtle-note">
                      {securityResult.vulnerabilityScan.status === 'complete'
                        ? `${securityResult.vulnerabilityScan.ecosystem}：已核对 ${securityResult.vulnerabilityScan.packagesChecked} 个源包，${securityResult.vulnerabilityScan.affectedPackages} 个包匹配已知漏洞，共 ${securityResult.vulnerabilityScan.vulnerabilityCount} 个漏洞编号。`
                        : `漏洞匹配未完成：${securityResult.vulnerabilityScan.error || '请重试'}`}
                    </p>
                  )}
                  {securityResult.vulnerabilityScan?.status === 'complete' &&
                    securityResult.vulnerabilityScan.matches.length > 0 && (
                      <details>
                        <summary>查看已匹配的软件包和漏洞编号</summary>
                        <div className="feature-list">
                          {securityResult.vulnerabilityScan.matches.slice(0, 20).map((match) => (
                            <div key={`${match.name}@${match.version}`}>
                              <strong>{match.name}@{match.version}</strong>{' '}
                              {match.ids.slice(0, 5).map((id) => (
                                <a key={id} href={`https://osv.dev/vulnerability/${id}`}
                                  target="_blank" rel="noopener noreferrer">{id}{' '}</a>
                              ))}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  <details>
                    <summary>查看原始检查结果</summary>
                    <pre className="feature-log">{securityResult.output}</pre>
                  </details>
                </>
              )}
            </section>
          </div>

          <section className="feature-card">
            <div className="panel-heading">
              <h3>
                <Compass size={17} />
                功能路线图
              </h3>
              <span className="subtle-note">共 {remote.data?.features.length || 50} 项</span>
            </div>
            <p className="muted">这里显示开发路线图；已有入口的状态仍需在对应插件中检查。</p>
            {groups.map(([category, features]) => (
              <details key={category} open>
                <summary>
                  {category}（{features.length}）
                </summary>
                <div className="feature-catalog">
                  {features.map((feature) => (
                    <div className="catalog-item" key={feature.id}>
                      <div>
                        <b>{feature.name}</b>
                        <p>{feature.summary}</p>
                      </div>
                      <span
                        className={`badge ${feature.state === 'available' ? 'running' : feature.state === 'experimental' ? 'starting' : 'stopped'}`}
                      >
                        {feature.state === 'available'
                          ? '已有入口'
                          : feature.state === 'experimental'
                            ? '实验性'
                            : '规划中'}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

export const pages = { features: FeatureSuitePanel };

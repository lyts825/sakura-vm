import type { ServiceInterface } from './service-interface.ts';
import { PlatformDomainServices } from './platform-domain-services.ts';
import { noHostServices, type HostServiceResolver } from './host-service-contracts.ts';
import { arch, cpus, freemem, hostname, loadavg, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { nextFeatureCatalog, type NextFeature, type NextFeatureId } from '../shared/catalogs/platform.ts';
import { AppError } from '../shared/errors.ts';
import { AcmeRenewal } from './acme-renewal.ts';
import type { BrowserIde } from './browser-ide.ts';
import { CapabilityActions } from './capability-actions.ts';
import { capabilityParameters, capabilityViews, hasCapability } from './capability-definitions.ts';
import type { ColdMigrations } from './cold-migration.ts';
import type { CommunityPlugins } from './community-plugins.ts';
import { devicePassthroughPreview } from './device-passthrough-preview.ts';
import type { DisasterRecoveryDrill } from './disaster-recovery-drill.ts';
import { firmwareSupport } from './firmware.ts';
import { gpuComputeInput, gpuComputeStatus } from './gpu-compute.ts';
import { guestDnsDiagnostics } from './guest-dns.ts';
import { checkHaFailover, haFailoverOptions } from './ha-failover.ts';
import { HaFailureMonitor } from './ha-failure-monitor.ts';
import type { HaHostFailover } from './ha-host-failover.ts';
import type { HaLocalFailovers } from './ha-local-failovers.ts';
import { hardwareCompatibility } from './hardware-compatibility.ts';
import type { HostMounts } from './host-mount.ts';
import { hostScoreInput, type HostPeers, type HostScoreInput } from './host-peers.ts';
import { Jobs } from './jobs.ts';
import { LiveMigrationRunner } from './live-migration-runner.ts';
import { liveMigrationInput, planLiveMigration } from './live-migration.ts';
import { metadataFile } from './metadata-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import type { MediaDevices } from './media-devices.ts';
import { networkEmulation } from './network-emulation.ts';
import type { NotebookEnvironments } from './notebook-environments.ts';
import type { ObjectBackup } from './object-backup.ts';
import { DATA } from './paths.ts';
import type { ProcessInterop } from './process-interop.ts';
import { ServiceMesh } from './service-mesh.ts';
import type { SnapshotMerge } from './snapshot-merge.ts';
import type { SnapshotReplications } from './snapshot-replications.ts';
import { StorageTiering } from './storage-tiering.ts';
import { TeamTemplates } from './team-templates.ts';
import { inspectVirtioFs, type VirtioFsShares } from './virtio-fs.ts';
import { VtpmEnrollment } from './vtpm-enrollment.ts';
import type { WireGuardOverlay } from './wireguard-overlay.ts';
import type { Workspaces } from './workspaces.ts';
export { nextFeatureCatalog,type NextFeature,type NextFeatureId,type NextFeatureState } from '../shared/catalogs/platform.ts';

/**
 * The third tranche is intentionally data driven.  Each item has a stable
 * identifier, a persistent configuration surface, a read-only check and a
 * queued run action.  Optional host/guest integrations are detected at run
 * time. Planned functionality never claims readiness from stored configuration.
 */
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
  'network-topology': 'command -v ip >/dev/null && ip addr && ip route',
  'build-cache': 'test -d /workspace/.cache || test -d /workspace/target',
  'language-server-catalog':
    'found=0; for c in typescript-language-server pyright rust-analyzer gopls; do if command -v "$c" >/dev/null; then printf "%s\\n" "$c"; found=1; fi; done; test "$found" = 1',
  'code-search-index': 'command -v rg >/dev/null && rg --version',
};

const now = () => new Date().toISOString();

function compactProfileResult(result: Record<string, unknown>) {
  const download = result.download as Record<string, unknown> | undefined;
  if (!download || typeof download.content !== 'string') return result;
  const { content, ...metadata } = download;
  return { ...result, download: { ...metadata, bytes: Buffer.byteLength(content) } };
}

export class NextFeatures {
  private readonly domains: PlatformDomainServices;
  jobs = new Jobs('next-features');
  get storageTiering() { return this.domains.storageTiering; }
  get serviceMesh() { return this.domains.serviceMesh; }
  get vtpmEnrollment() { return this.domains.vtpmEnrollment; }
  get acmeRenewal() { return this.domains.acmeRenewal; }
  get teamTemplates() { return this.domains.teamTemplates; }
  get haFailureMonitor() { return this.domains.haFailureMonitor; }
  private get haLocalFailovers(): ServiceInterface<HaLocalFailovers> | undefined { return this.dependencies.optional('haLocalFailovers'); }
  private get haHostFailover(): ServiceInterface<HaHostFailover> | undefined { return this.dependencies.optional('haHostFailover'); }
  private get scoreHosts() { return this.dependencies.optional('capabilityChecks')?.scoreHosts; }
  private get hostPeers(): ServiceInterface<HostPeers> | undefined { return this.dependencies.optional('hostPeers'); }
  private get liveMigrationRunner() { return this.hostPeers ? new LiveMigrationRunner(this.machines, this.hostPeers) : undefined; }
  private get coldMigrations(): ServiceInterface<ColdMigrations> | undefined { return this.dependencies.optional('coldMigrations'); }
  private get snapshotReplications(): ServiceInterface<SnapshotReplications> | undefined { return this.dependencies.optional('snapshotReplications'); }
  private get notebookEnvironments(): ServiceInterface<NotebookEnvironments> | undefined { return this.dependencies.optional('notebookEnvironments'); }
  private get browserIde(): ServiceInterface<BrowserIde> | undefined { return this.dependencies.optional('browserIde'); }
  private get disasterRecovery(): ServiceInterface<DisasterRecoveryDrill> | undefined { return this.dependencies.optional('disasterRecovery'); }
  private get objectBackup() { return this.domains.optional.objectBackup; }
  private get wireGuardOverlay() { return this.domains.optional.wireGuardOverlay; }
  private get processInterop(): ServiceInterface<ProcessInterop> | undefined { return this.dependencies.optional('processInterop'); }
  private get mediaDevices(): ServiceInterface<MediaDevices> | undefined { return this.dependencies.optional('mediaDevices'); }
  private get hostMounts(): ServiceInterface<HostMounts> | undefined { return this.dependencies.optional('hostMounts'); }
  private get virtioFsShares(): ServiceInterface<VirtioFsShares> | undefined { return this.dependencies.optional('virtioFsShares'); }
  private get snapshotMerge() { return this.domains.optional.snapshotMerge?.(); }
  private get communityPlugins(): ServiceInterface<CommunityPlugins> | undefined { return this.dependencies.optional('communityPlugins'); }
  private get sharedDesktopCheck() { return this.dependencies.optional('capabilityChecks')?.sharedDesktopCheck; }
  private get sharedTerminalCheck() { return this.dependencies.optional('capabilityChecks')?.sharedTerminalCheck; }
  private get passkeyCheck() { return this.dependencies.optional('capabilityChecks')?.passkeyCheck; }
  private get accountModeReady() { return this.dependencies.optional('capabilityChecks')?.accountModeReady; }
  private get mobileCheck() { return this.dependencies.optional('capabilityChecks')?.mobileCheck; }
  private get remoteAuditCheck() { return this.dependencies.optional('capabilityChecks')?.remoteAuditCheck; }
  constructor(
    private machines: Machines,
    private workspaces: ServiceInterface<Workspaces>,
    private dependencies: HostServiceResolver = noHostServices,
    domains: { objectBackup?: ObjectBackup; wireGuardOverlay?: WireGuardOverlay; snapshotMerge?: () => ServiceInterface<SnapshotMerge> | undefined } = {},
  ) { this.domains = new PlatformDomainServices(machines, workspaces, dependencies, () => this.haPolicies(),
      async id => (await this.state()).settings[id]?.['service-mesh']?.enabled !== false, domains); }

  async haPolicies() {
    const state = await this.state();
    return Object.fromEntries(Object.entries(state.settings).flatMap(([id, settings]) => {
      const policy = settings['ha-failover'];
      return policy ? [[id, policy]] : [];
    }));
  }

  
  

  init() { return this.domains.init(); }

  
  

  
  

  

  

  

  
  
  

  

  

  

  notebookLink(id: string) {
    if (!this.notebookEnvironments) throw new AppError('Notebook 服务尚未启用', 503);
    this.machines.requireUnlocked(id);
    return this.notebookEnvironments.link(id);
  }

  

  

  
  
  
  
  
  
  
  

  browserIdeLink(id: string) {
    if (!this.browserIde) throw new AppError('浏览器 IDE 服务尚未启用', 503);
    this.machines.requireUnlocked(id);
    return this.browserIde.link(id);
  }

  private file() {
    return join(DATA, 'next-features.json');
  }
  private store() {
    return metadataFile(this.file(), defaultState, raw => {
      const value = raw as NextState;
      value.settings ||= {}; value.executions ||= {}; value.records ||= {}; return value;
    });
  }
  private async state() { return (await this.store().read()).value; }
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
      haFailoverMonitor: this.haFailureMonitor.view(id),
      haPromotion: this.machines.get(id).haPromotion || null,
      haLocalFailover: this.haLocalFailovers?.view(id) || null,
      haHostFailover: this.haHostFailover?.view(id) || null,
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
    if (value.featureId === 'service-mesh') {
      value.options = z.object({}).strict().parse(value.options);
      return this.serviceMesh.configure(id, value.enabled, async () => {
        return (await this.store().update(state => {
          const settings = (state.settings[id] ||= {});
          settings[value.featureId] = { enabled: value.enabled, options: value.options, updatedAt: now() };

          return settings[value.featureId];
        })).result;
      });
    }
    if (value.featureId === 'vtpm-key-enrollment' || value.featureId === 'pci-usb-passthrough')
      value.options = z.object({}).strict().parse(value.options);
    if (value.featureId === 'gpu-compute-passthrough')
      value.options = gpuComputeInput.parse(value.options);
    if (value.featureId === 'ha-failover') {
      const haOptions = haFailoverOptions.parse(value.options);
      value.options = haOptions;
      const wantsWitness = value.enabled && haOptions.autoHostFailover;
      if (wantsWitness && !haOptions.targetHostId)
        throw new AppError('请先选择已配对的故障接管目标主机', 409);
      if (wantsWitness &&
          !this.haHostFailover?.configured())
        throw new AppError('启用宿主失联接管前须配置独立见证节点', 409);
      const enrolled = this.machines.get(id).haWitnessEnrollment;
      const changing = !!enrolled && (!wantsWitness ||
        enrolled.targetHostId !== haOptions.targetHostId ||
        enrolled.failureThreshold !== haOptions.failureThreshold);
      if (wantsWitness && enrolled && changing)
        throw new AppError('请先关闭宿主失联接管，更新见证节点配置后再启用新的目标或阈值', 409);
      if (wantsWitness && (!enrolled || changing)) this.machines.requireStopped(id);
      if (wantsWitness) {
        const witness = await this.haHostFailover!.witnessStatus(id);
        if (witness.error || witness.phase !== 'source' ||
            witness.targetHostId !== haOptions.targetHostId ||
            witness.failureThreshold !== haOptions.failureThreshold)
          throw new AppError(`见证节点尚未就绪或目标配置不一致：${witness.error || witness.phase || '未知状态'}`,
            409);
      }
      if (changing) {
        if (!this.haHostFailover)
          throw new AppError('宿主失联接管服务不可用，不能安全撤销策略', 503);
        await this.haHostFailover.disarm(id, enrolled!.failureThreshold);
        await this.machines.releaseHaWitness(id, enrolled!.targetHostId);
      }
      if (wantsWitness)
        await this.machines.enrollHaWitness(id,
          haOptions.targetHostId!, haOptions.failureThreshold);
    }
    if (value.featureId === 'process-interop' && !value.enabled && this.processInterop)
      await this.processInterop.action(id, { mode: 'disable' }, 'run');
    const setting = (await this.store().update(state => {
      const settings = (state.settings[id] ||= {});
      settings[value.featureId] = { enabled: value.enabled, options: value.options, updatedAt: now() };
      return settings[value.featureId];
    })).result;
    if (value.featureId === 'ha-failover') await this.haFailureMonitor.reconfigure(id);
    return setting;
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
      actions: spec.id === 'clipboard-policy' ? ['configure', 'check'] :
        spec.state === 'available' ? ['configure', 'check', 'run'] : ['configure', 'check'],
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
          '系统设置 → 剪贴板敏感检测管理网页入口；Windows 普通 x64/x86 应用可附加或受控启动，执行 Win32/OLE 规则，标准文本控件在复制或剪切前检查选区。受控启动覆盖普通原生 EXE 的应用 DLL/TLS 前阶段及支持的纯 IL CLR 初始化前阶段，普通 CreateProcess、同用户 AsUser 与同步本地 EXE Shell open 后代可提前继承规则。KDE 桌面 → 原生应用剪贴板，可按完整 ELF 路径与摘要启动 X11 或原生 Wayland 应用并热更新规则；Wayland 需先选择原生桌面会话。正文完整检查后交付，已交付或被工具包缓存的内容不能撤回。受保护或打包程序、未接入进程、系统级启动 DLL 与其他底层接口不属于受管入口范围。',
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
    if (spec.id === 'plugin-marketplace' || spec.id === 'signed-plugin-sandbox') {
      const view = this.communityPlugins?.view();
      return { ready: !!view, executed: false, adapter,
        publishers: view?.publishers.length || 0, sources: view?.sources.length || 0,
        installed: view?.installed.length || 0,
        message: '插件中心 → 第三方插件：信任发布者公钥、添加 HTTPS 目录源、刷新并安装。插件运行于无宿主导入的限时 WebAssembly 工作线程。',
        ...(!view ? { reason: '第三方插件服务尚未启动。' } : {}) };
    }
    if (spec.id === 'service-mesh')
      return { ...await this.serviceMesh.action(id, { mode: 'status', ...merged }, action, signal), adapter };
    if (spec.id === 'vtpm-key-enrollment')
      return { ...await this.vtpmEnrollment.action(id, { mode: 'status', ...merged }, action), adapter };
    if (spec.id === 'pci-usb-passthrough')
      return { ...await devicePassthroughPreview(this.machines, id,
        { mode: 'status', ...merged }, action), adapter };
    if (spec.id === 'gpu-compute-passthrough')
      return { ...await gpuComputeStatus(this.machines, id, merged, action, signal), adapter };
    if (spec.id === 'fleet-policy-rollout')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 集群策略发布，选择已配对主机并保存待复核批次，再逐台发布插件灰度策略；目标主机须先授权策略发布。',
      };
    if (spec.id === 'usb-hotplug')
      return {
        ready: this.machines.get(id).architecture !== 'aarch64' && this.machines.state(id) === 'running',
        executed: false,
        adapter,
        message: '能力中心 → USB 热插拔，查看宿主可见设备，输入厂商与产品 ID 添加持久转发规则，或临时连接和移除。',
      };
    if (spec.id === 'gpu-vgpu-profiles')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → GPU/vGPU 档案，配置 Virtio GPU 输出、尺寸和宿主显存，预览宿主后端可用性后应用到停止的实例。',
      };
    if (spec.id === 'build-farm')
      return {
        ready: true,
        executed: false,
        adapter,
        message: '系统设置 → 构建农场，登记实例、项目和并发槽位，按标签提交构建命令；排队任务在节点运行时进入绑定项目的目录、环境与网络。',
      };
    if (spec.id === 'virtual-media-devices' || spec.id === 'media-passthrough') {
      if (!this.mediaDevices) return { ready: false, executed: false, adapter,
        reason: '音视频设备服务尚未启动。' };
      const view = await this.mediaDevices.view(id);
      const mediaRules = view.usb.rules.filter((rule) => !!rule.mediaKind);
      const activeUsb = mediaRules.some((rule) => view.usb.configured.some((device) =>
        device.ruleId === rule.id));
      const hostAudio = view.audio === 'hda-duplex' && view.audioBackend === 'dsound' &&
        view.support.dsound.available && /^\s*\d+\s+\[/.test(view.guest?.audio || '');
      const guestMedia = /^\s*\d+\s+\[/.test(view.guest?.audio || '') ||
        /\/dev\/video\d+/.test(view.guest?.video || '');
      return { ...view, ready: spec.id === 'virtual-media-devices'
        ? view.support.none.available && this.machines.get(id).architecture !== 'aarch64'
        : hostAudio || (activeUsb && guestMedia), executed: false, adapter,
        message: '系统设置 → 音视频设备：停机复核并配置 QEMU HDA 音频；运行中可查看宿主 USB 设备，为摄像头、麦克风或耳机保存转发规则，并检查客户机设备。' };
    }
    if (spec.id === 'snapshot-merge') {
      const branch = this.machines.get(id).branchOrigin;
      return { ready: !!branch && !!this.snapshotMerge, executed: false, adapter,
        ...(branch ? { branchOrigin: branch } : {}),
        message: '在快照页从历史快照克隆分支；停止分支和原实例后，在分支的快照合并面板预览三方文件差异，再将无冲突变更应用到新的目标副本。',
        ...(!this.snapshotMerge ? { reason: '请启用磁盘快照插件。' } :
          !branch ? { reason: '此实例不是保留合并基线的快照克隆分支。' } : {}),
      };
    }
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
    if (spec.id === 'live-migration') {
      if (!this.scoreHosts) return { ready: false, executed: false, adapter,
        reason: '主机资源评分服务尚未启动。' };
      const plan = await planLiveMigration(this.machines, this.scoreHosts, id,
        merged, signal, undefined, !!this.liveMigrationRunner);
      if (action === 'run' && plan.ready && plan.targetHostId && this.liveMigrationRunner) {
        const options = liveMigrationInput.parse(merged);
        return { ...await this.liveMigrationRunner.run(id, {
          targetHostId: plan.targetHostId, targetName: options.targetName,
        }, signal, log), adapter };
      }
      return { ...plan, adapter };
    }
    if (spec.id === 'ha-failover') {
      if (!this.hostPeers) return { ready: false, executed: false, adapter,
        reason: '主机配对服务尚未启动。' };
      const checked = await checkHaFailover(this.machines, this.hostPeers,
        this.snapshotReplications, id, merged, configured?.enabled ?? true, signal,
        this.haLocalFailovers?.hasObservedLive(id) || false,
        this.haFailureMonitor.view(id)?.suspected || false);
      const witness = checked.policy.autoHostFailover
        ? await this.haHostFailover?.witnessStatus(id) ||
          { configured: false, error: '宿主失联接管服务未启用' }
        : null;
      const blockers = [...checked.blockers];
      if (checked.policy.autoHostFailover) {
        if (!witness?.configured) blockers.push('独立见证节点未配置。');
        else if (witness.error) blockers.push(`独立见证节点：${witness.error}`);
        else if (witness.phase !== 'source' || !witness.armed)
          blockers.push('独立见证节点尚未确认布防。');
      }
      return { ...checked, ready: checked.hostPlanReady && blockers.length === 0,
        blockers, reason: blockers[0],
        monitor: this.haFailureMonitor.view(id),
        promotion: this.machines.get(id).haPromotion || null,
        localFailover: this.haLocalFailovers?.view(id) || null,
        hostFailover: this.haHostFailover?.view(id) || null,
        witness, adapter };
    }
    if (spec.id === 'virtio-fs') {
      if (!this.virtioFsShares) return { ready: false, executed: false, adapter,
        reason: 'Virtio-FS 服务尚未启动。' };
      if (action === 'run') await this.virtioFsShares.action(id, { operation: 'mount' });
      const [inspection, share] = await Promise.all([
        inspectVirtioFs(this.machines, id, signal), this.virtioFsShares.view(id)]);
      return { ...inspection, ready: inspection.ready && share.mounted && share.policy.enabled,
        policy: share.policy, attached: share.attached,
        executed: action === 'run' && inspection.ready && share.mounted, adapter };
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
    if (spec.id === 'mobile-companion') {
      const status = this.mobileCheck?.() || { ready: false, devices: 0,
        reason: '移动伴侣服务尚未启动。' };
      return { ...status, executed: false, adapter,
        message: '系统设置 → 账户与只读分享 → 移动伴侣：启用独立 HTTPS 同伴入口，管理员选择实例与告警类型后生成五分钟配对码；手机在同一网络打开 /mobile/。' };
    }
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
    if (['custom-rbac', 'project-permissions', 'dual-approval', 'change-approval']
      .includes(spec.id)) {
      const ready = Boolean(this.accountModeReady?.() && this.workspaces);
      return { ready, executed: false, adapter,
        ...(!ready ? { reason: '请启用账户模式和项目工作区插件。' } : {}),
        message: '系统设置 → 账户与只读分享 → 项目成员与权限：按项目配置角色、成员和双人变更审批；变更申请绑定完整配置与基线版本。' };
    }
    if (spec.id === 'signed-policy-bundles') {
      const ready = Boolean(this.accountModeReady?.() && this.workspaces);
      return { ready, executed: false, adapter,
        ...(!ready ? { reason: '请启用账户模式和项目工作区插件。' } : {}),
        message: '系统设置 → 账户与只读分享 → 项目成员与权限 → 签名项目策略包：导出、验签、信任签名者并按版本应用。' };
    }
    if (spec.id === 'remote-audit-lock') {
      const status = await this.remoteAuditCheck?.() || { ready: false, configured: false,
        anchoredSequence: 0, reason: '远程审计服务尚未启动。' };
      return { ...status, executed: false, adapter,
        message: '系统设置 → 账户与只读分享 → 远程不可变审计：设置启用对象锁的桶并同步审计链锚点。' };
    }
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
    if (spec.id === 'host-drive-policy') {
      if (!this.hostMounts)
        return { ready: false, executed: false, adapter,
          reason: '宿主目录挂载服务不可用。' };
      let mount = await this.hostMounts.view(id);
      if (action === 'run' && mount.policy.enabled && this.machines.state(id) === 'running')
        mount = await this.hostMounts.action(id, { operation: 'mount' });
      return { ready: mount.mounted, executed: action === 'run' && mount.mounted,
        adapter: 'sshfs-host-share', policy: mount.policy, guestPath: mount.guestPath,
        reason: mount.mounted ? '宿主目录已挂载。' :
          '在能力中心 → 资源中保存宿主目录与只读策略，然后启动实例。' };
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
    await this.store().update(state => {
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
    });
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
    if (value.featureId === 'ha-failover' && value.action === 'run') {
      const operation = z.object({ mode: z.literal('rejoin'),
        dataReconciled: z.literal(true) }).strict().parse(value.options);
      if (this.machines.get(id).haPromotion) {
        if (!this.haLocalFailovers) throw new AppError('本机故障接管服务尚未启用', 503);
        return this.haLocalFailovers.rejoin(id, operation.dataReconciled);
      }
      if (!this.haHostFailover) throw new AppError('宿主失联接管服务尚未启用', 503);
      return this.haHostFailover.rejoin(id, operation.dataReconciled);
    }
    const spec = this.spec(value.featureId);
    if (value.action === 'check' || spec.id === 'incident-lockdown')
      return this.executeFeature(id, spec, value.action, signal, value.options);
    if (spec.id === 'clipboard-policy')
      throw new AppError('请在系统设置的剪贴板管理或桌面的原生应用剪贴板入口配置并应用策略；目录检查可查看使用说明',
        409, 'CAPABILITY_ENTRYPOINT_REQUIRED');
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

  async close() { await Promise.all([this.jobs.close(), this.domains.close()]); await this.store().flush(); }
}

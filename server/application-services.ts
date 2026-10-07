/**
 * 模块职责：创建并连接应用领域服务及恢复来源；服务就绪和关闭由共同生命周期约束。
 */
import type { BrowserIdeV1, ColdMigrationsV1, HaHostFailoverV1, HaLocalFailoversV1, HostPeersV1, NotebookEnvironmentsV1, RecoveryCatalogV1, ResourceScopeV1, SnapshotReplicationsV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import { arch, cpus, freemem, hostname, loadavg, platform, totalmem } from 'node:os';
import { AppError } from '../shared/errors.ts';
import { AccessControl } from './access-control.ts';
import { hostAudit } from './audit.ts';
import { AutomationRules } from './automation-rules.ts';
import { BrowserExtensions } from './browser-extensions.ts';
import { BrowserIde } from './browser-ide.ts';
import { BuildFarm } from './build-farm.ts';
import { ChangeApprovals } from './change-approvals.ts';
import { ColdMigrations } from './cold-migration.ts';
import { CommunityPlugins } from './community-plugins.ts';
import { DisasterRecoveryDrill } from './disaster-recovery-drill.ts';
import { runEngineeringOperation } from './engineering-runner.ts';
import { FeatureRollouts } from './feature-rollouts.ts';
import { Features } from './features.ts';
import { FleetPolicyRollouts } from './fleet-policy-rollouts.ts';
import { GpuProfiles } from './gpu-profiles.ts';
import { GraphApi, querySnapshot } from './graphql-api.ts';
import { HaHostFailover } from './ha-host-failover.ts';
import { HaLocalFailovers } from './ha-local-failovers.ts';
import { HaWitnessClient } from './ha-witness-client.ts';
import { createHostImportReceiver } from './host-import-receiver.ts';
import { HostMounts } from './host-mount.ts';
import { HostPeers, isAuthenticatedMigrationCompletion, type HostPeerDependencies } from './host-peers.ts';
import { createLiveMigrationCompletionPort } from './live-migration-proof.ts';
import { registerLiveMigrationCompletionPort } from './live-migration-runner.ts';
import { JitPrivileges } from './jit-privileges.ts';
import { Jobs } from './jobs.ts';
import { LiveMigrationReceiver, registerLiveMigrationTargetPort } from './live-migration-receiver.ts';
import { LocalAssistant } from './local-assistant.ts';
import { LogRetention } from './log-retention.ts';
import { Machines } from './machines.ts';
import { MediaDevices } from './media-devices.ts';
import { MemoryReclaim } from './memory-reclaim.ts';
import { MobileCompanion } from './mobile-companion.ts';
import { NativeClipboard } from './native-clipboard.ts';
import { NativeIntegration, nativeMappings } from './native-integration.ts';
import { NotebookEnvironments } from './notebook-environments.ts';
import { Passkeys } from './passkeys.ts';
import { DATA, PORT } from './paths.ts';
import { join } from 'node:path';
import { hostRuntime } from './host-runtime/index.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { withoutOperationContext } from './operation-context.ts';
import { withoutPluginAuthority } from './plugin-authority.ts';
import { RecoveryCatalog } from './recovery-catalog.ts';
import { pluginRecoverySource, resourceRecoverySource } from './recovery-sources.ts';
import { domainRecoverySources } from './domain-recovery-sources.ts';
import { haPromotionRecoverySource, liveMigrationRecoverySource } from './fence-recovery-sources.ts';
import { PluginManager } from './plugin-manager.ts';
import { validateRegistry } from './plugins/registry.ts';
import { PolicyBundles } from './policy-bundles.ts';
import { ProcessInterop } from './process-interop.ts';
import { ProjectExecution } from './project-execution.ts';
import { ProjectPermissions } from './project-permissions.ts';
import { RemoteAuditLock } from './remote-audit.ts';
import { ClosePhase, ResourceScope } from './resource-scope.ts';
import { createRuntime } from './runtime.ts';
import { SessionLock } from './session-lock.ts';
import { SnapshotReplications } from './snapshot-replications.ts';
import { SingleSignOn } from './sso.ts';
import { TerminalSharing } from './terminal-sharing.ts';
import { TrustedBootService } from './trusted-boot-service.ts';
import { UsbHotplug } from './usb-hotplug.ts';
import { VirtioFsShares } from './virtio-fs.ts';
import { Webhooks, collectWebhookEvents } from './webhooks.ts';
import { Workspaces } from './workspaces.ts';
import { RuntimeDiagnostics } from './runtime-diagnostics.ts';
import type { SystemServiceContracts } from './service-contracts.ts';

export async function createApplicationServices(resources: ResourceScopeV1, plugins: PluginManager) {
  let acceptingRequests = false;
  const requireAdmission = () => {
    if (!acceptingRequests) throw new AppError('服务尚未就绪或正在关闭', 503, 'SERVICE_NOT_READY');
  };
  resources.defer(
    'application-readiness',
    () => {
      acceptingRequests = false;
    },
    ClosePhase.admission,
  );
  const diagnostics = resources.own('runtime-diagnostics', new RuntimeDiagnostics(), ClosePhase.audit);
  const recoveries = resources.own(
    'recovery-directory',
    new RecoveryCatalog(join(DATA, 'recovery-directory.json'), () => hostRuntime.snapshot().resources),
    ClosePhase.audit - 1,
  );
  recoveries.register(pluginRecoverySource(plugins, () => hostRuntime.snapshot()));
  recoveries.register(resourceRecoverySource(() => hostRuntime.snapshot()));
  await recoveries.init();
  let refreshPending = false;
  let refreshRequested = false;
  const refreshRecoveries = () => {
    refreshRequested = true;
    if (refreshPending) return;
    refreshPending = true;
    void withoutOperationContext(() => withoutPluginAuthority(() => withNewResourceContext({ owner: 'core:recovery' }, async () => {
      while (refreshRequested) {
        refreshRequested = false;
        await recoveries.refresh();
      }
    })))
      .catch((error) => console.error('恢复目录持久化失败：', error))
      .finally(() => {
        refreshPending = false;
      });
  };
  resources.defer(
    'recovery-directory-events',
    plugins.directory.subscribe(refreshRecoveries),
    ClosePhase.audit - 2,
  );
  resources.defer(
    'recovery-resource-events',
    hostRuntime.subscribeCleanup(refreshRecoveries),
    ClosePhase.audit - 2,
  );
  plugins.system.ready('@pluginDirectory', plugins.directory);
  const connectionHooks = { terminate: () => {} };
  let token = randomBytes(32).toString('hex');
  let sessionChanged = (_locked: boolean, _transitioned: boolean) => {};
  let features: Features;
  const session = await plugins.system.start({
    id: 'session',
    startup: 'required',
    requires: [],
    create: (dependencies) => new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned)),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 10,
  });
  const access = await plugins.system.start({
    id: 'access',
    startup: 'required',
    requires: [],
    create: (dependencies) => new AccessControl(),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 20,
  });
  const passkeys = await plugins.system.start({
    id: 'passkeys',
    startup: 'required',
    requires: ['access'],
    create: (dependencies) => new Passkeys(dependencies.get('access'), PORT),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 40,
  });
  const sso = await plugins.system.start({
    id: 'sso',
    startup: 'required',
    requires: ['access'],
    create: (dependencies) => new SingleSignOn(dependencies.get('access'), PORT, undefined, undefined, undefined, undefined, () => {
        connectionHooks.terminate();
      }),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 30,
  });
  const dev = process.argv.includes('--dev');
  validateRegistry();
  const selectedPlugins = await plugins.init();
  const engine = await createRuntime();
  const releaseRuntimeOwnership = resources.defer('runtime', () => engine.runtime.close(), ClosePhase.engine);
  const machines = new Machines(engine);
  resources.defer('machines', () => machines.close(), ClosePhase.machines, ['audit', 'network', 'compute']);
  releaseRuntimeOwnership();
  await machines.init();
  plugins.system.ready('@machines', machines);
  resources.defer(
    'plugin-directory-events',
    plugins.directory.subscribe(() => machines.emit('change')),
    1,
  );
  const terminalSharing = await plugins.system.startDegradable({
    id: 'terminalSharing',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'terminal-sharing.json'),
    requires: ['@machines'],
    lateRequires: ['projectTerminals'],
    disposeRequires: ['projectTerminals'],
    create: (dependencies) => new TerminalSharing(
        dependencies.vm(),
        undefined,
        undefined,
        () => { requireAdmission(); return dependencies.late('projectTerminals'); },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 50,
  });
  const jitPrivileges = await plugins.system.start({
    id: 'jitPrivileges',
    startup: 'required',
    requires: ['access', '@machines'],
    create: (dependencies) => new JitPrivileges(dependencies.get('access'), dependencies.vm()),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 80,
  });
  const browserExtensions = await plugins.system.startDegradable({
    id: 'browserExtensions',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'browser-extensions.json'),
    requires: ['access'],
    create: (dependencies) => new BrowserExtensions(dependencies.get('access')),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 120,
  });
  const audit = resources.own('audit', hostAudit(), ClosePhase.audit);
  plugins.system.ready('@audit', audit);
  const remoteAudit = await plugins.system.start({
    id: 'remoteAudit',
    startup: 'required',
    requires: ['@audit', 'session'],
    lateRequires: ['@plugins'],
    create: (dependencies) => new RemoteAuditLock(
        dependencies.get('@audit'),
        undefined,
        undefined,
        undefined,
        undefined,
        () => acceptingRequests && !dependencies.late('@plugins')?.migration?.blocked && !dependencies.get('session').view().locked,
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 350,
  });
  Jobs.instrument = (job, work) =>
    audit.span(
      {
        kind: 'job',
        name: (job.scope || 'task') + ':' + (job.action || 'run'),
        vmId: job.vmId,
        projectId: job.projectId,
        jobId: job.id,
      },
      work,
    );
  const rollouts = await plugins.system.start({
    id: 'rollouts',
    startup: 'required',
    requires: [],
    lateRequires: ['@plugins'],
    disposeRequires: ['@plugins'],
    create: (dependencies) => new FeatureRollouts(
        undefined,
        () => !acceptingRequests || !!dependencies.late('@plugins')?.migration?.blocked,
        (delta) => {
          if (dependencies.late('@plugins')) dependencies.late('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 200,
  });
  features = await plugins.start(machines, (id) => rollouts.decision(id).allowed);
  resources.defer('features', () => features.close(), ClosePhase.plugins,
    ['machines', 'audit', 'network', 'compute', 'scheduler']);
  plugins.system.ready('@plugins', features);
  const projectTerminals = await plugins.system.start({
    id: 'projectTerminals',
    startup: 'required',
    requires: ['@plugins'],
    create: (dependencies) => dependencies.get('@plugins').terminalHandle(),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 70,
  });
  const projectExecution = await plugins.system.start({
    id: 'projectExecution',
    startup: 'required',
    requires: ['projectTerminals', '@machines'],
    create: (dependencies) => new ProjectExecution(dependencies.vm(), dependencies.get('projectTerminals').preparation),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 60,
  });

  const usbHotplug = await plugins.system.start({
    id: 'usbHotplug',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new UsbHotplug(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 220,
  });
  const mediaDevices = await plugins.system.start({
    id: 'mediaDevices',
    startup: 'required',
    requires: ['usbHotplug', '@machines', '@plugins'],
    create: (dependencies) => new MediaDevices(
        dependencies.vm(),
        dependencies.get('usbHotplug'),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 230,
  });

  const memoryReclaim = await plugins.system.startDegradable({
    id: 'memoryReclaim',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'memory-reclaim.json'),
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new MemoryReclaim(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 240,
  });
  const hostMounts = await plugins.system.start({
    id: 'hostMounts',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new HostMounts(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 250,
  });

  const virtioFsShares = await plugins.system.start({
    id: 'virtioFsShares',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new VirtioFsShares(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 260,
  });

  const trustedBoot = await plugins.system.start({
    id: 'trustedBoot',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new TrustedBootService(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 270,
  });

  const gpuProfiles = await plugins.system.startDegradable({
    id: 'gpuProfiles',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'gpu-profiles.json'),
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new GpuProfiles(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 280,
  });
  const buildFarm = await plugins.system.startDegradable({
    id: 'buildFarm',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'build-farm.json'),
    requires: ['projectTerminals', '@machines', '@plugins'],
    create: (dependencies) => new BuildFarm(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        undefined,
        dependencies.get('projectTerminals'),
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 290,
  });
  const projectPermissions = await plugins.system.start({
    id: 'projectPermissions',
    startup: 'required',
    requires: ['access', '@machines', '@plugins'],
    create: (dependencies) => new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 90,
  });
  const policyBundles = await plugins.system.start({
    id: 'policyBundles',
    startup: 'required',
    requires: ['projectPermissions'],
    create: (dependencies) => new PolicyBundles(dependencies.get('projectPermissions')),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 100,
  });
  const changeApprovals = features.workspaces
    ? await plugins.system.start({
        id: 'changeApprovals',
        startup: 'required',
        requires: ['projectPermissions', '@plugins'],
        create: (dependencies) => new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces),
        initialize: (value) => value.init(),
        dispose: () => {},
        disposePhase: ClosePhase.services,
      })
    : undefined;

  const processInterop = await plugins.system.start({
    id: 'processInterop',
    startup: 'required',
    requires: ['session', '@machines', '@plugins'],
    create: (dependencies) => new ProcessInterop(dependencies.vm(), PORT, () => {
        dependencies.get('session').requireUnlocked();
        if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      }),
    initialize: () => {},
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });

  const hostPeers: HostPeersV1 = await plugins.system.start({
    id: 'hostPeers',
    startup: 'required',
    requires: ['rollouts', 'session', '@machines', '@plugins'],
    lateRequires: ['mobileCompanion', 'liveMigrationReceiver'],
    create: (dependencies) => new HostPeers(
        async () => {
          const vms = await dependencies.get('@machines').list();
          return {
            platform: platform(),
            arch: arch(),
            cpus: Math.max(1, cpus().length),
            memoryTotal: totalmem(),
            memoryFree: freemem(),
            load: loadavg().map((value) => Math.max(0, value)),
            vmCount: vms.length,
            runningVms: vms.filter((vm) => vm.status === 'running').length,
          };
        },
        undefined,
        hostname().slice(0, 128),
        () => !acceptingRequests || !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        undefined,
        (): HostPeerDependencies => ({
          mobileHandler: (request, response) => { requireAdmission(); return dependencies.late('mobileCompanion').handle(request, response); },
          rolloutReceiver: {
            view: () => { requireAdmission(); return { hostId: dependencies.self().view().hostId, policies: dependencies.get('rollouts').view().policies }; },
            save: (input) => { requireAdmission(); return dependencies.get('rollouts').configure(input); },
          },
          liveMigrationReceiver: {
            prepare: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').prepare(input); },
            complete: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').complete(input); },
            abort: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').abort(input); },
            status: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').verifiedStatus(input); },
          },
          importReceiver: createHostImportReceiver(dependencies.vm(), {
            bundles: () => dependencies.get('@plugins').bundles,
            requireSessionUnlocked: () => dependencies.get('session').requireUnlocked(),
            migrationBlocked: () => !!dependencies.get('@plugins').migration?.blocked,
          }),
        }),
        () => acceptingRequests,
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 320,
  });
  const migrationCompletion = createLiveMigrationCompletionPort(machines, () => hostPeers);
  resources.defer('live-migration-completion-port', registerLiveMigrationCompletionPort(machines, migrationCompletion),
    ClosePhase.services);
  resources.defer('live-migration-target-port', registerLiveMigrationTargetPort(machines, {
    bindSession: (id, receipt) => machines.bindIncomingSession(id, receipt),
    recover: (id, sessionId) => machines.recoverIncoming(id, sessionId),
    authenticated: isAuthenticatedMigrationCompletion,
  }), ClosePhase.services);
  const mobileCompanion = await plugins.system.start({
    id: 'mobileCompanion',
    startup: 'required',
    requires: ['access', 'session', '@machines', '@plugins'],
    create: (dependencies) => new MobileCompanion(
        dependencies.get('access'),
        async () => {
          const vms = await dependencies.get('@machines').list();
          return {
            vms: vms.map(({ id, name, status }) => ({ id, name, status })),
            alerts: (await dependencies.get('@plugins').suite?.alertEvents()) || [],
          };
        },
        () => {
          dependencies.get('session').requireUnlocked();
          if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        },
        undefined,
        undefined,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 130,
  });
  const liveMigrationReceiver = await plugins.system.start({
    id: 'liveMigrationReceiver',
    startup: 'required',
    requires: ['hostPeers', 'session', '@machines', '@plugins'],
    create: (dependencies) => new LiveMigrationReceiver(dependencies.vm(), dependencies.get('hostPeers'), () => {
        dependencies.get('session').requireUnlocked();
        if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        if (!dependencies.get('@plugins').next) throw new AppError('请先启用扩展功能插件', 503);
      }),
    initialize: () => {},
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  const fleetRollouts = await plugins.system.start({
    id: 'fleetRollouts',
    startup: 'required',
    requires: ['hostPeers', '@plugins'],
    create: (dependencies) => new FleetPolicyRollouts(
        dependencies.get('hostPeers'),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 210,
  });

  await plugins.system.start({
    id: 'capabilityChecks',
    startup: 'required',
    requires: ['access', 'session', 'remoteAudit', 'hostPeers', 'mobileCompanion', 'projectTerminals', '@machines', '@plugins'],
    create: (dependencies) => ({
        mutation: (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        acmeAllowed: () => !dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked,
        mobileCheck: () => ({
          ready:
            dependencies.get('access').enabled &&
            dependencies.get('hostPeers').view().listener.active &&
            dependencies.get('hostPeers').view().listener.host === '0.0.0.0',
          devices: dependencies.get('access').enabled
            ? dependencies.get('mobileCompanion').view(dependencies.get('access').users().find((item) => item.role === 'owner')!.id).devices.length
            : 0,
          reason: !dependencies.get('access').enabled
            ? '请先启用账户模式。'
            : !dependencies.get('hostPeers').view().listener.active || dependencies.get('hostPeers').view().listener.host !== '0.0.0.0'
              ? '请启用局域网 HTTPS 同伴入口并重启服务。'
              : undefined,
        }),
        scoreHosts: (input) => dependencies.get('hostPeers').score(input),
        sharedDesktopCheck: async (id) => {
          if (!dependencies.get('access').enabled) return { ready: false, reason: '请先启用账户模式。' };
          if (!dependencies.get('@plugins').socketEnabled('desktop'))
            return { ready: false, reason: '请先启用桌面插件并重启 Sakura。' };
          try {
            const desktop = await dependencies.get('@plugins').desktops.view(id, true);
            return desktop.status === 'ready'
              ? { ready: true }
              : { ready: false, reason: '实例桌面尚未就绪。' };
          } catch (error) {
            return { ready: false, reason: (error as Error).message };
          }
        },
        passkeyCheck: () => ({
          ready: dependencies.get('access').enabled,
          registered: dependencies.get('access').users().reduce((count, user) => count + dependencies.get('access').passkeysFor(user.id).length, 0),
          ...(!dependencies.get('access').enabled ? { reason: '请先启用账户模式。' } : {}),
        }),
        accountModeReady: () => dependencies.get('access').enabled,
        remoteAuditCheck: async () => {
          const status = await dependencies.get('remoteAudit').status();
          return {
            ready: Boolean(
              status.target &&
              status.last &&
              status.local.valid &&
              status.protected &&
              status.lastVerifiedAt &&
              Date.now() - Date.parse(status.lastVerifiedAt) < 2 * 3_600_000 &&
              !status.lastError,
            ),
            configured: Boolean(status.target),
            anchoredSequence: status.last?.sequence || 0,
            reason: !status.target
              ? '请在系统设置中配置启用对象锁的远程审计桶。'
              : status.lastError || (!status.last ? '配置后请同步首个审计锚点。' : undefined),
          };
        },
        sharedTerminalCheck: async (id) => {
          if (!dependencies.get('access').enabled) return { ready: false, reason: '请先启用账户模式。' };
          if (!dependencies.get('@plugins').socketEnabled('terminal-session'))
            return { ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' };
          if (dependencies.get('@machines').state(id) !== 'running') return { ready: false, reason: '请先启动实例。' };
          try {
            const result = await dependencies.get('@machines').exec(id, 'command -v tmux >/dev/null', 10000);
            return result.code === 0 ? { ready: true } : { ready: false, reason: '请先在客户机安装 tmux。' };
          } catch (error) {
            return { ready: false, reason: (error as Error).message };
          }
        },
      }) satisfies import('./host-service-contracts.ts').HostServiceContracts['capabilityChecks'],
    initialize: () => {},
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  let coldMigrations: ColdMigrationsV1 | undefined;
  let snapshotReplications: SnapshotReplicationsV1 | undefined;
  let haLocalFailovers: HaLocalFailoversV1 | undefined;
  let haHostFailover: HaHostFailoverV1 | undefined;
  let notebooks: NotebookEnvironmentsV1 | undefined;
  let browserIde: BrowserIdeV1 | undefined;
  if (features.next) {
    notebooks = await plugins.system.start({
      id: 'notebookEnvironments',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      create: (dependencies) => new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 370,
    });

    browserIde = await plugins.system.start({
      id: 'browserIde',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      create: (dependencies) => new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 360,
    });
  }
  if (features.next && features.bundles) {
    coldMigrations = await plugins.system.start({
      id: 'coldMigrations',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      create: (dependencies) => new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers')),
      initialize: (value) => value.init(),
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });

    snapshotReplications = await plugins.system.start({
      id: 'snapshotReplications',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      create: (dependencies) => new SnapshotReplications(
          dependencies.vm(),
          dependencies.get('@plugins').bundles,
          dependencies.get('hostPeers'),
        ),
      initialize: (value) => value.init(),
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });

    const witnessClient = await HaWitnessClient.fromEnv().catch((error) => {
      console.error('HA 见证配置不可用：', (error as Error).message);
      return null;
    });
    haHostFailover = await plugins.system.start({
      id: 'haHostFailover',
      startup: 'required',
      requires: ['hostPeers', 'snapshotReplications', '@machines', '@plugins'],
      create: (dependencies) => new HaHostFailover(
          dependencies.vm(),
          dependencies.get('hostPeers'),
          dependencies.get('snapshotReplications')!,
          () => dependencies.get('@plugins').next!.haPolicies(),
          witnessClient,
        ),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 310,
    });

    haLocalFailovers = await plugins.system.start({
      id: 'haLocalFailovers',
      startup: 'required',
      requires: ['haHostFailover', 'snapshotReplications', 'hostPeers', '@machines', '@plugins'],
      create: (dependencies) => new HaLocalFailovers(
          dependencies.vm(),
          dependencies.get('@plugins').next.haFailureMonitor,
          dependencies.get('hostPeers'),
          dependencies.get('snapshotReplications')!,
          () => dependencies.get('@plugins').next!.haPolicies(),
          () => !dependencies.get('@plugins').migration?.blocked && !dependencies.get('@machines').closing,
          { disarmWitness: (id, failureThreshold) => dependencies.get('haHostFailover')!.disarm(id, failureThreshold) },
        ),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 300,
    });
  }
  if (features.next && features.backups && features.bundles)
    await plugins.system.start({
      id: 'disasterRecovery',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      create: (dependencies) => new DisasterRecoveryDrill(
          dependencies.vm(),
          dependencies.get('@plugins').backups,
          dependencies.get('@plugins').bundles,
        ),
      initialize: () => {},
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });
  const native = await plugins.system.startDegradable({
    id: 'native',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-integration.json'),
    requires: ['session', '@machines', '@plugins'],
    create: (dependencies) => new NativeIntegration(
        () => nativeMappings(dependencies.get('@plugins')),
        undefined,
        undefined,
        undefined,
        undefined,
        (id?: string) => {
          dependencies.get('session').requireUnlocked();
          if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          if (id) {
            dependencies.get('@machines').get(id);
            dependencies.get('@machines').requireUnlocked(id);
          }
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 160,
  });
  const nativeClipboard = await plugins.system.startDegradable({
    id: 'nativeClipboard',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-clipboard.json') + '，并确认原生剪贴板组件可用',
    requires: ['session', '@plugins'],
    create: (dependencies) => new NativeClipboard({
        guard: () => dependencies.get('session').requireUnlocked(),
        maintenance: () => !!dependencies.get('@plugins').migration?.blocked,
        mutation: (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      }),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 170,
  });
  const assistant = await plugins.system.startDegradable({
    id: 'assistant',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'local-assistant.json'),
    requires: [],
    create: (dependencies) => new LocalAssistant(),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 150,
  });
  const communityPlugins = await plugins.system.start({
    id: 'communityPlugins',
    startup: 'required',
    requires: ['@machines', '@plugins', '@pluginDirectory'],
    create: (dependencies) => new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), {
        events: async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        blocked: () => !!dependencies.get('@plugins').migration?.blocked,
        mutation: (delta) => dependencies.get('@plugins').operations.change(delta),
      }),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 140,
  });
  const webhooks = await plugins.system.startDegradable({
    id: 'webhooks',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'webhooks.json'),
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new Webhooks(
        async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        undefined,
        undefined,
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 180,
  });
  const automationRules = await plugins.system.startDegradable({
    id: 'automationRules',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'automation-rules.json'),
    requires: ['@plugins', '@machines'],
    create: (dependencies) => new AutomationRules(
        async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        dependencies.vm(),
        undefined,
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        async (id, steps, projectId, signal) => {
          const owned = dependencies.get('@plugins').workspaces
            ? undefined
            : new Workspaces(dependencies.vm());
          const workspaces = dependencies.get('@plugins').workspaces || owned!;
          try {
            return await workspaces.projects.with(id, projectId, () =>
              runEngineeringOperation(
                dependencies.vm(),
                workspaces,
                id,
                'runbooks',
                { steps },
                signal,
              ),
            );
          } finally {
            await owned?.close();
          }
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 190,
  });
  const retention = await plugins.system.startDegradable({
    id: 'retention',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'log-retention.json'),
    requires: ['@machines', '@plugins'],
    create: (dependencies) => new LogRetention(
        () => dependencies.get('@plugins').jobStores(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        undefined,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 330,
  });
  const graph = await plugins.system.startDegradable({
    id: 'graph',
    startup: 'degradable',
    startupRecovery: '检查 GraphQL 服务的启动诊断及依赖服务',
    requires: ['@plugins', '@machines'],
    create: (dependencies) => new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.get('@plugins').enabled)),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 340,
  });

  for (const source of domainRecoverySources({
    vmIds: () => [...machines.records.keys()],
    backups: () => features.enabled.has('backups') ? features.backups : undefined,
    coldMigrations: () => plugins.system.has('coldMigrations') ? coldMigrations : undefined,
    sync: () => features.enabled.has('sync') ? features.sync : undefined,
  })) recoveries.register(source);
  recoveries.register(haPromotionRecoverySource(() => [...machines.records.values()]));
  recoveries.register(liveMigrationRecoverySource({
    records: () => [...machines.records.values()],
    peers: () => plugins.system.has('hostPeers') ? hostPeers : undefined,
    confirm: (id, fence) => migrationCompletion.confirm(id, fence),
    canConfirm: (id, fence) => migrationCompletion.canConfirm(id, fence),
    confirmed: (id, fence) => migrationCompletion.confirmed(id, fence),
  }));
  await recoveries.refresh();

  const recoveryApi: RecoveryCatalogV1 = recoveries;
  return {
    access,
    assistant,
    audit,
    automationRules,
    browserExtensions,
    buildFarm,
    changeApprovals,
    coldMigrations,
    dev,
    features,
    fleetRollouts,
    gpuProfiles,
    graph,
    hostMounts,
    hostPeers,
    jitPrivileges,
    machines,
    mediaDevices,
    memoryReclaim,
    mobileCompanion,
    native,
    nativeClipboard,
    passkeys,
    policyBundles,
    processInterop,
    projectPermissions,
    projectTerminals,
    remoteAudit,
    retention,
    rollouts,
    selectedPlugins,
    session,
    snapshotReplications,
    sso,
    terminalSharing,
    trustedBoot,
    virtioFsShares,
    webhooks,
    engine,
    plugins,
    requireService<K extends keyof SystemServiceContracts>(id: K): SystemServiceContracts[K] {
      return plugins.system.require(id);
    },
    connectionHooks,
    diagnostics,
    recoveries: recoveryApi,
    acceptRequests() {
      plugins.assertReady();
      acceptingRequests = true;
    },
    usbHotplug,
    projectExecution,
    get token() {
      return token;
    },
    set token(value: string) {
      token = value;
    },
    onSessionChange(listener: typeof sessionChanged) {
      sessionChanged = listener;
    },
  };
}

export type ApplicationServices = Awaited<ReturnType<typeof createApplicationServices>>;

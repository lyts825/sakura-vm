import type { BrowserIdeV1, ColdMigrationsV1, HaHostFailoverV1, HaLocalFailoversV1, HostPeersV1, NotebookEnvironmentsV1, ResourceScopeV1, SnapshotReplicationsV1 } from './service-contracts/v1.ts';
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
import { HostPeers, type HostPeerDependencies } from './host-peers.ts';
import { createLiveMigrationCompletionPort } from './live-migration-proof.ts';
import { registerLiveMigrationCompletionPort } from './live-migration-runner.ts';
import { JitPrivileges } from './jit-privileges.ts';
import { Jobs } from './jobs.ts';
import { LiveMigrationReceiver } from './live-migration-receiver.ts';
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
  const connectionHooks = { terminate: () => {} };
  let token = randomBytes(32).toString('hex');
  let sessionChanged = (_locked: boolean, _transitioned: boolean) => {};
  let features: Features;
  const session = await plugins.system.start({
    id: 'session',
    requires: [],
    create: () => new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned)),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 10,
  });
  const access = await plugins.system.start({
    id: 'access',
    requires: [],
    create: () => new AccessControl(),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 20,
  });
  const passkeys = await plugins.system.start({
    id: 'passkeys',
    requires: ['access'],
    create: () => new Passkeys(access, PORT),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 40,
  });
  const sso = await plugins.system.start({
    id: 'sso',
    requires: ['access'],
    create: () =>
      new SingleSignOn(access, PORT, undefined, undefined, undefined, undefined, () => {
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
  plugins.system.ready('@machines');
  resources.defer(
    'plugin-directory-events',
    plugins.directory.subscribe(() => machines.emit('change')),
    1,
  );
  const terminalSharing = await plugins.system.start({
    id: 'terminalSharing',
    requires: ['@machines'],
    lateRequires: ['projectTerminals'],
    disposeRequires: ['projectTerminals'],
    create: () =>
      new TerminalSharing(
        plugins.system.vm('terminalSharing', machines),
        undefined,
        undefined,
        () => { requireAdmission(); return projectTerminals; },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 50,
  });
  const jitPrivileges = await plugins.system.start({
    id: 'jitPrivileges',
    requires: ['access', '@machines'],
    create: () => new JitPrivileges(access, plugins.system.vm('jitPrivileges', machines)),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 80,
  });
  const browserExtensions = await plugins.system.start({
    id: 'browserExtensions',
    requires: ['access'],
    create: () => new BrowserExtensions(access),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 120,
  });
  const audit = resources.own('audit', hostAudit(), ClosePhase.audit);
  plugins.system.ready('@audit');
  const remoteAudit = await plugins.system.start({
    id: 'remoteAudit',
    requires: ['@audit', 'session'],
    lateRequires: ['@plugins'],
    create: () =>
      new RemoteAuditLock(
        audit,
        undefined,
        undefined,
        undefined,
        undefined,
        () => acceptingRequests && !features?.migration?.blocked && !session.view().locked,
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
    requires: [],
    lateRequires: ['@plugins'],
    disposeRequires: ['@plugins'],
    create: () =>
      new FeatureRollouts(
        undefined,
        () => !acceptingRequests || !!features?.migration?.blocked,
        (delta) => {
          if (features) features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 200,
  });
  features = await plugins.start(machines, (id) => rollouts.decision(id).allowed);
  resources.defer('features', () => features.close(), ClosePhase.plugins,
    ['machines', 'audit', 'network', 'compute', 'scheduler']);
  plugins.system.ready('@plugins');
  const projectTerminals = await plugins.system.start({
    id: 'projectTerminals',
    requires: ['@plugins'],
    create: () => features.terminalHandle(),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 70,
  });
  const projectExecution = await plugins.system.start({
    id: 'projectExecution',
    requires: ['projectTerminals', '@machines'],
    create: () =>
      new ProjectExecution(plugins.system.vm('projectExecution', machines), projectTerminals.preparation),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 60,
  });

  const usbHotplug = await plugins.system.start({
    id: 'usbHotplug',
    requires: ['@machines', '@plugins'],
    create: () =>
      new UsbHotplug(
        plugins.system.vm('usbHotplug', machines),
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 220,
  });
  const mediaDevices = await plugins.system.start({
    id: 'mediaDevices',
    requires: ['usbHotplug', '@machines', '@plugins'],
    create: () =>
      new MediaDevices(
        plugins.system.vm('mediaDevices', machines),
        usbHotplug,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: () => {},
    dispose: (value) => value?.close(),
    disposePhase: 230,
  });

  const memoryReclaim = await plugins.system.start({
    id: 'memoryReclaim',
    requires: ['@machines', '@plugins'],
    create: () =>
      new MemoryReclaim(
        plugins.system.vm('memoryReclaim', machines),
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 240,
  });
  const hostMounts = await plugins.system.start({
    id: 'hostMounts',
    requires: ['@machines', '@plugins'],
    create: () =>
      new HostMounts(
        plugins.system.vm('hostMounts', machines),
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 250,
  });

  const virtioFsShares = await plugins.system.start({
    id: 'virtioFsShares',
    requires: ['@machines', '@plugins'],
    create: () =>
      new VirtioFsShares(
        plugins.system.vm('virtioFsShares', machines),
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 260,
  });

  const trustedBoot = await plugins.system.start({
    id: 'trustedBoot',
    requires: ['@machines', '@plugins'],
    create: () =>
      new TrustedBootService(
        plugins.system.vm('trustedBoot', machines),
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 270,
  });

  const gpuProfiles = await plugins.system.start({
    id: 'gpuProfiles',
    requires: ['@machines', '@plugins'],
    create: () =>
      new GpuProfiles(
        plugins.system.vm('gpuProfiles', machines),
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 280,
  });
  const buildFarm = await plugins.system.start({
    id: 'buildFarm',
    requires: ['projectTerminals', '@machines', '@plugins'],
    create: () =>
      new BuildFarm(
        plugins.system.vm('buildFarm', machines),
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
        undefined,
        projectTerminals,
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 290,
  });
  const projectPermissions = await plugins.system.start({
    id: 'projectPermissions',
    requires: ['access', '@machines', '@plugins'],
    create: () =>
      new ProjectPermissions(access, plugins.system.vm('projectPermissions', machines), features.workspaces),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 90,
  });
  const policyBundles = await plugins.system.start({
    id: 'policyBundles',
    requires: ['projectPermissions'],
    create: () => new PolicyBundles(projectPermissions),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 100,
  });
  const changeApprovals = features.workspaces
    ? await plugins.system.start({
        id: 'changeApprovals',
        requires: ['projectPermissions', '@plugins'],
        create: () => new ChangeApprovals(projectPermissions, features.workspaces),
        initialize: (value) => value.init(),
        dispose: () => {},
        disposePhase: ClosePhase.services,
      })
    : undefined;

  const processInterop = await plugins.system.start({
    id: 'processInterop',
    requires: ['session', '@machines', '@plugins'],
    create: () =>
      new ProcessInterop(plugins.system.vm('processInterop', machines), PORT, () => {
        session.requireUnlocked();
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      }),
    initialize: () => {},
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });

  const hostPeers: HostPeersV1 = await plugins.system.start({
    id: 'hostPeers',
    requires: ['rollouts', 'session', '@machines', '@plugins'],
    lateRequires: ['mobileCompanion', 'liveMigrationReceiver'],
    create: () =>
      new HostPeers(
        async () => {
          const vms = await machines.list();
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
        () => !acceptingRequests || !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
        undefined,
        (): HostPeerDependencies => ({
          mobileHandler: (request, response) => { requireAdmission(); return mobileCompanion.handle(request, response); },
          rolloutReceiver: {
            view: () => { requireAdmission(); return { hostId: hostPeers.view().hostId, policies: rollouts.view().policies }; },
            save: (input) => { requireAdmission(); return rollouts.configure(input); },
          },
          liveMigrationReceiver: {
            prepare: (input) => { requireAdmission(); return liveMigrationReceiver.prepare(input); },
            complete: (input) => { requireAdmission(); return liveMigrationReceiver.complete(input); },
            abort: (input) => { requireAdmission(); return liveMigrationReceiver.abort(input); },
            status: (input) => { requireAdmission(); return liveMigrationReceiver.verifiedStatus(input); },
          },
          importReceiver: createHostImportReceiver(plugins.system.vm('hostPeers', machines), {
            bundles: () => features.bundles,
            requireSessionUnlocked: () => session.requireUnlocked(),
            migrationBlocked: () => !!features.migration?.blocked,
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
  const mobileCompanion = await plugins.system.start({
    id: 'mobileCompanion',
    requires: ['access', 'session', '@machines', '@plugins'],
    create: () =>
      new MobileCompanion(
        access,
        async () => {
          const vms = await machines.list();
          return {
            vms: vms.map(({ id, name, status }) => ({ id, name, status })),
            alerts: (await features.suite?.alertEvents()) || [],
          };
        },
        () => {
          session.requireUnlocked();
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        },
        undefined,
        undefined,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 130,
  });
  const liveMigrationReceiver = await plugins.system.start({
    id: 'liveMigrationReceiver',
    requires: ['hostPeers', 'session', '@machines', '@plugins'],
    create: () =>
      new LiveMigrationReceiver(plugins.system.vm('liveMigrationReceiver', machines), hostPeers, () => {
        session.requireUnlocked();
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        if (!features.next) throw new AppError('请先启用扩展功能插件', 503);
      }),
    initialize: () => {},
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  const fleetRollouts = await plugins.system.start({
    id: 'fleetRollouts',
    requires: ['hostPeers', '@plugins'],
    create: () =>
      new FleetPolicyRollouts(
        hostPeers,
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 210,
  });

  await plugins.system.start({
    id: 'capabilityChecks',
    requires: ['access', 'session', 'remoteAudit', 'hostPeers', 'mobileCompanion', 'projectTerminals', '@machines', '@plugins'],
    create: () =>
      ({
        mutation: (delta) => {
          features.operations.change(delta);
        },
        acmeAllowed: () => !session.view().locked && !features.migration?.blocked,
        mobileCheck: () => ({
          ready:
            access.enabled &&
            hostPeers.view().listener.active &&
            hostPeers.view().listener.host === '0.0.0.0',
          devices: access.enabled
            ? mobileCompanion.view(access.users().find((item) => item.role === 'owner')!.id).devices.length
            : 0,
          reason: !access.enabled
            ? '请先启用账户模式。'
            : !hostPeers.view().listener.active || hostPeers.view().listener.host !== '0.0.0.0'
              ? '请启用局域网 HTTPS 同伴入口并重启服务。'
              : undefined,
        }),
        scoreHosts: (input) => hostPeers.score(input),
        sharedDesktopCheck: async (id) => {
          if (!access.enabled) return { ready: false, reason: '请先启用账户模式。' };
          if (!features.socketEnabled('desktop'))
            return { ready: false, reason: '请先启用桌面插件并重启 Sakura。' };
          try {
            const desktop = await features.desktops.view(id, true);
            return desktop.status === 'ready'
              ? { ready: true }
              : { ready: false, reason: '实例桌面尚未就绪。' };
          } catch (error) {
            return { ready: false, reason: (error as Error).message };
          }
        },
        passkeyCheck: () => ({
          ready: access.enabled,
          registered: access.users().reduce((count, user) => count + access.passkeysFor(user.id).length, 0),
          ...(!access.enabled ? { reason: '请先启用账户模式。' } : {}),
        }),
        accountModeReady: () => access.enabled,
        remoteAuditCheck: async () => {
          const status = await remoteAudit.status();
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
          if (!access.enabled) return { ready: false, reason: '请先启用账户模式。' };
          if (!features.socketEnabled('terminal-session'))
            return { ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' };
          if (machines.state(id) !== 'running') return { ready: false, reason: '请先启动实例。' };
          try {
            const result = await machines.exec(id, 'command -v tmux >/dev/null', 10000);
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
      requires: ['@plugins', '@machines'],
      create: () =>
        new NotebookEnvironments(plugins.system.vm('notebookEnvironments', machines), features.workspaces),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 370,
    });

    browserIde = await plugins.system.start({
      id: 'browserIde',
      requires: ['@plugins', '@machines'],
      create: () => new BrowserIde(plugins.system.vm('browserIde', machines), features.workspaces),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 360,
    });
  }
  if (features.next && features.bundles) {
    coldMigrations = await plugins.system.start({
      id: 'coldMigrations',
      requires: ['hostPeers', '@machines', '@plugins'],
      create: () =>
        new ColdMigrations(plugins.system.vm('coldMigrations', machines), features.bundles, hostPeers),
      initialize: (value) => value.init(),
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });

    snapshotReplications = await plugins.system.start({
      id: 'snapshotReplications',
      requires: ['hostPeers', '@machines', '@plugins'],
      create: () =>
        new SnapshotReplications(
          plugins.system.vm('snapshotReplications', machines),
          features.bundles,
          hostPeers,
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
      requires: ['hostPeers', 'snapshotReplications', '@machines', '@plugins'],
      create: () =>
        new HaHostFailover(
          plugins.system.vm('haHostFailover', machines),
          hostPeers,
          snapshotReplications!,
          () => features.next!.haPolicies(),
          witnessClient,
        ),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 310,
    });

    haLocalFailovers = await plugins.system.start({
      id: 'haLocalFailovers',
      requires: ['haHostFailover', 'snapshotReplications', 'hostPeers', '@machines', '@plugins'],
      create: () =>
        new HaLocalFailovers(
          plugins.system.vm('haLocalFailovers', machines),
          features.next.haFailureMonitor,
          hostPeers,
          snapshotReplications!,
          () => features.next!.haPolicies(),
          () => !features.migration?.blocked && !machines.closing,
          { disarmWitness: (id, failureThreshold) => haHostFailover!.disarm(id, failureThreshold) },
        ),
      initialize: (value) => value.init(),
      dispose: (value) => value?.close(),
      disposePhase: 300,
    });
  }
  if (features.next && features.backups && features.bundles)
    await plugins.system.start({
      id: 'disasterRecovery',
      requires: ['@plugins', '@machines'],
      create: () =>
        new DisasterRecoveryDrill(
          plugins.system.vm('disasterRecovery', machines),
          features.backups,
          features.bundles,
        ),
      initialize: () => {},
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });
  const native = await plugins.system.start({
    id: 'native',
    requires: ['session', '@machines', '@plugins'],
    create: () =>
      new NativeIntegration(
        () => nativeMappings(features),
        undefined,
        undefined,
        undefined,
        undefined,
        (id?: string) => {
          session.requireUnlocked();
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          if (id) {
            machines.get(id);
            machines.requireUnlocked(id);
          }
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 160,
  });
  const nativeClipboard = await plugins.system.start({
    id: 'nativeClipboard',
    requires: ['session', '@plugins'],
    create: () =>
      new NativeClipboard({
        guard: () => session.requireUnlocked(),
        maintenance: () => !!features.migration?.blocked,
        mutation: (delta) => {
          features.operations.change(delta);
        },
      }),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 170,
  });
  const assistant = await plugins.system.start({
    id: 'assistant',
    requires: [],
    create: () => new LocalAssistant(),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 150,
  });
  const eventSource = async () =>
    collectWebhookEvents(
      machines,
      features.jobStores().flatMap((store) => store.list()),
      (await features.suite?.alertEvents()) || [],
    );
  const communityPlugins = await plugins.system.start({
    id: 'communityPlugins',
    requires: ['@machines', '@plugins'],
    create: () =>
      new CommunityPlugins(undefined, undefined, undefined, undefined, plugins.directory, {
        events: eventSource,
        blocked: () => !!features.migration?.blocked,
        mutation: (delta) => features.operations.change(delta),
      }),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 140,
  });
  const webhooks = await plugins.system.start({
    id: 'webhooks',
    requires: ['@machines', '@plugins'],
    create: () =>
      new Webhooks(
        eventSource,
        undefined,
        undefined,
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 180,
  });
  const automationRules = await plugins.system.start({
    id: 'automationRules',
    requires: ['@plugins', '@machines'],
    create: () =>
      new AutomationRules(
        eventSource,
        plugins.system.vm('automationRules', machines),
        undefined,
        undefined,
        () => !!features.migration?.blocked,
        (delta) => {
          features.operations.change(delta);
        },
        async (id, steps, projectId, signal) => {
          const owned = features.workspaces
            ? undefined
            : new Workspaces(plugins.system.vm('automationRules', machines));
          const workspaces = features.workspaces || owned!;
          try {
            return await workspaces.projects.with(id, projectId, () =>
              runEngineeringOperation(
                plugins.system.vm('automationRules', machines),
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
  const retention = await plugins.system.start({
    id: 'retention',
    requires: ['@machines', '@plugins'],
    create: () =>
      new LogRetention(
        () => features.jobStores(),
        undefined,
        () => !!features.migration?.blocked,
        undefined,
        (delta) => {
          features.operations.change(delta);
        },
      ),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: 330,
  });
  const graph = await plugins.system.start({
    id: 'graph',
    requires: ['@plugins', '@machines'],
    create: () => new GraphApi(async () => querySnapshot(machines, features.jobStores(), features.enabled)),
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
    connectionHooks,
    diagnostics,
    recoveries,
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

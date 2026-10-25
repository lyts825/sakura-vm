import { mediaExecutionProfile } from './suite-media-profile.ts';
/**
 * 模块职责：创建并连接应用领域服务及恢复来源；服务就绪和关闭由共同生命周期约束。
 * Module purpose: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
import { TrustedUpdates } from './trusted-updates.ts';
import { LogRetention } from './log-retention.ts';
import { Machines } from './machines.ts';
import { MediaDevices } from './media-devices.ts';
import { MemoryReclaim } from './memory-reclaim.ts';
import { MobileCompanion } from './mobile-companion.ts';
import { NativeClipboard } from './native-clipboard.ts';
import { NativeIntegration, nativeMappings } from './native-integration.ts';
import { NotebookEnvironments } from './notebook-environments.ts';
import { ImageAssets } from './image-assets.ts';
import { EgressRules } from './egress-rules.ts';
import { DataNotebookSessions } from './data-notebook-sessions.ts';
import { PreparedWorkerSessions } from './prepared-worker-sessions.ts';
import { SuiteExecutionSessions } from './suite-execution-sessions.ts';
import { browserExecutionProfile, databaseExecutionProfile, eventExecutionProfile, learningExecutionProfile } from './suite-execution-profiles.ts';
import { suiteCapacity } from './suite-capacity.ts';
import { EvaluationCalls } from './evaluation-calls.ts';
import { MetadataStore } from './metadata-store.ts';
import { DelegatedActions } from './delegated-actions.ts';
import { preparedWorkerMetadata } from './core-worker-metadata.ts';
import { createCoreDrillService } from './core-drill-service.ts';
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

/**
 * 入口 / Entry: createApplicationServices.
 * 功能：按依赖装配系统和插件领域服务，注册恢复来源并返回 HTTP/WebSocket 共用的服务集合。
 * Purpose: Assembles system/plugin domains in dependency order, registers recovery sources and returns shared HTTP/WebSocket services.
 * 设计：资源先登记后异步初始化；延迟依赖在就绪阶段验证，恢复目录读取原领域证据，失败清理由统一作用域保留。
 * Design: Resources are registered before asynchronous initialization; late dependencies are verified at readiness, recovery reads domain evidence, and the shared scope retains failed cleanup.
 * 输入 / Inputs: resources: ResourceScopeV1; plugins: PluginManager
 * 输出 / Returns: `{ access, assistant, audit, automationRules, browserExtensions, buildFarm, changeApprovals, coldMigrations, dev, features, fl…`.
 * 副作用 / Effects: `resources.defer`; `recoveries.register`; `plugins.system.start`; `createRuntime`; `releaseRuntimeOwnership`; 更新 / updates `Jobs.instrument`, `features`, `notebooks`, `browserIde`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function createApplicationServices(resources: ResourceScopeV1, plugins: PluginManager) {
  let acceptingRequests = false;
  /**
   * 入口 / Entry: createApplicationServices.requireAdmission.
   * 功能：在创建并连接应用领域服务及恢复来源中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`application-services.ts`）。
   * Purpose: Checks admission, input or resource ownership in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!acceptingRequests`; 异常 / errors `new AppError('服务尚未就绪或正在关闭', 503, 'SERVICE_NOT_READY')`.
   */
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
  /**
   * 入口 / Entry: createApplicationServices.refreshRecoveries.
   * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`application-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `void` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
   * 处理：通过 `withoutOperationContext().catch().finally`, `withoutOperationContext().catch`, `withoutOperationContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `withoutOperationContext().catch().finally`, `withoutOperationContext().catch`, `withoutOperationContext`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `refreshPending`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `refreshRequested`, `refreshPending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  const connectionHooks = {
  /**
   * 入口 / Entry: createApplicationServices.terminate.
   * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  terminate: () => {} };
  let token = randomBytes(32).toString('hex');
  /**
   * 入口 / Entry: createApplicationServices.sessionChanged.
   * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
   * 输入 / Inputs: _locked: boolean; _transitioned: boolean
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  let sessionChanged = (_locked: boolean, _transitioned: boolean) => {};
  let features: Features;
  const session = await plugins.system.start({
    id: 'session',
    startup: 'required',
    requires: [],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))`，供调用方后续验证或使用。
     * Purpose: Computes `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned)),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 10,
  });
  const access = await plugins.system.start({
    id: 'access',
    startup: 'required',
    requires: [],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new AccessControl()`，供调用方后续验证或使用。
     * Purpose: Computes `new AccessControl()` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new AccessControl()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new AccessControl(),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 20,
  });
  const passkeys = await plugins.system.start({
    id: 'passkeys',
    startup: 'required',
    requires: ['access'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new Passkeys(dependencies.get('access'), PORT)`，供调用方后续验证或使用。
     * Purpose: Computes `new Passkeys(dependencies.get('access'), PORT)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new Passkeys(dependencies.get('access'), PORT)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new Passkeys(dependencies.get('access'), PORT),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 40,
  });
  const sso = await plugins.system.start({
    id: 'sso',
    startup: 'required',
    requires: ['access'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new SingleSignOn(dependencies.get('access'), PORT, undefined, undefined, undefined, undefined, () => { connectionHooks.termin…`，供调用方后续验证或使用。
     * Purpose: Computes `new SingleSignOn(dependencies.get('access'), PORT, undefined, undefined, undefined, undefined, () => { connectionHooks.termin…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new SingleSignOn(dependencies.get('access'), PORT, undefined, undefined, undefined, undefined, () => { connectionHooks.termin…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new SingleSignOn(dependencies.get('access'), PORT, undefined, undefined, undefined, undefined, () => {
        connectionHooks.terminate();
      }),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
  await plugins.system.start({
    id: 'imageAssets',
    startup: 'required',
    requires: ['@machines'],
    create: (dependencies) => new ImageAssets(dependencies.vm()),
    initialize: (value) => value.init(),
    dispose: (value) => value?.close(),
    disposePhase: ClosePhase.services,
  });
  resources.defer(
    'plugin-directory-events',
    plugins.directory.subscribe(() => machines.emit('change')),
    1,
  );
  await plugins.system.start({
    id: 'egressRules', startup: 'required', requires: ['@machines'],
    create: dependencies => new EgressRules(dependencies.vm()),
    initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
  });
  const terminalSharing = await plugins.system.startDegradable({
    id: 'terminalSharing',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'terminal-sharing.json'),
    requires: ['@machines'],
    lateRequires: ['projectTerminals'],
    disposeRequires: ['projectTerminals'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new TerminalSharing( dependencies.vm(), undefined, undefined, () => { requireAdmission(); return dependencies.late('projectTe…`，供调用方后续验证或使用。
     * Purpose: Computes `new TerminalSharing( dependencies.vm(), undefined, undefined, () => { requireAdmission(); return dependencies.late('projectTe…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new TerminalSharing( dependencies.vm(), undefined, undefined, () => { requireAdmission(); return dependencies.late('projectTe…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new TerminalSharing(
        dependencies.vm(),
        undefined,
        undefined,
        () => { requireAdmission(); return dependencies.late('projectTerminals'); },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 50,
  });
  const jitPrivileges = await plugins.system.start({
    id: 'jitPrivileges',
    startup: 'required',
    requires: ['access', '@machines'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new JitPrivileges(dependencies.get('access'), dependencies.vm())` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new JitPrivileges(dependencies.get('access'), dependencies.vm())` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.get`, `dependencies.vm` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.vm`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new JitPrivileges(dependencies.get('access'), dependencies.vm())`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new JitPrivileges(dependencies.get('access'), dependencies.vm()),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 80,
  });
  const browserExtensions = await plugins.system.startDegradable({
    id: 'browserExtensions',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'browser-extensions.json'),
    requires: ['access'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new BrowserExtensions(dependencies.get('access'))`，供调用方后续验证或使用。
     * Purpose: Computes `new BrowserExtensions(dependencies.get('access'))` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new BrowserExtensions(dependencies.get('access'))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new BrowserExtensions(dependencies.get('access')),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new RemoteAuditLock( dependencies.get('@audit'), undefined, undefined, undefined, undefined, () => acceptingRequests && !depe…`，供调用方后续验证或使用。
     * Purpose: Computes `new RemoteAuditLock( dependencies.get('@audit'), undefined, undefined, undefined, undefined, () => acceptingRequests && !depe…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new RemoteAuditLock( dependencies.get('@audit'), undefined, undefined, undefined, undefined, () => acceptingRequests && !depe…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new RemoteAuditLock(
        dependencies.get('@audit'),
        undefined,
        undefined,
        undefined,
        undefined,
        () => acceptingRequests && !dependencies.late('@plugins')?.migration?.blocked && !dependencies.get('session').view().locked,
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 350,
  });
  /**
   * 入口 / Entry: createApplicationServices.Jobs.instrument.
   * 功能：把本层请求转交 `audit.span`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `audit.span` and propagates the provider result or rejection.
   * 输入 / Inputs: job; work
   * 输出 / Returns: `audit.span( { kind: 'job', name: (job.scope || 'task') + ':' + (job.action || 'run'), vmId: job.vmId, projectId: job.projectI…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new FeatureRollouts( undefined, () => !acceptingRequests || !!dependencies.late('@plugins')?.migration?.blocked, (delta) => {…`，供调用方后续验证或使用。
     * Purpose: Computes `new FeatureRollouts( undefined, () => !acceptingRequests || !!dependencies.late('@plugins')?.migration?.blocked, (delta) => {…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new FeatureRollouts( undefined, () => !acceptingRequests || !!dependencies.late('@plugins')?.migration?.blocked, (delta) => {…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new FeatureRollouts(
        undefined,
        () => !acceptingRequests || !!dependencies.late('@plugins')?.migration?.blocked,
        (delta) => {
          if (dependencies.late('@plugins')) dependencies.late('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 200,
  });
  if (selectedPlugins.includes('incident-actions') || selectedPlugins.includes('flow-connectors')) {
    await plugins.system.start({
      id: 'delegatedActions', startup: 'required', requires: ['@delegatedProviders'],
      create: dependencies => new DelegatedActions(dependencies.get('@delegatedProviders')),
      initialize: () => {}, dispose: () => {}, disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('browser-runners')) {
    await plugins.system.start({
      id: 'browserSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => new SuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), browserExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('database-fixtures')) {
    await plugins.system.start({
      id: 'databaseRehearsal', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => new SuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), databaseExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('media-workers') || selectedPlugins.includes('media-inspect')) {
    await plugins.system.start({
      id: 'mediaTasks', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: (dependencies) => new SuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), mediaExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('learning-sessions')) {
    await plugins.system.start({
      id: 'learningToolSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: (dependencies) => new SuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), learningExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('event-brokers')) {
    await plugins.system.start({
      id: 'eventSessions', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'],
      create: dependencies => new SuiteExecutionSessions(dependencies.vm(), dependencies.get('imageAssets'),
        dependencies.get('@pluginDirectory'), suiteCapacity(), eventExecutionProfile, dependencies.executionCleanup()),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.some(id => ['evaluation-endpoints', 'evaluation-runners', 'evaluation-scorers'].includes(id))) {
    await plugins.system.start({
      id: 'evaluationCalls', startup: 'required', requires: [],
      create: () => {
        const ledger = new MetadataStore<unknown>(join(DATA, 'evaluation-calls', 'receipts.json'), {fallback: () => []});
        return new EvaluationCalls({name: 'receipts', read: signal => ledger.read(signal), replace: (value, options) => ledger.replace(value, options)});
      },
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('integration-runners')) {
    await plugins.system.start({
      id: 'preparedWorkerSessions', startup: 'required', requires: ['@machines'], lateRequires: ['@plugins'],
      create: dependencies => new PreparedWorkerSessions(dependencies.vm(), () => {
        const workspaces = dependencies.late('@plugins').workspaces;
        if (!workspaces) throw new AppError('固定工具会话需要项目插件', 503, 'PROJECTS_UNAVAILABLE');
        return workspaces;
      }, preparedWorkerMetadata),
      initialize: value => value.init(), dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  if (selectedPlugins.includes('resilience-fixtures')) {
    await plugins.system.start({
      id: 'drillSupervision', startup: 'required', requires: ['@machines', '@pluginDirectory', 'imageAssets'], lateRequires: ['@plugins'],
      create: dependencies => createCoreDrillService(dependencies.vm(), () => {
        const workspaces = dependencies.late('@plugins').workspaces;
        if (!workspaces) throw new AppError('演练监管需要项目插件', 503, 'PROJECTS_UNAVAILABLE');
        return workspaces;
      }, dependencies.get('@pluginDirectory')),
      initialize: () => {}, dispose: value => value?.close(), disposePhase: ClosePhase.services,
    });
  }
  features = await plugins.start(machines, (id) => rollouts.decision(id).allowed);
  resources.defer('features', () => features.close(), ClosePhase.plugins,
    ['machines', 'audit', 'network', 'compute', 'scheduler']);
  plugins.system.ready('@plugins', features);
  const projectTerminals = await plugins.system.start({
    id: 'projectTerminals',
    startup: 'required',
    requires: ['@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('@plugins').terminalHandle()` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.get('@plugins').terminalHandle()` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.get().terminalHandle`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.get().terminalHandle`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `dependencies.get('@plugins').terminalHandle()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => dependencies.get('@plugins').terminalHandle(),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 70,
  });
  const projectExecution = await plugins.system.start({
    id: 'projectExecution',
    startup: 'required',
    requires: ['projectTerminals', '@machines'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ProjectExecution(dependencies.vm(), dependencies.get('projectTerminals').preparation)` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new ProjectExecution(dependencies.vm(), dependencies.get('projectTerminals').preparation)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new ProjectExecution(dependencies.vm(), dependencies.get('projectTerminals').preparation)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new ProjectExecution(dependencies.vm(), dependencies.get('projectTerminals').preparation),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 60,
  });

  const usbHotplug = await plugins.system.start({
    id: 'usbHotplug',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…`，供调用方后续验证或使用。
     * Purpose: Computes `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new UsbHotplug( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenc…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new UsbHotplug(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 220,
  });
  const mediaDevices = await plugins.system.start({
    id: 'mediaDevices',
    startup: 'required',
    requires: ['usbHotplug', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new MediaDevices( dependencies.vm(), dependencies.get('usbHotplug'), () => !!dependencies.get('@plugins').migration?.blocked,…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new MediaDevices(
        dependencies.vm(),
        dependencies.get('usbHotplug'),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 230,
  });

  const memoryReclaim = await plugins.system.startDegradable({
    id: 'memoryReclaim',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'memory-reclaim.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…`，供调用方后续验证或使用。
     * Purpose: Computes `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new MemoryReclaim( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { depend…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new MemoryReclaim(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 240,
  });
  const hostMounts = await plugins.system.start({
    id: 'hostMounts',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…`，供调用方后续验证或使用。
     * Purpose: Computes `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new HostMounts( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get('@p…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new HostMounts(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 250,
  });

  const virtioFsShares = await plugins.system.start({
    id: 'virtioFsShares',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…`，供调用方后续验证或使用。
     * Purpose: Computes `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new VirtioFsShares( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies.get…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new VirtioFsShares(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 260,
  });

  const trustedBoot = await plugins.system.start({
    id: 'trustedBoot',
    startup: 'required',
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…`，供调用方后续验证或使用。
     * Purpose: Computes `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new TrustedBootService( dependencies.vm(), () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependencies…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new TrustedBootService(
        dependencies.vm(),
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 270,
  });

  const gpuProfiles = await plugins.system.startDegradable({
    id: 'gpuProfiles',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'gpu-profiles.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…`，供调用方后续验证或使用。
     * Purpose: Computes `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new GpuProfiles( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependen…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new GpuProfiles(
        dependencies.vm(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 280,
  });
  const buildFarm = await plugins.system.startDegradable({
    id: 'buildFarm',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'build-farm.json'),
    requires: ['projectTerminals', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new BuildFarm( dependencies.vm(), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (delta) => { dependenci…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 290,
  });
  const projectPermissions = await plugins.system.start({
    id: 'projectPermissions',
    startup: 'required',
    requires: ['access', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.get`, `dependencies.vm` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.vm`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 90,
  });
  const policyBundles = await plugins.system.start({
    id: 'policyBundles',
    startup: 'required',
    requires: ['projectPermissions'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new PolicyBundles(dependencies.get('projectPermissions'))`，供调用方后续验证或使用。
     * Purpose: Computes `new PolicyBundles(dependencies.get('projectPermissions'))` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new PolicyBundles(dependencies.get('projectPermissions'))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new PolicyBundles(dependencies.get('projectPermissions')),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 100,
  });
  const changeApprovals = features.workspaces
    ? await plugins.system.start({
        id: 'changeApprovals',
        startup: 'required',
        requires: ['projectPermissions', '@plugins'],
        /**
         * 入口 / Entry: createApplicationServices.create.
         * 功能：从当前输入或状态计算 `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)`，供调用方后续验证或使用。
         * Purpose: Computes `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: dependencies
         * 输出 / Returns: `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        create: (dependencies) => new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces),
        /**
         * 入口 / Entry: createApplicationServices.initialize.
         * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
         * 输入 / Inputs: value
         * 输出 / Returns: `value.init()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        initialize: (value) => value.init(),
        /**
         * 入口 / Entry: createApplicationServices.dispose.
         * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        dispose: () => {},
        disposePhase: ClosePhase.services,
      })
    : undefined;

  const processInterop = await plugins.system.start({
    id: 'processInterop',
    startup: 'required',
    requires: ['session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new ProcessInterop(dependencies.vm(), PORT, () => { dependencies.get('session').requireUnlocked(); if (dependencies.get('@plu…`，供调用方后续验证或使用。
     * Purpose: Computes `new ProcessInterop(dependencies.vm(), PORT, () => { dependencies.get('session').requireUnlocked(); if (dependencies.get('@plu…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new ProcessInterop(dependencies.vm(), PORT, () => { dependencies.get('session').requireUnlocked(); if (dependencies.get('@plu…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new ProcessInterop(dependencies.vm(), PORT, () => {
        dependencies.get('session').requireUnlocked();
        if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      }),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });

  /**
   * 入口 / Entry: createApplicationServices.callback@471.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（plugins.system.start）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (plugins.system.start).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ platform: platform(), arch: arch(), cpus: Math.max(1, cpus().length), memoryTotal: totalmem(), memoryFree: freemem(), load:…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const hostPeers: HostPeersV1 = await plugins.system.start({
    id: 'hostPeers',
    startup: 'required',
    requires: ['rollouts', 'session', '@machines', '@plugins'],
    lateRequires: ['mobileCompanion', 'liveMigrationReceiver'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new HostPeers( async () => { const vms = await dependencies.get('@machines').list(); return { platform: platform(), arch: arc…` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new HostPeers( async () => { const vms = await dependencies.get('@machines').list(); return { platform: platform(), arch: arc…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `hostname().slice`, `hostname` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `hostname().slice`, `hostname`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new HostPeers( async () => { const vms = await dependencies.get('@machines').list(); return { platform: platform(), arch: arc…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new HostPeers(
        /**
         * 中文功能：读取当前实例列表并组合宿主平台、CPU、内存、负载与运行实例数量，作为 peer 状态快照。
         * English: Reads the current VM list and combines host platform, CPU, memory, load and running-instance counts into a peer-status snapshot.
         * 所属 / Owner: createApplicationServices.hostPeers.create.
         * 输入 / Inputs: 无显式参数 / no explicit parameters.
         */
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
          /**
           * 入口 / Entry: createApplicationServices.mobileHandler.
           * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.late('mobileCompanion').handle(request, response)` 供上层消费（`application-services.ts`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.late('mobileCompanion').handle(request, response)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
           * 处理：通过 `requireAdmission`, `dependencies.late().handle`, `dependencies.late` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.late().handle`, `dependencies.late`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: request; response
           * 输出 / Returns: `dependencies.late('mobileCompanion').handle(request, response)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          mobileHandler: (request, response) => { requireAdmission(); return dependencies.late('mobileCompanion').handle(request, response); },
          rolloutReceiver: {
            /**
             * 入口 / Entry: createApplicationServices.view.
             * 功能：在创建并连接应用领域服务及恢复来源中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ hostId: dependencies.self().view().hostId, policies: dependencies.get('rollouts').view().policies }` 供上层消费（`application-services.ts`）。
             * Purpose: Reads/verifies domain state and constructs a caller-facing result in `application-services.ts`; this entry produces `{ hostId: dependencies.self().view().hostId, policies: dependencies.get('rollouts').view().policies }` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.self().view`, `dependencies.self`, `dependencies.get().view` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.self().view`, `dependencies.self`, `dependencies.get().view`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `{ hostId: dependencies.self().view().hostId, policies: dependencies.get('rollouts').view().policies }`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            view: () => { requireAdmission(); return { hostId: dependencies.self().view().hostId, policies: dependencies.get('rollouts').view().policies }; },
            /**
             * 入口 / Entry: createApplicationServices.save.
             * 功能：在创建并连接应用领域服务及恢复来源中，校验并提交领域状态变更；本入口产生 `dependencies.get('rollouts').configure(input)` 供上层消费（`application-services.ts`）。
             * Purpose: Validates and commits a domain state change in `application-services.ts`; this entry produces `dependencies.get('rollouts').configure(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.get().configure`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.get().configure`, `dependencies.get`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: input
             * 输出 / Returns: `dependencies.get('rollouts').configure(input)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            save: (input) => { requireAdmission(); return dependencies.get('rollouts').configure(input); },
          },
          liveMigrationReceiver: {
            /**
             * 入口 / Entry: createApplicationServices.prepare.
             * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.late('liveMigrationReceiver').prepare(input)` 供上层消费（`application-services.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.late('liveMigrationReceiver').prepare(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.late().prepare`, `dependencies.late` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.late().prepare`, `dependencies.late`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: input
             * 输出 / Returns: `dependencies.late('liveMigrationReceiver').prepare(input)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            prepare: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').prepare(input); },
            /**
             * 入口 / Entry: createApplicationServices.complete.
             * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.late('liveMigrationReceiver').complete(input)` 供上层消费（`application-services.ts`）。
             * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.late('liveMigrationReceiver').complete(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.late().complete`, `dependencies.late` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.late().complete`, `dependencies.late`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: input
             * 输出 / Returns: `dependencies.late('liveMigrationReceiver').complete(input)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            complete: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').complete(input); },
            /**
             * 入口 / Entry: createApplicationServices.abort.
             * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；本入口产生 `dependencies.late('liveMigrationReceiver').abort(input)` 供上层消费（`application-services.ts`）。
             * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; this entry produces `dependencies.late('liveMigrationReceiver').abort(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.late().abort`, `dependencies.late` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.late().abort`, `dependencies.late`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: input
             * 输出 / Returns: `dependencies.late('liveMigrationReceiver').abort(input)`.
             * 副作用 / Effects: `dependencies.late().abort`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            abort: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').abort(input); },
            /**
             * 入口 / Entry: createApplicationServices.status.
             * 功能：在创建并连接应用领域服务及恢复来源中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `dependencies.late('liveMigrationReceiver').verifiedStatus(input)` 供上层消费（`application-services.ts`）。
             * Purpose: Reads/verifies domain state and constructs a caller-facing result in `application-services.ts`; this entry produces `dependencies.late('liveMigrationReceiver').verifiedStatus(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `requireAdmission`, `dependencies.late().verifiedStatus`, `dependencies.late` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `requireAdmission`, `dependencies.late().verifiedStatus`, `dependencies.late`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: input
             * 输出 / Returns: `dependencies.late('liveMigrationReceiver').verifiedStatus(input)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            status: (input) => { requireAdmission(); return dependencies.late('liveMigrationReceiver').verifiedStatus(input); },
          },
          importReceiver: createHostImportReceiver(dependencies.vm(), {
            /**
             * 入口 / Entry: createApplicationServices.bundles.
             * 功能：从当前输入或状态计算 `dependencies.get('@plugins').bundles`，供调用方后续验证或使用。
             * Purpose: Computes `dependencies.get('@plugins').bundles` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `dependencies.get('@plugins').bundles`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            bundles: () => dependencies.get('@plugins').bundles,
            /**
             * 入口 / Entry: createApplicationServices.requireSessionUnlocked.
             * 功能：在创建并连接应用领域服务及恢复来源中，核对调用资格、输入或资源归属；本入口产生 `dependencies.get('session').requireUnlocked()` 供上层消费（`application-services.ts`）。
             * Purpose: Checks admission, input or resource ownership in `application-services.ts`; this entry produces `dependencies.get('session').requireUnlocked()` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
             * 处理：通过 `dependencies.get().requireUnlocked`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
             * Processing: Coordinates its dependencies through `dependencies.get().requireUnlocked`, `dependencies.get`; the branches below determine continuation, return or refusal.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `dependencies.get('session').requireUnlocked()`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            requireSessionUnlocked: () => dependencies.get('session').requireUnlocked(),
            /**
             * 入口 / Entry: createApplicationServices.migrationBlocked.
             * 功能：从当前输入或状态计算 `!!dependencies.get('@plugins').migration?.blocked`，供调用方后续验证或使用。
             * Purpose: Computes `!!dependencies.get('@plugins').migration?.blocked` from current inputs/state for the caller to validate or consume.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `!!dependencies.get('@plugins').migration?.blocked`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            migrationBlocked: () => !!dependencies.get('@plugins').migration?.blocked,
          }),
        }),
        () => acceptingRequests,
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 320,
  });
  const migrationCompletion = createLiveMigrationCompletionPort(machines, () => hostPeers);
  resources.defer('live-migration-completion-port', registerLiveMigrationCompletionPort(machines, migrationCompletion),
    ClosePhase.services);
  resources.defer('live-migration-target-port', registerLiveMigrationTargetPort(machines, {
    /**
     * 入口 / Entry: createApplicationServices.bindSession.
     * 功能：把本层请求转交 `machines.bindIncomingSession`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `machines.bindIncomingSession` and propagates the provider result or rejection.
     * 输入 / Inputs: id; receipt
     * 输出 / Returns: `machines.bindIncomingSession(id, receipt)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    bindSession: (id, receipt) => machines.bindIncomingSession(id, receipt),
    /**
     * 入口 / Entry: createApplicationServices.recover.
     * 功能：把本层请求转交 `machines.recoverIncoming`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `machines.recoverIncoming` and propagates the provider result or rejection.
     * 输入 / Inputs: id; sessionId
     * 输出 / Returns: `machines.recoverIncoming(id, sessionId)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    recover: (id, sessionId) => machines.recoverIncoming(id, sessionId),
    authenticated: isAuthenticatedMigrationCompletion,
  }), ClosePhase.services);
  const mobileCompanion = await plugins.system.start({
    id: 'mobileCompanion',
    startup: 'required',
    requires: ['access', 'session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new MobileCompanion( dependencies.get('access'), async () => { const vms = await dependencies.get('@machines').list(); return…`，供调用方后续验证或使用。
     * Purpose: Computes `new MobileCompanion( dependencies.get('access'), async () => { const vms = await dependencies.get('@machines').list(); return…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new MobileCompanion( dependencies.get('access'), async () => { const vms = await dependencies.get('@machines').list(); return…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 130,
  });
  const liveMigrationReceiver = await plugins.system.start({
    id: 'liveMigrationReceiver',
    startup: 'required',
    requires: ['hostPeers', 'session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new LiveMigrationReceiver(dependencies.vm(), dependencies.get('hostPeers'), () => { dependencies.get('session').requireUnlock…` 供上层消费（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new LiveMigrationReceiver(dependencies.vm(), dependencies.get('hostPeers'), () => { dependencies.get('session').requireUnlock…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new LiveMigrationReceiver(dependencies.vm(), dependencies.get('hostPeers'), () => { dependencies.get('session').requireUnlock…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new LiveMigrationReceiver(dependencies.vm(), dependencies.get('hostPeers'), () => {
        dependencies.get('session').requireUnlocked();
        if (dependencies.get('@plugins').migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        if (!dependencies.get('@plugins').next) throw new AppError('请先启用扩展功能插件', 503);
      }),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  const fleetRollouts = await plugins.system.start({
    id: 'fleetRollouts',
    startup: 'required',
    requires: ['hostPeers', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new FleetPolicyRollouts( dependencies.get('hostPeers'), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (…`，供调用方后续验证或使用。
     * Purpose: Computes `new FleetPolicyRollouts( dependencies.get('hostPeers'), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new FleetPolicyRollouts( dependencies.get('hostPeers'), undefined, () => !!dependencies.get('@plugins').migration?.blocked, (…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new FleetPolicyRollouts(
        dependencies.get('hostPeers'),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 210,
  });

  await plugins.system.start({
    id: 'capabilityChecks',
    startup: 'required',
    requires: ['access', 'session', 'remoteAudit', 'hostPeers', 'mobileCompanion', 'projectTerminals', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…`，供调用方后续验证或使用。
     * Purpose: Computes `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => ({
        /**
         * 入口 / Entry: createApplicationServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().operations.change`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().operations.change`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: delta
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        mutation: (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        /**
         * 入口 / Entry: createApplicationServices.acmeAllowed.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().view`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().view`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        acmeAllowed: () => !dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: createApplicationServices.mobileCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ ready: dependencies.get('access').enabled && dependencies.get('hostPeers').view().listener.active && dependencies.get('hos…` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `({ ready: dependencies.get('access').enabled && dependencies.get('hostPeers').view().listener.active && dependencies.get('hos…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get`, `dependencies.get().view`, `dependencies.get().users().find`, `dependencies.get().users` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.get().view`, `dependencies.get().users().find`, `dependencies.get().users`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `({ ready: dependencies.get('access').enabled && dependencies.get('hostPeers').view().listener.active && dependencies.get('hos…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
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
        /**
         * 入口 / Entry: createApplicationServices.scoreHosts.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('hostPeers').score(input)` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.get('hostPeers').score(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().score`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().score`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: input
         * 输出 / Returns: `dependencies.get('hostPeers').score(input)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        scoreHosts: (input) => dependencies.get('hostPeers').score(input),
        /**
         * 入口 / Entry: createApplicationServices.sharedDesktopCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用桌面插件并重启 Sakura。' }` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用桌面插件并重启 Sakura。' }` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get`, `dependencies.get().socketEnabled`, `dependencies.get().desktops.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.get().socketEnabled`, `dependencies.get().desktops.view`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!dependencies.get('access').enabled`; `!dependencies.get('@plugins').socketEnabled('desktop')`.
         * 输入 / Inputs: id
         * 输出 / Returns: `{ ready: false, reason: '请先启用账户模式。' }`; `{ ready: false, reason: '请先启用桌面插件并重启 Sakura。' }`; `desktop.status === 'ready' ? { ready: true } : { ready: false, reason: '实例桌面尚未就绪。' }`；另有分支返回 / additional branch-specific returns.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `return { ready: false, reason: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `return { ready: false, reason: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
         */
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
        /**
         * 入口 / Entry: createApplicationServices.passkeyCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ ready: dependencies.get('access').enabled, registered: dependencies.get('access').users().reduce((count, user) => count + …` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `({ ready: dependencies.get('access').enabled, registered: dependencies.get('access').users().reduce((count, user) => count + …` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get`, `dependencies.get().users().reduce`, `dependencies.get().users` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.get().users().reduce`, `dependencies.get().users`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `({ ready: dependencies.get('access').enabled, registered: dependencies.get('access').users().reduce((count, user) => count + …`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        passkeyCheck: () => ({
          ready: dependencies.get('access').enabled,
          registered: dependencies.get('access').users().reduce((count, user) => count + dependencies.get('access').passkeysFor(user.id).length, 0),
          ...(!dependencies.get('access').enabled ? { reason: '请先启用账户模式。' } : {}),
        }),
        /**
         * 入口 / Entry: createApplicationServices.accountModeReady.
         * 功能：从当前输入或状态计算 `dependencies.get('access').enabled`，供调用方后续验证或使用。
         * Purpose: Computes `dependencies.get('access').enabled` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `dependencies.get('access').enabled`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        accountModeReady: () => dependencies.get('access').enabled,
        /**
         * 入口 / Entry: createApplicationServices.remoteAuditCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: Boolean( status.target && status.last && status.local.valid && status.protected && status.lastVerifiedAt && Date.now…` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `{ ready: Boolean( status.target && status.last && status.local.valid && status.protected && status.lastVerifiedAt && Date.now…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().status`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().status`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `{ ready: Boolean( status.target && status.last && status.local.valid && status.protected && status.lastVerifiedAt && Date.now…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
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
        /**
         * 入口 / Entry: createApplicationServices.sharedTerminalCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' }` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' }` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get`, `dependencies.get().socketEnabled`, `dependencies.get().state`, `dependencies.get().exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.get().socketEnabled`, `dependencies.get().state`, `dependencies.get().exec`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `!dependencies.get('access').enabled`; `!dependencies.get('@plugins').socketEnabled('terminal-session')`; `dependencies.get('@machines').state(id) !== 'running'`.
         * 输入 / Inputs: id
         * 输出 / Returns: `{ ready: false, reason: '请先启用账户模式。' }`; `{ ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' }`; `{ ready: false, reason: '请先启动实例。' }`；另有分支返回 / additional branch-specific returns.
         * 副作用 / Effects: `dependencies.get().exec`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         * 失败处理：catch 分支执行 `return { ready: false, reason: (error as Error).message };`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `return { ready: false, reason: (error as Error).message };`; these statements determine whether a failure is absorbed or rejected again.
         */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  let coldMigrations: ColdMigrationsV1 | undefined;
  let snapshotReplications: SnapshotReplicationsV1 | undefined;
  let haLocalFailovers: HaLocalFailoversV1 | undefined;
  let haHostFailover: HaHostFailoverV1 | undefined;
  let notebooks: NotebookEnvironmentsV1 | undefined;
  let browserIde: BrowserIdeV1 | undefined;
  if (features.workspaces) {
    notebooks = await plugins.system.start({
      id: 'notebookEnvironments',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value?.close()`.
       * 副作用 / Effects: `value.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      dispose: (value) => value?.close(),
      disposePhase: 370,
    });

    await plugins.system.start({
      id: 'notebookEnvironmentsV2', startup: 'required', requires: ['@machines', '@plugins', 'notebookEnvironments', 'imageAssets'],
      create: dependencies => new DataNotebookSessions(() => dependencies.get('notebookEnvironments'), dependencies.vm(), dependencies.get('@plugins').workspaces, dependencies.get('imageAssets')),
      initialize: () => {}, dispose: () => {}, disposePhase: 369,
    });
  }
  if (features.next) {
    browserIde = await plugins.system.start({
      id: 'browserIde',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value?.close()`.
       * 副作用 / Effects: `value.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      dispose: (value) => value?.close(),
      disposePhase: 360,
    });
  }
  if (features.next && features.bundles) {
    coldMigrations = await plugins.system.start({
      id: 'coldMigrations',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers')),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });

    snapshotReplications = await plugins.system.start({
      id: 'snapshotReplications',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new SnapshotReplications( dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'), )` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new SnapshotReplications( dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'), )` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new SnapshotReplications( dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'), )`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new SnapshotReplications(
          dependencies.vm(),
          dependencies.get('@plugins').bundles,
          dependencies.get('hostPeers'),
        ),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
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
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new HaHostFailover( dependencies.vm(), dependencies.get('hostPeers'), dependencies.get('snapshotReplications')!, () => depend…` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new HaHostFailover( dependencies.vm(), dependencies.get('hostPeers'), dependencies.get('snapshotReplications')!, () => depend…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new HaHostFailover( dependencies.vm(), dependencies.get('hostPeers'), dependencies.get('snapshotReplications')!, () => depend…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new HaHostFailover(
          dependencies.vm(),
          dependencies.get('hostPeers'),
          dependencies.get('snapshotReplications')!,
          () => dependencies.get('@plugins').next!.haPolicies(),
          witnessClient,
        ),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value?.close()`.
       * 副作用 / Effects: `value.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      dispose: (value) => value?.close(),
      disposePhase: 310,
    });

    haLocalFailovers = await plugins.system.start({
      id: 'haLocalFailovers',
      startup: 'required',
      requires: ['haHostFailover', 'snapshotReplications', 'hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new HaLocalFailovers( dependencies.vm(), dependencies.get('@plugins').next.haFailureMonitor, dependencies.get('hostPeers'), d…` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new HaLocalFailovers( dependencies.vm(), dependencies.get('@plugins').next.haFailureMonitor, dependencies.get('hostPeers'), d…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new HaLocalFailovers( dependencies.vm(), dependencies.get('@plugins').next.haFailureMonitor, dependencies.get('hostPeers'), d…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new HaLocalFailovers(
          dependencies.vm(),
          dependencies.get('@plugins').next.haFailureMonitor,
          dependencies.get('hostPeers'),
          dependencies.get('snapshotReplications')!,
          () => dependencies.get('@plugins').next!.haPolicies(),
          () => !dependencies.get('@plugins').migration?.blocked && !dependencies.get('@machines').closing,
          {
          /**
           * 入口 / Entry: createApplicationServices.disarmWitness.
           * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('haHostFailover')!.disarm(id, failureThreshold)` 供上层消费（`application-services.ts`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.get('haHostFailover')!.disarm(id, failureThreshold)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
           * 处理：通过 `inline.disarm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `inline.disarm`, `dependencies.get`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: id; failureThreshold
           * 输出 / Returns: `dependencies.get('haHostFailover')!.disarm(id, failureThreshold)`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          disarmWitness: (id, failureThreshold) => dependencies.get('haHostFailover')!.disarm(id, failureThreshold) },
        ),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value?.close()`.
       * 副作用 / Effects: `value.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      dispose: (value) => value?.close(),
      disposePhase: 300,
    });
  }
  if (features.next && features.backups && features.bundles)
    await plugins.system.start({
      id: 'disasterRecovery',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: createApplicationServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new DisasterRecoveryDrill( dependencies.vm(), dependencies.get('@plugins').backups, dependencies.get('@plugins').bundles, )` 供上层消费（`application-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `new DisasterRecoveryDrill( dependencies.vm(), dependencies.get('@plugins').backups, dependencies.get('@plugins').bundles, )` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new DisasterRecoveryDrill( dependencies.vm(), dependencies.get('@plugins').backups, dependencies.get('@plugins').bundles, )`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new DisasterRecoveryDrill(
          dependencies.vm(),
          dependencies.get('@plugins').backups,
          dependencies.get('@plugins').bundles,
        ),
      /**
       * 入口 / Entry: createApplicationServices.initialize.
       * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
       * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      initialize: () => {},
      /**
       * 入口 / Entry: createApplicationServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`application-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });
  const native = await plugins.system.startDegradable({
    id: 'native',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-integration.json'),
    requires: ['session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new NativeIntegration( () => nativeMappings(dependencies.get('@plugins')), undefined, undefined, undefined, undefined, (id?: …`，供调用方后续验证或使用。
     * Purpose: Computes `new NativeIntegration( () => nativeMappings(dependencies.get('@plugins')), undefined, undefined, undefined, undefined, (id?: …` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new NativeIntegration( () => nativeMappings(dependencies.get('@plugins')), undefined, undefined, undefined, undefined, (id?: …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 160,
  });
  const nativeClipboard = await plugins.system.startDegradable({
    id: 'nativeClipboard',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-clipboard.json') + '，并确认原生剪贴板组件可用',
    requires: ['session', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…`，供调用方后续验证或使用。
     * Purpose: Computes `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new NativeClipboard({
        /**
         * 入口 / Entry: createApplicationServices.guard.
         * 功能：在创建并连接应用领域服务及恢复来源中，核对调用资格、输入或资源归属；本入口产生 `dependencies.get('session').requireUnlocked()` 供上层消费（`application-services.ts`）。
         * Purpose: Checks admission, input or resource ownership in `application-services.ts`; this entry produces `dependencies.get('session').requireUnlocked()` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().requireUnlocked`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().requireUnlocked`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `dependencies.get('session').requireUnlocked()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        guard: () => dependencies.get('session').requireUnlocked(),
        /**
         * 入口 / Entry: createApplicationServices.maintenance.
         * 功能：从当前输入或状态计算 `!!dependencies.get('@plugins').migration?.blocked`，供调用方后续验证或使用。
         * Purpose: Computes `!!dependencies.get('@plugins').migration?.blocked` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!!dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        maintenance: () => !!dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: createApplicationServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().operations.change`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().operations.change`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: delta
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        mutation: (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      }),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 170,
  });
  const assistant = await plugins.system.startDegradable({
    id: 'assistant',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'local-assistant.json'),
    requires: [],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new LocalAssistant()`，供调用方后续验证或使用。
     * Purpose: Computes `new LocalAssistant()` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new LocalAssistant()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new LocalAssistant(),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 150,
  });
  const trustedUpdates = await plugins.system.startDegradable({
    id: 'trustedUpdates', startup: 'degradable',
    startupRecovery: '检查原安装目录中的更新信任策略与版本状态',
    requires: [],
    create: () => new TrustedUpdates(),
    initialize: value => value.init(),
    dispose: value => value?.close(),
    disposePhase: 155,
  });
  const communityPlugins = await plugins.system.start({
    id: 'communityPlugins',
    startup: 'required',
    requires: ['@machines', '@plugins', '@pluginDirectory'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …`，供调用方后续验证或使用。
     * Purpose: Computes `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), {
        /**
         * 入口 / Entry: createApplicationServices.events.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `collectWebhookEvents`, `dependencies.get`, `dependencies.get().jobStores().flatMap`, `dependencies.get().jobStores` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `collectWebhookEvents`, `dependencies.get`, `dependencies.get().jobStores().flatMap`, `dependencies.get().jobStores`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        events: async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        /**
         * 入口 / Entry: createApplicationServices.blocked.
         * 功能：从当前输入或状态计算 `!!dependencies.get('@plugins').migration?.blocked`，供调用方后续验证或使用。
         * Purpose: Computes `!!dependencies.get('@plugins').migration?.blocked` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!!dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        blocked: () => !!dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: createApplicationServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('@plugins').operations.change(delta)` 供上层消费（`application-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; this entry produces `dependencies.get('@plugins').operations.change(delta)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().operations.change`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().operations.change`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: delta
         * 输出 / Returns: `dependencies.get('@plugins').operations.change(delta)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        mutation: (delta) => dependencies.get('@plugins').operations.change(delta),
      }),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 140,
  });
  const webhooks = await plugins.system.startDegradable({
    id: 'webhooks',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'webhooks.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new Webhooks( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMa…`，供调用方后续验证或使用。
     * Purpose: Computes `new Webhooks( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMa…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new Webhooks( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMa…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 180,
  });
  /**
   * 入口 / Entry: createApplicationServices.callback@859.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（plugins.system.startDegradable）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (plugins.system.startDegradable).
   * 输入 / Inputs: id; steps; projectId; signal
   * 输出 / Returns: `await workspaces.projects.with(id, projectId, () => runEngineeringOperation( dependencies.vm(), workspaces, id, 'runbooks', {…`.
   * 副作用 / Effects: `owned.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `await owned?.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await owned?.close();`; these steps also apply to exceptional exits.
   */
  const automationRules = await plugins.system.startDegradable({
    id: 'automationRules',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'automation-rules.json'),
    requires: ['@plugins', '@machines'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new AutomationRules( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores()…`，供调用方后续验证或使用。
     * Purpose: Computes `new AutomationRules( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores()…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new AutomationRules( async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores()…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new AutomationRules(
        async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        dependencies.vm(),
        undefined,
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
        /**
         * 中文功能：在指定项目范围执行 runbook；优先复用插件工作区，临时创建的工作区在 finally 关闭。
         * English: Runs a runbook in the specified project scope, reusing plugin workspaces or closing a temporary workspace in finally.
         * 所属 / Owner: createApplicationServices.automationRules.create.
         * 输入 / Inputs: id; steps; projectId; signal.
         */
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
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 190,
  });
  const retention = await plugins.system.startDegradable({
    id: 'retention',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'log-retention.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new LogRetention( () => dependencies.get('@plugins').jobStores(), undefined, () => !!dependencies.get('@plugins').migration?.…`，供调用方后续验证或使用。
     * Purpose: Computes `new LogRetention( () => dependencies.get('@plugins').jobStores(), undefined, () => !!dependencies.get('@plugins').migration?.…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new LogRetention( () => dependencies.get('@plugins').jobStores(), undefined, () => !!dependencies.get('@plugins').migration?.…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new LogRetention(
        () => dependencies.get('@plugins').jobStores(),
        undefined,
        () => !!dependencies.get('@plugins').migration?.blocked,
        undefined,
        (delta) => {
          dependencies.get('@plugins').operations.change(delta);
        },
      ),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 330,
  });
  const graph = await plugins.system.startDegradable({
    id: 'graph',
    startup: 'degradable',
    startupRecovery: '检查 GraphQL 服务的启动诊断及依赖服务',
    requires: ['@plugins', '@machines'],
    /**
     * 入口 / Entry: createApplicationServices.create.
     * 功能：从当前输入或状态计算 `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…`，供调用方后续验证或使用。
     * Purpose: Computes `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.get('@plugins').enabled)),
    /**
     * 入口 / Entry: createApplicationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: createApplicationServices.dispose.
     * 功能：把本层请求转交 `value.close`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.close` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value?.close()`.
     * 副作用 / Effects: `value.close`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    dispose: (value) => value?.close(),
    disposePhase: 340,
  });

  for (const source of domainRecoverySources({
    /**
     * 入口 / Entry: createApplicationServices.vmIds.
     * 功能：从当前输入或状态计算 `[...machines.records.keys()]`，供调用方后续验证或使用。
     * Purpose: Computes `[...machines.records.keys()]` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `[...machines.records.keys()]`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    vmIds: () => [...machines.records.keys()],
    /**
     * 入口 / Entry: createApplicationServices.backups.
     * 功能：从当前输入或状态计算 `features.enabled.has('backups') ? features.backups : undefined`，供调用方后续验证或使用。
     * Purpose: Computes `features.enabled.has('backups') ? features.backups : undefined` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `features.enabled.has('backups') ? features.backups : undefined`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    backups: () => features.enabled.has('backups') ? features.backups : undefined,
    /**
     * 入口 / Entry: createApplicationServices.coldMigrations.
     * 功能：从当前输入或状态计算 `plugins.system.has('coldMigrations') ? coldMigrations : undefined`，供调用方后续验证或使用。
     * Purpose: Computes `plugins.system.has('coldMigrations') ? coldMigrations : undefined` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `plugins.system.has('coldMigrations') ? coldMigrations : undefined`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    coldMigrations: () => plugins.system.has('coldMigrations') ? coldMigrations : undefined,
    /**
     * 入口 / Entry: createApplicationServices.sync.
     * 功能：从当前输入或状态计算 `features.enabled.has('sync') ? features.sync : undefined`，供调用方后续验证或使用。
     * Purpose: Computes `features.enabled.has('sync') ? features.sync : undefined` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `features.enabled.has('sync') ? features.sync : undefined`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    sync: () => features.enabled.has('sync') ? features.sync : undefined,
  })) recoveries.register(source);
  recoveries.register(haPromotionRecoverySource(() => [...machines.records.values()]));
  recoveries.register(liveMigrationRecoverySource({
    /**
     * 入口 / Entry: createApplicationServices.records.
     * 功能：从当前输入或状态计算 `[...machines.records.values()]`，供调用方后续验证或使用。
     * Purpose: Computes `[...machines.records.values()]` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `[...machines.records.values()]`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    records: () => [...machines.records.values()],
    /**
     * 入口 / Entry: createApplicationServices.peers.
     * 功能：从当前输入或状态计算 `plugins.system.has('hostPeers') ? hostPeers : undefined`，供调用方后续验证或使用。
     * Purpose: Computes `plugins.system.has('hostPeers') ? hostPeers : undefined` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `plugins.system.has('hostPeers') ? hostPeers : undefined`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    peers: () => plugins.system.has('hostPeers') ? hostPeers : undefined,
    /**
     * 入口 / Entry: createApplicationServices.confirm.
     * 功能：把本层请求转交 `migrationCompletion.confirm`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `migrationCompletion.confirm` and propagates the provider result or rejection.
     * 输入 / Inputs: id; fence
     * 输出 / Returns: `migrationCompletion.confirm(id, fence)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirm: (id, fence) => migrationCompletion.confirm(id, fence),
    /**
     * 入口 / Entry: createApplicationServices.canConfirm.
     * 功能：把本层请求转交 `migrationCompletion.canConfirm`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `migrationCompletion.canConfirm` and propagates the provider result or rejection.
     * 输入 / Inputs: id; fence
     * 输出 / Returns: `migrationCompletion.canConfirm(id, fence)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    canConfirm: (id, fence) => migrationCompletion.canConfirm(id, fence),
    /**
     * 入口 / Entry: createApplicationServices.confirmed.
     * 功能：把本层请求转交 `migrationCompletion.confirmed`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `migrationCompletion.confirmed` and propagates the provider result or rejection.
     * 输入 / Inputs: id; fence
     * 输出 / Returns: `migrationCompletion.confirmed(id, fence)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    confirmed: (id, fence) => migrationCompletion.confirmed(id, fence),
  }));
  await recoveries.refresh();

  const recoveryApi: RecoveryCatalogV1 = recoveries;
  return {
    access,
    assistant,
    trustedUpdates,
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
    /**
     * 入口 / Entry: createApplicationServices.requireService.
     * 功能：把本层请求转交 `plugins.system.require`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `plugins.system.require` and propagates the provider result or rejection.
     * 输入 / Inputs: id: K
     * 输出 / Returns: SystemServiceContracts[K]；结果来自 / values from `plugins.system.require(id)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    requireService<K extends keyof SystemServiceContracts>(id: K): SystemServiceContracts[K] {
      return plugins.system.require(id);
    },
    connectionHooks,
    diagnostics,
    recoveries: recoveryApi,
    /**
     * 入口 / Entry: createApplicationServices.acceptRequests.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `plugins.assertReady` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `plugins.assertReady`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `acceptingRequests`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    acceptRequests() {
      plugins.assertReady();
      acceptingRequests = true;
    },
    usbHotplug,
    projectExecution,
    /**
     * 入口 / Entry: createApplicationServices.token.
     * 功能：向调用者提供 `token` 的当前视图，不复制独立的业务状态。
     * Purpose: Exposes the current `token` view rather than creating separate domain state.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `token`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    get token() {
      return token;
    },
    /**
     * 入口 / Entry: createApplicationServices.token.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: value: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `token`.
     */
    set token(value: string) {
      token = value;
    },
    /**
     * 入口 / Entry: createApplicationServices.onSessionChange.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: listener: typeof sessionChanged
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `sessionChanged`.
     */
    onSessionChange(listener: typeof sessionChanged) {
      sessionChanged = listener;
    },
  };
}

export type ApplicationServices = Awaited<ReturnType<typeof createApplicationServices>>;

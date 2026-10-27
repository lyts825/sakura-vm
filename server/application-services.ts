/** 组合领域装配阶段，持有应用准入、VM 所有权、协作端口和恢复目录。
 * Compose domain startup stages and own application admission, VM lifetime, peer ports and recovery registration. */
import type { HostPeersV1, RecoveryCatalogV1, ResourceScopeV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import { arch, cpus, freemem, hostname, loadavg, platform, totalmem } from 'node:os';
import { AppError } from '../shared/errors.ts';
import { hostAudit } from './audit.ts';
import { BrowserExtensions } from './browser-extensions.ts';
import { FeatureRollouts } from './feature-rollouts.ts';
import { Features } from './features.ts';
import { FleetPolicyRollouts } from './fleet-policy-rollouts.ts';
import { createHostImportReceiver } from './host-import-receiver.ts';
import { HostPeers, isAuthenticatedMigrationCompletion, type HostPeerDependencies } from './host-peers.ts';
import { createLiveMigrationCompletionPort } from './live-migration-proof.ts';
import { registerLiveMigrationCompletionPort } from './live-migration-runner.ts';
import { JitPrivileges } from './jit-privileges.ts';
import { Jobs } from './jobs.ts';
import { LiveMigrationReceiver, registerLiveMigrationTargetPort } from './live-migration-receiver.ts';
import { Machines } from './machines.ts';
import { MobileCompanion } from './mobile-companion.ts';
import { ImageAssets } from './image-assets.ts';
import { EgressRules } from './egress-rules.ts';
import { DATA } from './paths.ts';
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
import { ProjectExecution } from './project-execution.ts';
import { RemoteAuditLock } from './remote-audit.ts';
import { ClosePhase } from './resource-scope.ts';
import { createRuntime } from './runtime.ts';
import { TerminalSharing } from './terminal-sharing.ts';
import { RuntimeDiagnostics } from './runtime-diagnostics.ts';
import type { SystemServiceContracts } from './service-contracts.ts';
import { startIdentityServices } from './application/identity-services.ts';
import { startSuiteServices } from './application/suite-services.ts';
import { startPlatformServices } from './application/platform-services.ts';
import { startProjectServices } from './application/project-services.ts';
import { startCapabilityServices } from './application/capability-services.ts';
import { startWorkspaceServices } from './application/workspace-services.ts';
import { startIntegrationServices } from './application/integration-services.ts';

/**
 * 入口 / Entry: createApplicationServices.
 * 功能：按依赖装配系统和插件领域服务，注册恢复来源并返回 HTTP/WebSocket 共用的服务集合。
 * Purpose: Assembles system/plugin domains in dependency order, registers recovery sources and returns shared HTTP/WebSocket services.
 * 设计：资源先登记后异步初始化；延迟依赖在就绪阶段验证，恢复目录读取原领域证据，失败清理由统一作用域保留。
 * Design: Resources are registered before asynchronous initialization; late dependencies are verified at readiness, recovery reads domain evidence, and the shared scope retains failed cleanup.
 * 输入 / Inputs: resources: ResourceScopeV1; plugins: PluginManager
 * 输出 / Returns: `{ access, assistant, audit, automationRules, browserExtensions, buildFarm, changeApprovals, coldMigrations, dev, features, fl…`.
 * 副作用 / Effects: `resources.defer`; `recoveries.register`; `plugins.system.start`; `createRuntime`; `releaseRuntimeOwnership`; 更新 / updates `Jobs.instrument`, `features`.
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
  const { session, access, passkeys, sso } = await startIdentityServices(plugins.system, (locked, transitioned) => sessionChanged(locked, transitioned), connectionHooks);
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
  await startSuiteServices(plugins.system, selectedPlugins);
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
  const { usbHotplug, mediaDevices, memoryReclaim, hostMounts, virtioFsShares, trustedBoot, gpuProfiles, buildFarm } = await startPlatformServices(plugins.system);
  const { projectPermissions, policyBundles, changeApprovals, processInterop } = await startProjectServices(plugins.system, Boolean(features.workspaces));

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
  await startCapabilityServices(plugins.system);
  const { coldMigrations, snapshotReplications } = await startWorkspaceServices(plugins.system, { workspaces: Boolean(features.workspaces), next: Boolean(features.next), bundles: Boolean(features.bundles), backups: Boolean(features.backups) });
  const { native, nativeClipboard, assistant, trustedUpdates, webhooks, automationRules, retention, graph } = await startIntegrationServices(plugins.system);

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

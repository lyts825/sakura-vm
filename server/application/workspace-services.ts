/** 按已激活能力装配开发环境、迁移与 HA 服务，保留原依赖和见证协议。
 * Compose development, migration and HA services for active capabilities while preserving dependencies and witness protocols. */
import type { BrowserIdeV1, ColdMigrationsV1, HaHostFailoverV1, HaLocalFailoversV1, NotebookEnvironmentsV1, SnapshotReplicationsV1 } from '../service-contracts/v1.ts';
import { BrowserIde } from '../browser-ide.ts';
import { ColdMigrations } from '../cold-migration.ts';
import { DisasterRecoveryDrill } from '../disaster-recovery-drill.ts';
import { HaHostFailover } from '../ha-host-failover.ts';
import { HaLocalFailovers } from '../ha-local-failovers.ts';
import { HaWitnessClient } from '../ha-witness-client.ts';
import { NotebookEnvironments } from '../notebook-environments.ts';
import { DataNotebookSessions } from '../data-notebook-sessions.ts';
import { ClosePhase } from '../resource-scope.ts';
import { SnapshotReplications } from '../snapshot-replications.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startWorkspaceServices(system: SystemServices, enabled: Readonly<{ workspaces: boolean; next: boolean; bundles: boolean; backups: boolean }>) {
  let coldMigrations: ColdMigrationsV1 | undefined;
  let snapshotReplications: SnapshotReplicationsV1 | undefined;
  let haLocalFailovers: HaLocalFailoversV1 | undefined;
  let haHostFailover: HaHostFailoverV1 | undefined;
  let notebooks: NotebookEnvironmentsV1 | undefined;
  let browserIde: BrowserIdeV1 | undefined;
  if (enabled.workspaces) {
    notebooks = await system.start({
      id: 'notebookEnvironments',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new NotebookEnvironments(dependencies.vm(), dependencies.get('@plugins').workspaces),
      /**
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
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

    await system.start({
      id: 'notebookEnvironmentsV2', startup: 'required', requires: ['@machines', '@plugins', 'notebookEnvironments', 'imageAssets'],
      create: dependencies => new DataNotebookSessions(() => dependencies.get('notebookEnvironments'), dependencies.vm(), dependencies.get('@plugins').workspaces, dependencies.get('imageAssets')),
      initialize: () => {}, dispose: () => {}, disposePhase: 369,
    });
  }
  if (enabled.next) {
    browserIde = await system.start({
      id: 'browserIde',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new BrowserIde(dependencies.vm(), dependencies.get('@plugins').workspaces),
      /**
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
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
  if (enabled.next && enabled.bundles) {
    coldMigrations = await system.start({
      id: 'coldMigrations',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 处理：通过 `dependencies.vm`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `dependencies.vm`, `dependencies.get`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: dependencies
       * 输出 / Returns: `new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      create: (dependencies) => new ColdMigrations(dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers')),
      /**
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`workspace-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `workspace-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });

    snapshotReplications = await system.start({
      id: 'snapshotReplications',
      startup: 'required',
      requires: ['hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new SnapshotReplications( dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'), )` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new SnapshotReplications( dependencies.vm(), dependencies.get('@plugins').bundles, dependencies.get('hostPeers'), )` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`workspace-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `workspace-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
    haHostFailover = await system.start({
      id: 'haHostFailover',
      startup: 'required',
      requires: ['hostPeers', 'snapshotReplications', '@machines', '@plugins'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new HaHostFailover( dependencies.vm(), dependencies.get('hostPeers'), dependencies.get('snapshotReplications')!, () => depend…` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new HaHostFailover( dependencies.vm(), dependencies.get('hostPeers'), dependencies.get('snapshotReplications')!, () => depend…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
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

    haLocalFailovers = await system.start({
      id: 'haLocalFailovers',
      startup: 'required',
      requires: ['haHostFailover', 'snapshotReplications', 'hostPeers', '@machines', '@plugins'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new HaLocalFailovers( dependencies.vm(), dependencies.get('@plugins').next.haFailureMonitor, dependencies.get('hostPeers'), d…` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new HaLocalFailovers( dependencies.vm(), dependencies.get('@plugins').next.haFailureMonitor, dependencies.get('hostPeers'), d…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
           * 入口 / Entry: startWorkspaceServices.disarmWitness.
           * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('haHostFailover')!.disarm(id, failureThreshold)` 供上层消费（`workspace-services.ts`）。
           * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `dependencies.get('haHostFailover')!.disarm(id, failureThreshold)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
       * 输入 / Inputs: value
       * 输出 / Returns: `value.init()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      initialize: (value) => value.init(),
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
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
  if (enabled.next && enabled.backups && enabled.bundles)
    await system.start({
      id: 'disasterRecovery',
      startup: 'required',
      requires: ['@plugins', '@machines'],
      /**
       * 入口 / Entry: startWorkspaceServices.create.
       * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new DisasterRecoveryDrill( dependencies.vm(), dependencies.get('@plugins').backups, dependencies.get('@plugins').bundles, )` 供上层消费（`workspace-services.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `workspace-services.ts`; this entry produces `new DisasterRecoveryDrill( dependencies.vm(), dependencies.get('@plugins').backups, dependencies.get('@plugins').bundles, )` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
       * 入口 / Entry: startWorkspaceServices.initialize.
       * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`workspace-services.ts`）。
       * Purpose: Initializes and verifies current domain state in `workspace-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      initialize: () => {},
      /**
       * 入口 / Entry: startWorkspaceServices.dispose.
       * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`workspace-services.ts`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `workspace-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      dispose: () => {},
      disposePhase: ClosePhase.services,
    });
  return { coldMigrations, snapshotReplications };
}

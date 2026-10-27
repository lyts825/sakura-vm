/** 装配原生集成、自动化与查询服务，各服务独立登记启动和关闭。
 * Compose native integration, automation and query services with independent lifecycle registrations. */
import { AppError } from '../../shared/errors.ts';
import { AutomationRules } from '../automation-rules.ts';
import { CommunityPlugins } from '../community-plugins.ts';
import { runEngineeringOperation } from '../engineering-runner.ts';
import { GraphApi, querySnapshot } from '../graphql-api.ts';
import { LocalAssistant } from '../local-assistant.ts';
import { TrustedUpdates } from '../trusted-updates.ts';
import { LogRetention } from '../log-retention.ts';
import { NativeClipboard } from '../native-clipboard.ts';
import { NativeIntegration, nativeMappings } from '../native-integration.ts';
import { DATA } from '../paths.ts';
import { join } from 'node:path';
import { Webhooks, collectWebhookEvents } from '../webhooks.ts';
import { Workspaces } from '../workspaces.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startIntegrationServices(system: SystemServices) {
  const native = await system.startDegradable({
    id: 'native',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-integration.json'),
    requires: ['session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const nativeClipboard = await system.startDegradable({
    id: 'nativeClipboard',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'native-clipboard.json') + '，并确认原生剪贴板组件可用',
    requires: ['session', '@plugins'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
     * 功能：从当前输入或状态计算 `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…`，供调用方后续验证或使用。
     * Purpose: Computes `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new NativeClipboard({ guard: () => dependencies.get('session').requireUnlocked(), maintenance: () => !!dependencies.get('@plu…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new NativeClipboard({
        /**
         * 入口 / Entry: startIntegrationServices.guard.
         * 功能：在创建并连接应用领域服务及恢复来源中，核对调用资格、输入或资源归属；本入口产生 `dependencies.get('session').requireUnlocked()` 供上层消费（`integration-services.ts`）。
         * Purpose: Checks admission, input or resource ownership in `integration-services.ts`; this entry produces `dependencies.get('session').requireUnlocked()` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().requireUnlocked`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().requireUnlocked`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `dependencies.get('session').requireUnlocked()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        guard: () => dependencies.get('session').requireUnlocked(),
        /**
         * 入口 / Entry: startIntegrationServices.maintenance.
         * 功能：从当前输入或状态计算 `!!dependencies.get('@plugins').migration?.blocked`，供调用方后续验证或使用。
         * Purpose: Computes `!!dependencies.get('@plugins').migration?.blocked` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!!dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        maintenance: () => !!dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: startIntegrationServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`integration-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `integration-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const assistant = await system.startDegradable({
    id: 'assistant',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'local-assistant.json'),
    requires: [],
    /**
     * 入口 / Entry: startIntegrationServices.create.
     * 功能：从当前输入或状态计算 `new LocalAssistant()`，供调用方后续验证或使用。
     * Purpose: Computes `new LocalAssistant()` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new LocalAssistant()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new LocalAssistant(),
    /**
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const trustedUpdates = await system.startDegradable({
    id: 'trustedUpdates', startup: 'degradable',
    startupRecovery: '检查原安装目录中的更新信任策略与版本状态',
    requires: [],
    create: () => new TrustedUpdates(),
    initialize: value => value.init(),
    dispose: value => value?.close(),
    disposePhase: 155,
  });
  const communityPlugins = await system.start({
    id: 'communityPlugins',
    startup: 'required',
    requires: ['@machines', '@plugins', '@pluginDirectory'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
     * 功能：从当前输入或状态计算 `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …`，供调用方后续验证或使用。
     * Purpose: Computes `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), { events: async () => …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new CommunityPlugins(undefined, undefined, undefined, undefined, dependencies.get('@pluginDirectory'), {
        /**
         * 入口 / Entry: startIntegrationServices.events.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…` 供上层消费（`integration-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `integration-services.ts`; this entry produces `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `collectWebhookEvents`, `dependencies.get`, `dependencies.get().jobStores().flatMap`, `dependencies.get().jobStores` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `collectWebhookEvents`, `dependencies.get`, `dependencies.get().jobStores().flatMap`, `dependencies.get().jobStores`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list())…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        events: async () => collectWebhookEvents(dependencies.get('@machines'), dependencies.get('@plugins').jobStores().flatMap((store) => store.list()), (await dependencies.get('@plugins').suite?.alertEvents()) || []),
        /**
         * 入口 / Entry: startIntegrationServices.blocked.
         * 功能：从当前输入或状态计算 `!!dependencies.get('@plugins').migration?.blocked`，供调用方后续验证或使用。
         * Purpose: Computes `!!dependencies.get('@plugins').migration?.blocked` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!!dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        blocked: () => !!dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: startIntegrationServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('@plugins').operations.change(delta)` 供上层消费（`integration-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `integration-services.ts`; this entry produces `dependencies.get('@plugins').operations.change(delta)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const webhooks = await system.startDegradable({
    id: 'webhooks',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'webhooks.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
   * 入口 / Entry: startIntegrationServices.callback@859.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（system.startDegradable）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (system.startDegradable).
   * 输入 / Inputs: id; steps; projectId; signal
   * 输出 / Returns: `await workspaces.projects.with(id, projectId, () => runEngineeringOperation( dependencies.vm(), workspaces, id, 'runbooks', {…`.
   * 副作用 / Effects: `owned.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `await owned?.close();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `await owned?.close();`; these steps also apply to exceptional exits.
   */
  const automationRules = await system.startDegradable({
    id: 'automationRules',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'automation-rules.json'),
    requires: ['@plugins', '@machines'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
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
         * 所属 / Owner: startIntegrationServices.automationRules.create.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const retention = await system.startDegradable({
    id: 'retention',
    startup: 'degradable',
    startupRecovery: '检查并修复 ' + join(DATA, 'log-retention.json'),
    requires: ['@machines', '@plugins'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
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
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  const graph = await system.startDegradable({
    id: 'graph',
    startup: 'degradable',
    startupRecovery: '检查 GraphQL 服务的启动诊断及依赖服务',
    requires: ['@plugins', '@machines'],
    /**
     * 入口 / Entry: startIntegrationServices.create.
     * 功能：从当前输入或状态计算 `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…`，供调用方后续验证或使用。
     * Purpose: Computes `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new GraphApi(async () => querySnapshot(dependencies.get('@machines'), dependencies.get('@plugins').jobStores(), dependencies.get('@plugins').enabled)),
    /**
     * 入口 / Entry: startIntegrationServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`integration-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `integration-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: startIntegrationServices.dispose.
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
  return { native, nativeClipboard, assistant, trustedUpdates, webhooks, automationRules, retention, graph };
}

/** 注册宿主能力检查，复用已就绪服务的公开契约。
 * Register host capability checks against ready services and their public contracts. */
import { ClosePhase } from '../resource-scope.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startCapabilityServices(system: SystemServices) {

  await system.start({
    id: 'capabilityChecks',
    startup: 'required',
    requires: ['access', 'session', 'remoteAudit', 'hostPeers', 'mobileCompanion', 'projectTerminals', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startCapabilityServices.create.
     * 功能：从当前输入或状态计算 `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…`，供调用方后续验证或使用。
     * Purpose: Computes `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `({ mutation: (delta) => { dependencies.get('@plugins').operations.change(delta); }, acmeAllowed: () => !dependencies.get('ses…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => ({
        /**
         * 入口 / Entry: startCapabilityServices.mutation.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
         * 入口 / Entry: startCapabilityServices.acmeAllowed.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().view`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().view`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `!dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        acmeAllowed: () => !dependencies.get('session').view().locked && !dependencies.get('@plugins').migration?.blocked,
        /**
         * 入口 / Entry: startCapabilityServices.mobileCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ ready: dependencies.get('access').enabled && dependencies.get('hostPeers').view().listener.active && dependencies.get('hos…` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `({ ready: dependencies.get('access').enabled && dependencies.get('hostPeers').view().listener.active && dependencies.get('hos…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
         * 入口 / Entry: startCapabilityServices.scoreHosts.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `dependencies.get('hostPeers').score(input)` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `dependencies.get('hostPeers').score(input)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 处理：通过 `dependencies.get().score`, `dependencies.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `dependencies.get().score`, `dependencies.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: input
         * 输出 / Returns: `dependencies.get('hostPeers').score(input)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        scoreHosts: (input) => dependencies.get('hostPeers').score(input),
        /**
         * 入口 / Entry: startCapabilityServices.sharedDesktopCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用桌面插件并重启 Sakura。' }` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用桌面插件并重启 Sakura。' }` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
         * 入口 / Entry: startCapabilityServices.passkeyCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `({ ready: dependencies.get('access').enabled, registered: dependencies.get('access').users().reduce((count, user) => count + …` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `({ ready: dependencies.get('access').enabled, registered: dependencies.get('access').users().reduce((count, user) => count + …` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
         * 入口 / Entry: startCapabilityServices.accountModeReady.
         * 功能：从当前输入或状态计算 `dependencies.get('access').enabled`，供调用方后续验证或使用。
         * Purpose: Computes `dependencies.get('access').enabled` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `dependencies.get('access').enabled`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        accountModeReady: () => dependencies.get('access').enabled,
        /**
         * 入口 / Entry: startCapabilityServices.remoteAuditCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: Boolean( status.target && status.last && status.local.valid && status.protected && status.lastVerifiedAt && Date.now…` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `{ ready: Boolean( status.target && status.last && status.local.valid && status.protected && status.lastVerifiedAt && Date.now…` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
         * 入口 / Entry: startCapabilityServices.sharedTerminalCheck.
         * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' }` 供上层消费（`capability-services.ts`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `capability-services.ts`; this entry produces `{ ready: false, reason: '请先启用账户模式。' }` / `{ ready: false, reason: '请先启用可恢复终端会话插件并重启 Sakura。' }` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
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
      }) satisfies import('../host-service-contracts.ts').HostServiceContracts['capabilityChecks'],
    /**
     * 入口 / Entry: startCapabilityServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`capability-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `capability-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: startCapabilityServices.dispose.
     * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`capability-services.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `capability-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
}

/** 装配会话、账户与登录服务；会话变化通过注入回调传回应用。
 * Compose session, account and sign-in services; forward session transitions through injected callbacks. */
import { AccessControl } from '../access-control.ts';
import { Passkeys } from '../passkeys.ts';
import { PORT } from '../paths.ts';
import { SessionLock } from '../session-lock.ts';
import { SingleSignOn } from '../sso.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startIdentityServices(system: SystemServices, sessionChanged: (locked: boolean, transitioned: boolean) => void, connectionHooks: { terminate: () => void }) {
  const session = await system.start({
    id: 'session',
    startup: 'required',
    requires: [],
    /**
     * 入口 / Entry: startIdentityServices.create.
     * 功能：从当前输入或状态计算 `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))`，供调用方后续验证或使用。
     * Purpose: Computes `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new SessionLock((locked, transitioned) => sessionChanged(locked, transitioned)),
    /**
     * 入口 / Entry: startIdentityServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIdentityServices.dispose.
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
  const access = await system.start({
    id: 'access',
    startup: 'required',
    requires: [],
    /**
     * 入口 / Entry: startIdentityServices.create.
     * 功能：从当前输入或状态计算 `new AccessControl()`，供调用方后续验证或使用。
     * Purpose: Computes `new AccessControl()` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new AccessControl()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    create: (dependencies) => new AccessControl(),
    /**
     * 入口 / Entry: startIdentityServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIdentityServices.dispose.
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
  const passkeys = await system.start({
    id: 'passkeys',
    startup: 'required',
    requires: ['access'],
    /**
     * 入口 / Entry: startIdentityServices.create.
     * 功能：从当前输入或状态计算 `new Passkeys(dependencies.get('access'), PORT)`，供调用方后续验证或使用。
     * Purpose: Computes `new Passkeys(dependencies.get('access'), PORT)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new Passkeys(dependencies.get('access'), PORT)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new Passkeys(dependencies.get('access'), PORT),
    /**
     * 入口 / Entry: startIdentityServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`identity-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `identity-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: startIdentityServices.dispose.
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
  const sso = await system.start({
    id: 'sso',
    startup: 'required',
    requires: ['access'],
    /**
     * 入口 / Entry: startIdentityServices.create.
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
     * 入口 / Entry: startIdentityServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startIdentityServices.dispose.
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
  return { session, access, passkeys, sso };
}

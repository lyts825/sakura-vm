/** 装配项目权限、审批和进程互通，仅通过声明的依赖解析器获取服务。
 * Compose project permissions, approvals and process interop using declared dependency resolvers. */
import { AppError } from '../../shared/errors.ts';
import { ChangeApprovals } from '../change-approvals.ts';
import { PORT } from '../paths.ts';
import { PolicyBundles } from '../policy-bundles.ts';
import { ProcessInterop } from '../process-interop.ts';
import { ProjectPermissions } from '../project-permissions.ts';
import { ClosePhase } from '../resource-scope.ts';
import type { SystemServices } from '../system-services.ts';

/** 按原顺序注册服务，依赖与清理由 SystemServices 持有；失败向启动入口传播。
 * Register services in their original order; SystemServices owns dependencies and cleanup, and startup failures propagate. */
export async function startProjectServices(system: SystemServices, workspacesEnabled: boolean) {
  const projectPermissions = await system.start({
    id: 'projectPermissions',
    startup: 'required',
    requires: ['access', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startProjectServices.create.
     * 功能：在创建并连接应用领域服务及恢复来源中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)` 供上层消费（`project-services.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-services.ts`; this entry produces `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)` for its caller. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 处理：通过 `dependencies.get`, `dependencies.vm` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `dependencies.get`, `dependencies.vm`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new ProjectPermissions(dependencies.get('access'), dependencies.vm(), dependencies.get('@plugins').workspaces),
    /**
     * 入口 / Entry: startProjectServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startProjectServices.dispose.
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
  const policyBundles = await system.start({
    id: 'policyBundles',
    startup: 'required',
    requires: ['projectPermissions'],
    /**
     * 入口 / Entry: startProjectServices.create.
     * 功能：从当前输入或状态计算 `new PolicyBundles(dependencies.get('projectPermissions'))`，供调用方后续验证或使用。
     * Purpose: Computes `new PolicyBundles(dependencies.get('projectPermissions'))` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: dependencies
     * 输出 / Returns: `new PolicyBundles(dependencies.get('projectPermissions'))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    create: (dependencies) => new PolicyBundles(dependencies.get('projectPermissions')),
    /**
     * 入口 / Entry: startProjectServices.initialize.
     * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
     * 输入 / Inputs: value
     * 输出 / Returns: `value.init()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    initialize: (value) => value.init(),
    /**
     * 入口 / Entry: startProjectServices.dispose.
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
  const changeApprovals = workspacesEnabled
    ? await system.start({
        id: 'changeApprovals',
        startup: 'required',
        requires: ['projectPermissions', '@plugins'],
        /**
         * 入口 / Entry: startProjectServices.create.
         * 功能：从当前输入或状态计算 `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)`，供调用方后续验证或使用。
         * Purpose: Computes `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)` from current inputs/state for the caller to validate or consume.
         * 输入 / Inputs: dependencies
         * 输出 / Returns: `new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        create: (dependencies) => new ChangeApprovals(dependencies.get('projectPermissions'), dependencies.get('@plugins').workspaces),
        /**
         * 入口 / Entry: startProjectServices.initialize.
         * 功能：把本层请求转交 `value.init`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `value.init` and propagates the provider result or rejection.
         * 输入 / Inputs: value
         * 输出 / Returns: `value.init()`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        initialize: (value) => value.init(),
        /**
         * 入口 / Entry: startProjectServices.dispose.
         * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`project-services.ts`）。
         * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        dispose: () => {},
        disposePhase: ClosePhase.services,
      })
    : undefined;

  const processInterop = await system.start({
    id: 'processInterop',
    startup: 'required',
    requires: ['session', '@machines', '@plugins'],
    /**
     * 入口 / Entry: startProjectServices.create.
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
     * 入口 / Entry: startProjectServices.initialize.
     * 功能：在创建并连接应用领域服务及恢复来源中，初始化并核对当前领域状态；完成下述调用及状态处理（`project-services.ts`）。
     * Purpose: Initializes and verifies current domain state in `project-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    initialize: () => {},
    /**
     * 入口 / Entry: startProjectServices.dispose.
     * 功能：在创建并连接应用领域服务及恢复来源中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`project-services.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `project-services.ts`; the calls and state transitions below complete the operation. Module context: Creates and connects domain services and recovery sources under the application's readiness and shutdown lifecycle.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    dispose: () => {},
    disposePhase: ClosePhase.services,
  });
  return { projectPermissions, policyBundles, changeApprovals, processInterop };
}

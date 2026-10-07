/**
 * 模块职责：传递插件执行、后台及清理授权上下文，防止异步续接失去原插件身份。
 * Module purpose: Propagates execution/background/cleanup authority so asynchronous continuations retain the originating plugin instance.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PluginInstance } from './plugin-instance.ts';
import { withOperationCheck } from './operation-context.ts';
import { withoutOperationContext } from './operation-context.ts';
import { withResourceContext, withNewResourceContext } from './host-runtime/context.ts';

const current = new AsyncLocalStorage<PluginInstance>();
const cleaning = new AsyncLocalStorage<PluginInstance>();
/**
 * 入口 / Entry: pluginAuthority.
 * 功能：把本层请求转交 `current.getStore`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `current.getStore` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `current.getStore()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function pluginAuthority() {
  return current.getStore();
}
/**
 * 入口 / Entry: pluginCleanup.
 * 功能：把本层请求转交 `cleaning.getStore`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `cleaning.getStore` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `cleaning.getStore()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function pluginCleanup() {
  return cleaning.getStore();
}
/** Host-only cleanup dispatch. No plugin context exports this authority. */
/**
 * 入口 / Entry: withPluginCleanup.
 * 功能：把本层请求转交 `current.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `current.run` and propagates the provider result or rejection.
 * 输入 / Inputs: instance: PluginInstance; work: () => T
 * 输出 / Returns: T；结果来自 / values from `current.run(instance, () => cleaning.run(instance, () => withoutOperationContext(() => withResourceContext(instance.resourceI…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withPluginCleanup<T>(instance: PluginInstance, work: () => T): T {
  return current.run(instance, () =>
    cleaning.run(instance, () =>
      withoutOperationContext(() => withResourceContext(instance.resourceIdentity, work)),
    ),
  );
}
/**
 * 入口 / Entry: withoutPluginAuthority.
 * 功能：把本层请求转交 `current.exit`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `current.exit` and propagates the provider result or rejection.
 * 输入 / Inputs: work: () => T
 * 输出 / Returns: T；结果来自 / values from `current.exit(work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withoutPluginAuthority<T>(work: () => T): T {
  return current.exit(work);
}
/**
 * 入口 / Entry: withPluginBackground.
 * 功能：把本层请求转交 `withoutOperationContext`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `withoutOperationContext` and propagates the provider result or rejection.
 * 输入 / Inputs: instance: PluginInstance; work: () => T
 * 输出 / Returns: T；结果来自 / values from `withoutOperationContext(() => withNewResourceContext(instance.resourceIdentity, () => withPluginAuthority(instance, work, () …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withPluginBackground<T>(instance: PluginInstance, work: () => T): T {
  return withoutOperationContext(() =>
    withNewResourceContext(instance.resourceIdentity, () =>
      withPluginAuthority(instance, work, () => instance.check()),
    ),
  );
}
/** Resume an already admitted native callback without granting cleanup or fresh business authority. */
/**
 * 入口 / Entry: withPluginContinuation.
 * 功能：把本层请求转交 `current.run`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `current.run` and propagates the provider result or rejection.
 * 输入 / Inputs: instance: PluginInstance; work: () => T
 * 输出 / Returns: T；结果来自 / values from `current.run(instance, () => cleaning.exit(() => withoutOperationContext(() => withResourceContext(instance.resourceIdentity, …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withPluginContinuation<T>(instance: PluginInstance, work: () => T): T {
  return current.run(instance, () =>
    cleaning.exit(() =>
      withoutOperationContext(() =>
        withResourceContext(instance.resourceIdentity, () =>
          withOperationCheck(async () => {
            instance.check(undefined, true);
          }, work),
        ),
      ),
    ),
  );
}
/** Carries both ownership and live authority through domain calls and resource queues. */
/**
 * 入口 / Entry: withPluginAuthority.
 * 功能：在传递插件执行、后台及清理授权上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current.run(instance, () => withResourceContext(instance.resourceIdentity, () => withOperationCheck(async () => { check(); },…` 供上层消费（`plugin-authority.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-authority.ts`; this entry produces `current.run(instance, () => withResourceContext(instance.resourceIdentity, () => withOperationCheck(async () => { check(); },…` for its caller. Module context: Propagates execution/background/cleanup authority so asynchronous continuations retain the originating plugin instance.
 * 处理：通过 `check`, `current.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `check`, `current.run`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: instance: PluginInstance; work: () => T; check: () => void default=() => instance.check(undefined, true)
 * 输出 / Returns: T；结果来自 / values from `current.run(instance, () => withResourceContext(instance.resourceIdentity, () => withOperationCheck(async () => { check(); },…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withPluginAuthority<T>(
  instance: PluginInstance,
  work: () => T,
  check: () => void = () => instance.check(undefined, true),
): T {
  check();
  return current.run(instance, () =>
    withResourceContext(instance.resourceIdentity, () =>
      withOperationCheck(async () => {
        check();
      }, work),
    ),
  );
}

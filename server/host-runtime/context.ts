/**
 * 模块职责：用异步上下文传递资源所有者与运行身份，让嵌套资源沿用当前操作归属。
 * Module purpose: Propagates owner/runtime identities through asynchronous context so nested resources retain operation ownership.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ResourceIdentity } from '../../shared/contracts/host-runtime.ts';

const contexts = new AsyncLocalStorage<Readonly<ResourceIdentity>>();

/**
 * 入口 / Entry: resourceContext.
 * 功能：把本层请求转交 `contexts.getStore`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `contexts.getStore` and propagates the provider result or rejection.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Readonly<ResourceIdentity> | undefined；结果来自 / values from `contexts.getStore()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function resourceContext(): Readonly<ResourceIdentity> | undefined {
  return contexts.getStore();
}

/** 在排队或跨 IPC 边界之前捕获身份，后续上下文变化不会把原资源归属转给新的请求。 */
/**
 * 入口 / Entry: captureResourceContext.
 * 功能：在用异步上下文传递资源所有者与运行身份中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.freeze(result)` 供上层消费（`host-runtime/context.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-runtime/context.ts`; this entry produces `Object.freeze(result)` for its caller. Module context: Propagates owner/runtime identities through asynchronous context so nested resources retain operation ownership.
 * 处理：通过 `contexts.getStore`, `randomUUID`, `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `contexts.getStore`, `randomUUID`, `inline.test`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `value === undefined`.
 * 输入 / Inputs: identity: Partial<ResourceIdentity> default={}
 * 输出 / Returns: Readonly<ResourceIdentity>；结果来自 / values from `Object.freeze(result)`.
 * 副作用 / Effects: 更新 / updates `result[key]`.
 * 拒绝 / Refusals: 条件 / conditions `typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)`; 异常 / errors `new Error(`Invalid resource identity: ${key}`)`.
 */
export function captureResourceContext(identity: Partial<ResourceIdentity> = {}): Readonly<ResourceIdentity> {
  const inherited = contexts.getStore();
  const result: ResourceIdentity = {
    ...inherited,
    owner: identity.owner ?? inherited?.owner ?? 'core:application',
    operationId: identity.operationId ?? inherited?.operationId ?? randomUUID(),
  };
  // 仅按白名单复制身份字段，避免请求正文因对象展开意外进入诊断或后续 IPC 数据。
  const keys: (keyof ResourceIdentity)[] = ['operationId', 'owner', 'actorId', 'pluginId', 'pluginInstanceId', 'pluginGeneration', 'callerPluginInstanceId', 'callerPluginGeneration', 'vmId',
    'projectId', 'jobId', 'vmProcessId', 'executionGeneration', 'bootId', 'networkGeneration', 'traceId', 'spanId', 'recoveryId'];
  for (const key of keys) {
    const value = identity[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !value.length || value.length > 200 || /[\x00-\x1f\x7f]/.test(value))
      throw new Error(`Invalid resource identity: ${key}`);
    result[key] = value;
  }
  return Object.freeze(result);
}

/**
 * 入口 / Entry: withResourceContext.
 * 功能：在用异步上下文传递资源所有者与运行身份中，执行此领域的具体处理步骤并返回其结果；本入口产生 `contexts.run(captureResourceContext(identity), work)` 供上层消费（`host-runtime/context.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-runtime/context.ts`; this entry produces `contexts.run(captureResourceContext(identity), work)` for its caller. Module context: Propagates owner/runtime identities through asynchronous context so nested resources retain operation ownership.
 * 处理：通过 `contexts.run`, `captureResourceContext` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `contexts.run`, `captureResourceContext`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: identity: Partial<ResourceIdentity>; work: () => T
 * 输出 / Returns: T；结果来自 / values from `contexts.run(captureResourceContext(identity), work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withResourceContext<T>(identity: Partial<ResourceIdentity>, work: () => T): T {
  return contexts.run(captureResourceContext(identity), work);
}

/** 独立后台工作新建归属，不继承注册请求的账户或实例身份。 */
/**
 * 入口 / Entry: withNewResourceContext.
 * 功能：在用异步上下文传递资源所有者与运行身份中，执行此领域的具体处理步骤并返回其结果；本入口产生 `contexts.run(contexts.exit(() => captureResourceContext(identity)), work)` 供上层消费（`host-runtime/context.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `host-runtime/context.ts`; this entry produces `contexts.run(contexts.exit(() => captureResourceContext(identity)), work)` for its caller. Module context: Propagates owner/runtime identities through asynchronous context so nested resources retain operation ownership.
 * 处理：通过 `contexts.run`, `contexts.exit` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `contexts.run`, `contexts.exit`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: identity: Partial<ResourceIdentity>; work: () => T
 * 输出 / Returns: T；结果来自 / values from `contexts.run(contexts.exit(() => captureResourceContext(identity)), work)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function withNewResourceContext<T>(identity: Partial<ResourceIdentity>, work: () => T): T {
  return contexts.run(contexts.exit(() => captureResourceContext(identity)), work);
}

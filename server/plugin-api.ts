/**
 * 模块职责：定义插件声明和受限上下文，检查依赖与服务读取权限后才提供能力。
 * Module purpose: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { z } from 'zod';
import type { JobView } from '../shared/contracts/jobs.ts';
import type { PluginManifest } from '../shared/plugin-protocol.ts';
import type { PluginRuntime } from './plugin-runtime.ts';

import type { PluginInstance } from './plugin-instance.ts';
import { pluginCapabilities, type PluginCapabilities } from './plugin-capabilities.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';
import { serviceRef, type ServiceRef } from './service-ref.ts';
import type { HostServiceResolver } from './host-service-contracts.ts';
import { withPluginAuthority } from './plugin-authority.ts';

export { SERVICE_KEYS } from './plugin-services.ts';
export type ServiceKey = (typeof SERVICE_KEYS)[number];
export type PluginContext = Readonly<PluginServices> & {
  readonly capabilities: PluginCapabilities;
  readonly execution: PluginCapabilities['execution'];
  readonly storage: PluginCapabilities['storage'];
  readonly networking: PluginCapabilities['networking'];
  readonly signal: AbortSignal;
  readonly instance: Readonly<Pick<PluginInstance, 'identity' | 'generation' | 'version' | 'artifactDigest'>>;
  readonly vm: PluginCapabilities['vm'];
  readonly system: HostServiceResolver;
  readonly activity: {
    readonly mutations: number;
    readonly importing: boolean;
    /**
     * 签名 / Signature: PluginContext.exclusive.
     * 功能：为定义插件声明和受限上下文声明 exclusive 的输入与结果契约，所属容器为 PluginContext。
     * Purpose: Declares the input/result contract for exclusive in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 输入 / Inputs: name: string; work: () => Promise<T>
     * 输出 / Returns: Promise<T>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    exclusive<T>(name: string, work:
    /**
     * 中文功能：将 PluginContext.activity.exclusive.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
     * English: Supplies work to the original context owned by PluginContext.activity.exclusive.work, returning the declared business result or asynchronous rejection.
     * 所属 / Owner: PluginContext.activity.exclusive.work.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `Promise<T>`.
     */
    () => Promise<T>): Promise<T>;
  };
  /**
   * 签名 / Signature: PluginContext.provide.
   * 功能：为定义插件声明和受限上下文声明 provide 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for provide in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: service: ServiceRef<T>; value: Value
   * 输出 / Returns: Value.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  provide<T, Value extends T>(service: ServiceRef<T>, value: Value): Value;
  /**
   * 签名 / Signature: PluginContext.use.
   * 功能：为定义插件声明和受限上下文声明 use 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for use in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: service: ServiceRef<T>
   * 输出 / Returns: T.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  use<T>(service: ServiceRef<T>): T;
  /**
   * 签名 / Signature: PluginContext.optional.
   * 功能：为定义插件声明和受限上下文声明 optional 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for optional in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: service: ServiceRef<T>
   * 输出 / Returns: T | undefined.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  optional<T>(service: ServiceRef<T>): T | undefined;
  /**
   * 签名 / Signature: PluginContext.require.
   * 功能：为定义插件声明和受限上下文声明 require 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for require in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: id: string
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  require(id: string): void;
  /**
   * 签名 / Signature: PluginContext.onDispose.
   * 功能：为定义插件声明和受限上下文声明 onDispose 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for onDispose in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: disposer: () => void | Promise<void>
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  onDispose(disposer:
  /**
   * 中文功能：登记 PluginContext.onDispose.disposer 的资源退役能力，按返回类型允许同步完成或异步等待。
   * English: Registers resource-retirement capability for PluginContext.onDispose.disposer, allowing synchronous completion or asynchronous waiting according to its result type.
   * 所属 / Owner: PluginContext.onDispose.disposer.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `void | Promise<void>`.
   */
  () => void | Promise<void>): void;
  /**
   * 签名 / Signature: PluginContext.registerJobs.
   * 功能：为定义插件声明和受限上下文声明 registerJobs 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for registerJobs in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: store: JobsV1; retry: (job: JobView) => Promise<unknown> | unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  registerJobs(store: JobsV1, retry:
  /**
   * 中文功能：接收原 JobView 并发起该任务的重试，结果可同步或通过 Promise 交付。
   * English: Receives the original JobView to retry that job, returning synchronously or through a Promise.
   * 所属 / Owner: PluginContext.registerJobs.retry.
   * 输入 / Inputs: job: JobView.
   * 结果 / Result: `Promise<unknown> | unknown`.
   */
  (job: JobView) => Promise<unknown> | unknown): void;
  /**
   * 签名 / Signature: PluginContext.jobViews.
   * 功能：为定义插件声明和受限上下文声明 jobViews 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for jobViews in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: readonly JobView[].
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  jobViews(): readonly JobView[];
  /**
   * 签名 / Signature: PluginContext.jobSources.
   * 功能：为定义插件声明和受限上下文声明 jobSources 的输入与结果契约，所属容器为 PluginContext。
   * Purpose: Declares the input/result contract for jobSources in PluginContext. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ReadonlyArray<Pick<JobsV1, 'list' | 'flush'>>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  jobSources(): ReadonlyArray<Pick<JobsV1, 'list' | 'flush'>>;
};
/**
 * 签名 / Signature: PluginRoute.PluginRoute.
 * 功能：为定义插件声明和受限上下文声明 PluginRoute 的输入与结果契约，所属容器为 PluginRoute。
 * Purpose: Declares the input/result contract for PluginRoute in PluginRoute. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
 * 输入 / Inputs: this: PluginContext; req: IncomingMessage; res: ServerResponse; url: URL; body: (request: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>; signal: AbortSignal
 * 输出 / Returns: Promise<boolean>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
export type PluginRoute = (
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (request: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  signal: AbortSignal,
) => Promise<boolean>;
export type PluginOperation = {
  request?: z.ZodType;
  response: z.ZodType;
  /**
   * 签名 / Signature: PluginOperation.execute.
   * 功能：为定义插件声明和受限上下文声明 execute 的输入与结果契约，所属容器为 PluginOperation。
   * Purpose: Declares the input/result contract for execute in PluginOperation. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: this: PluginContext; url: URL; input: unknown; signal: AbortSignal
   * 输出 / Returns: Promise<unknown> | unknown.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  execute(this: PluginContext, url: URL, input: unknown, signal: AbortSignal): Promise<unknown> | unknown;
};
export type PluginModule = {
  manifest: PluginManifest;
  /**
   * 签名 / Signature: PluginModule.activate.
   * 功能：为定义插件声明和受限上下文声明 activate 的输入与结果契约，所属容器为 PluginModule。
   * Purpose: Declares the input/result contract for activate in PluginModule. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: context: PluginContext
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  activate(context: PluginContext): Promise<void>;
  /**
   * 签名 / Signature: PluginModule.deactivate.
   * 功能：为定义插件声明和受限上下文声明 deactivate 的输入与结果契约，所属容器为 PluginModule。
   * Purpose: Declares the input/result contract for deactivate in PluginModule. Module responsibility: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
   * 输入 / Inputs: context: PluginContext
   * 输出 / Returns: void | Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  deactivate?(context: PluginContext): void | Promise<void>;
  route: PluginRoute;
  /** Explicit implemented operation IDs. New declarations cannot inherit a generic route handler. */
  httpHandlers?: Record<string, PluginRoute>;
  operations?: Record<string, PluginOperation>;
};

/** A standalone context owns no global mutable slots. Service reads go through the broker. */
/**
 * 入口 / Entry: pluginContext.
 * 功能：构造插件可见的目录、服务及能力上下文，按 manifest 限制依赖读取。
 * Purpose: Builds plugin-visible catalogues/services/capabilities with manifest-limited dependency access.
 * 设计：所有服务通过版本引用和 broker 解析，未声明依赖拒绝；后台及清理能力保持插件实例代次。
 * Design: Versioned references/broker lookup enforce declared dependencies and keep plugin generations across background/cleanup capabilities.
 * 输入 / Inputs: host: PluginRuntime; manifest: PluginManifest; catalog: readonly PluginManifest[]; instance: PluginInstance
 * 输出 / Returns: PluginContext；结果来自 / values from `Object.freeze(context) as unknown as PluginContext`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function pluginContext(
  host: PluginRuntime,
  manifest: PluginManifest,
  catalog: readonly PluginManifest[],
  instance: PluginInstance,
): PluginContext {
  const scope = instance.scope;
  const capabilities = pluginCapabilities(manifest.id, host.machines, scope, instance);
  const dependencies = new Set([...manifest.requires, ...manifest.optional].map((item) => item.id));
  const readable = new Map(
    catalog
      .filter((item) => item.id === manifest.id || dependencies.has(item.id))
      .flatMap((item) => item.services.map((key) => [key, item.id] as const)),
  );
  /**
   * 入口 / Entry: pluginContext.lookup.
   * 功能：把本层请求转交 `host.broker.lookup`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `host.broker.lookup` and propagates the provider result or rejection.
   * 输入 / Inputs: reference: ServiceRef<T>; optional: default=false
   * 输出 / Returns: `host.broker.lookup(instance, manifest, reference, optional)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const lookup = <T>(reference: ServiceRef<T>, optional = false) =>
    host.broker.lookup(instance, manifest, reference, optional);
  const context = {
    capabilities,
    execution: capabilities.execution,
    storage: capabilities.storage,
    networking: capabilities.networking,
    signal: instance.signal,
    instance: Object.freeze({
      identity: instance.identity,
      generation: instance.generation,
      version: instance.version,
      artifactDigest: instance.artifactDigest,
    }),
    vm: capabilities.vm,
    system: host.system.resolver(instance, manifest.systemDependencies),
    activity: Object.freeze({
      /**
       * 入口 / Entry: pluginContext.mutations.
       * 功能：向调用者提供 `host.operations.active` 的当前视图，不复制独立的业务状态。
       * Purpose: Exposes the current `host.operations.active` view rather than creating separate domain state.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `host.operations.active`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      get mutations() {
        return host.operations.active;
      },
      /**
       * 入口 / Entry: pluginContext.importing.
       * 功能：向调用者提供 `host.importing` 的当前视图，不复制独立的业务状态。
       * Purpose: Exposes the current `host.importing` view rather than creating separate domain state.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `host.importing`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      get importing() {
        return host.importing;
      },
      /**
       * 入口 / Entry: pluginContext.exclusive.
       * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `host.exclusive(name, work)` 供上层消费（`plugin-api.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; this entry produces `host.exclusive(name, work)` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
       * 处理：通过 `instance.check`, `host.exclusive` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `instance.check`, `host.exclusive`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: name: string; work: () => Promise<T>
       * 输出 / Returns: `host.exclusive(name, work)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      exclusive<T>(name: string, work: () => Promise<T>) {
        instance.check(undefined, true);
        return host.exclusive(name, work);
      },
    }),
    /**
     * 入口 / Entry: pluginContext.provide.
     * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `value` 供上层消费（`plugin-api.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; this entry produces `value` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `host.broker.register`, `host.provideService`, `host.broker.unwrap` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `host.broker.register`, `host.provideService`, `host.broker.unwrap`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: reference: ServiceRef<T>; value: Value
     * 输出 / Returns: Value；结果来自 / values from `value`.
     * 副作用 / Effects: `host.broker.register`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    provide<T, Value extends T>(reference: ServiceRef<T>, value: Value): Value {
      host.broker.register(instance, reference, value);
      host.provideService(reference.key, host.broker.unwrap(value));
      return value;
    },
    /**
     * 入口 / Entry: pluginContext.use.
     * 功能：把本层请求转交 `lookup`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `lookup` and propagates the provider result or rejection.
     * 输入 / Inputs: reference: ServiceRef<T>
     * 输出 / Returns: T；结果来自 / values from `lookup(reference) as T`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    use<T>(reference: ServiceRef<T>): T {
      return lookup(reference) as T;
    },
    /**
     * 入口 / Entry: pluginContext.optional.
     * 功能：把本层请求转交 `lookup`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `lookup` and propagates the provider result or rejection.
     * 输入 / Inputs: reference: ServiceRef<T>
     * 输出 / Returns: `lookup(reference, true)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    optional<T>(reference: ServiceRef<T>) {
      return lookup(reference, true);
    },
    /**
     * 入口 / Entry: pluginContext.require.
     * 功能：在定义插件声明和受限上下文中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`plugin-api.ts`）。
     * Purpose: Checks admission, input or resource ownership in `plugin-api.ts`; the calls and state transitions below complete the operation. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `instance.check`, `dependencies.has`, `host.require` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `instance.check`, `dependencies.has`, `host.require`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: id: string
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `id !== manifest.id && !dependencies.has(id)`; 异常 / errors `new Error('插件未声明依赖：' + id)`.
     */
    require(id: string) {
      instance.check(undefined, true);
      if (id !== manifest.id && !dependencies.has(id)) throw new Error('插件未声明依赖：' + id);
      host.require(id);
    },
    /**
     * 入口 / Entry: pluginContext.onDispose.
     * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`plugin-api.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; the calls and state transitions below complete the operation. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `instance.check`, `scope.add` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `instance.check`, `scope.add`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: disposer: () => void | Promise<void>
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `scope.add`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    onDispose: (disposer:
    /**
     * 中文功能：登记 pluginContext.context.onDispose.disposer 的资源退役能力，按返回类型允许同步完成或异步等待。
     * English: Registers resource-retirement capability for pluginContext.context.onDispose.disposer, allowing synchronous completion or asynchronous waiting according to its result type.
     * 所属 / Owner: pluginContext.context.onDispose.disposer.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void | Promise<void>`.
     */
    () => void | Promise<void>) => {
      instance.check(undefined, true);
      scope.add(disposer);
    },
    /**
     * 入口 / Entry: pluginContext.registerJobs.
     * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`plugin-api.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; the calls and state transitions below complete the operation. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `instance.check`, `host.registerPluginJobs`, `host.broker.unwrap` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `instance.check`, `host.registerPluginJobs`, `host.broker.unwrap`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: store: JobsV1; retry: (job: JobView) => Promise<unknown> | unknown
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `host.registerPluginJobs`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    registerJobs: (store: JobsV1, retry:
    /**
     * 中文功能：接收原 JobView 并发起该任务的重试，结果可同步或通过 Promise 交付。
     * English: Receives the original JobView to retry that job, returning synchronously or through a Promise.
     * 所属 / Owner: pluginContext.context.registerJobs.retry.
     * 输入 / Inputs: job: JobView.
     * 结果 / Result: `Promise<unknown> | unknown`.
     */
    (job: JobView) => Promise<unknown> | unknown) => {
      instance.check(undefined, true);
      host.registerPluginJobs(manifest.id, host.broker.unwrap(store) as JobsV1, retry);
    },
    /**
     * 入口 / Entry: pluginContext.jobViews.
     * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `structuredClone(host.jobStores().flatMap((store) => store.list()))` 供上层消费（`plugin-api.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; this entry produces `structuredClone(host.jobStores().flatMap((store) => store.list()))` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `instance.check`, `structuredClone`, `host.jobStores().flatMap`, `host.jobStores` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `instance.check`, `structuredClone`, `host.jobStores().flatMap`, `host.jobStores`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `structuredClone(host.jobStores().flatMap((store) => store.list()))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    jobViews: () => {
      instance.check('jobs', true);
      return structuredClone(host.jobStores().flatMap((store) => store.list()));
    },
    /**
     * 入口 / Entry: pluginContext.jobSources.
     * 功能：在定义插件声明和受限上下文中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.freeze( host .jobStores() .filter((store) => store !== own?.jobs) .map((store) => Object.freeze({ list: () => { instan…` 供上层消费（`plugin-api.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-api.ts`; this entry produces `Object.freeze( host .jobStores() .filter((store) => store !== own?.jobs) .map((store) => Object.freeze({ list: () => { instan…` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
     * 处理：通过 `instance.check`, `host.serviceValue`, `host.jobStores().filter().map`, `host.jobStores().filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `instance.check`, `host.serviceValue`, `host.jobStores().filter().map`, `host.jobStores().filter`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `Object.freeze( host .jobStores() .filter((store) => store !== own?.jobs) .map((store) => Object.freeze({ list: () => { instan…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    jobSources: () => {
      instance.check('jobs', true);
      const own = host.serviceValue('migration') as { jobs?: JobsV1 } | undefined;
      return Object.freeze(
        host
          .jobStores()
          .filter((store) => store !== own?.jobs)
          .map((store) =>
            Object.freeze({
              /**
               * 入口 / Entry: pluginContext.list.
               * 功能：在定义插件声明和受限上下文中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `structuredClone(store.list())` 供上层消费（`plugin-api.ts`）。
               * Purpose: Reads/verifies domain state and constructs a caller-facing result in `plugin-api.ts`; this entry produces `structuredClone(store.list())` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
               * 处理：通过 `instance.check`, `structuredClone`, `store.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
               * Processing: Coordinates its dependencies through `instance.check`, `structuredClone`, `store.list`; the branches below determine continuation, return or refusal.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `structuredClone(store.list())`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              list: () => {
                instance.check('jobs');
                return structuredClone(store.list());
              },
              /**
               * 入口 / Entry: pluginContext.flush.
               * 功能：把本层请求转交 `scope.run`，沿用该实现的结果与失败路径。
               * Purpose: Delegates this request to `scope.run` and propagates the provider result or rejection.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: `scope.run(() => withPluginAuthority( instance, () => store.flush(), () => instance.check('metadata'), ), )`.
               * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
               * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
               */
              flush: () =>
                scope.run(() =>
                  withPluginAuthority(
                    instance,
                    () => store.flush(),
                    () => instance.check('metadata'),
                  ),
                ),
            }),
          ),
      );
    },
  };
  for (const key of SERVICE_KEYS)
    Object.defineProperty(context, key, {
      enumerable: true,
      /**
       * 入口 / Entry: pluginContext.get.
       * 功能：在定义插件声明和受限上下文中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `lookup(serviceRef(owner, key), true)` 供上层消费（`plugin-api.ts`）。
       * Purpose: Reads/verifies domain state and constructs a caller-facing result in `plugin-api.ts`; this entry produces `lookup(serviceRef(owner, key), true)` for its caller. Module context: Declares plugin contracts and restricted context, checking dependencies and service-read grants before capability access.
       * 处理：通过 `readable.get`, `lookup`, `serviceRef` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `readable.get`, `lookup`, `serviceRef`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `lookup(serviceRef(owner, key), true)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `!owner`; 异常 / errors `new Error('插件未声明服务读取：' + key)`.
       */
      get() {
        const owner = readable.get(key);
        if (!owner) throw new Error('插件未声明服务读取：' + key);
        return lookup(serviceRef(owner, key), true);
      },
    });
  // Service descriptors above complete the statically known interface without copying provider objects.
  return Object.freeze(context) as unknown as PluginContext;
}

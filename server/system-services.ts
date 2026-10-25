/**
 * 模块职责：装配系统服务并提供受限解析器，协调就绪、实例归属和生命周期退休。
 * Module purpose: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
 */
import { PLUGINS } from '../shared/plugins.ts';
import { APP_VERSION } from '../shared/version.ts';
import { AppError } from '../shared/errors.ts';
import type { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { pluginCleanup, withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { serviceRef } from './service-ref.ts';
import type { PluginInstance } from './plugin-instance.ts';
import type { HostServiceResolver, HostServiceContracts } from './host-service-contracts.ts';
import { vmAccess } from './vm-access.ts';
import type { Machines } from './machines.ts';
import { ExecutionScope } from './execution-scope.ts';
import { resourceContext } from './host-runtime/context.ts';
import type { Jobs } from './jobs.ts';
import { systemArtifactDigest } from './plugin-artifact.ts';
import { ServiceLifecycle, type ServiceDefinition, type ServiceDependencyResolver } from './service-lifecycle.ts';
import { systemServiceContracts, type SystemServiceContracts } from './service-contracts.ts';
import { cleanupService } from './service-cleanup.ts';
import type { Features } from './features.ts';
import type { AuditLog } from './audit.ts';
import type { DelegatedProviderResolver } from './delegated-actions.ts';
import { serviceContracts } from './service-contracts.ts';
import { ImageAssets } from './image-assets.ts';
import { executionCleanupFactory, type SuiteExecutionCleanupFactory } from './suite-execution-cleanup.ts';

export interface SystemExternalDependencies {
  '@delegatedProviders': DelegatedProviderResolver;
  '@machines': Machines;
  '@plugins': Features;
  '@audit': AuditLog;
  '@pluginDirectory': PluginDirectory;
}
type DependencyContracts = SystemServiceContracts & SystemExternalDependencies;
type DependencyId = keyof DependencyContracts;
/**
 * 入口 / Entry: startupDiagnostic.
 * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `'配置 JSON 无法解析（SyntaxError）'` / `'配置未通过格式校验（ZodError）'` 供上层消费（`system-services.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `system-services.ts`; this entry produces `'配置 JSON 无法解析（SyntaxError）'` / `'配置未通过格式校验（ZodError）'` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
 * 处理：通过 `inline.test` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `error instanceof SyntaxError`; `error instanceof Error && error.name === 'ZodError'`.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `'配置 JSON 无法解析（SyntaxError）'`; `'配置未通过格式校验（ZodError）'`; `'服务初始化未完成' + (code && /^[A-Za-z0-9_]+$/.test(code) ? `（${code}）` : '')`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const startupDiagnostic = (error: unknown) => {
  if (error instanceof SyntaxError) return '配置 JSON 无法解析（SyntaxError）';
  if (error instanceof Error && error.name === 'ZodError') return '配置未通过格式校验（ZodError）';
  const code = error instanceof AppError ? error.code : error instanceof Error ? error.name : undefined;
  return '服务初始化未完成' + (code && /^[A-Za-z0-9_]+$/.test(code) ? `（${code}）` : '');
};
export type SystemFactoryResolver<K extends keyof SystemServiceContracts = keyof SystemServiceContracts,
  R extends readonly DependencyId[] = readonly DependencyId[], L extends readonly DependencyId[] = readonly DependencyId[],
  D extends readonly DependencyId[] = readonly DependencyId[]> = Readonly<{
    /**
     * 签名 / Signature: SystemFactoryResolver.get.
     * 功能：为装配系统服务并提供受限解析器声明 get 的输入与结果契约，所属容器为 SystemFactoryResolver。
     * Purpose: Declares the input/result contract for get in SystemFactoryResolver. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: id: I
     * 输出 / Returns: DependencyContracts[I].
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    get<I extends R[number]>(id: I): DependencyContracts[I];
    /**
     * 签名 / Signature: SystemFactoryResolver.late.
     * 功能：为装配系统服务并提供受限解析器声明 late 的输入与结果契约，所属容器为 SystemFactoryResolver。
     * Purpose: Declares the input/result contract for late in SystemFactoryResolver. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: id: I
     * 输出 / Returns: DependencyContracts[I].
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    late<I extends R[number] | L[number] | D[number]>(id: I): DependencyContracts[I];
    /**
     * 签名 / Signature: SystemFactoryResolver.self.
     * 功能：为装配系统服务并提供受限解析器声明 self 的输入与结果契约，所属容器为 SystemFactoryResolver。
     * Purpose: Declares the input/result contract for self in SystemFactoryResolver. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: SystemServiceContracts[K].
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    self(): SystemServiceContracts[K];
    /** 本体固定会话专用原资源工厂，不出现在任何插件公共服务视图中。 */
    executionCleanup(): SuiteExecutionCleanupFactory;
    vm: '@machines' extends R[number] ?
    /**
     * 中文功能：取得受限制实例访问能力的工厂依赖。
     * English: Factory dependency supplying the restricted VM-access capability.
     * 所属 / Owner: SystemFactoryResolver.vm.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `ReturnType<typeof vmAccess>`.
     */
    () => ReturnType<typeof vmAccess> : never;
  }>;
type SystemDefinition<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
  R extends readonly DependencyId[], L extends readonly DependencyId[], D extends readonly DependencyId[]> =
  Omit<ServiceDefinition<T>, 'id' | 'requires' | 'lateRequires' | 'disposeRequires' | 'create' | 'initialize' | 'dispose'> & {
    id: K; requires: R; lateRequires?: L; disposeRequires?: D;
    /** Local diagnostic only; never included in a public missing-service response. */
    startupRecovery?: string;
    /**
     * 签名 / Signature: SystemDefinition.create.
     * 功能：为装配系统服务并提供受限解析器声明 create 的输入与结果契约，所属容器为 SystemDefinition。
     * Purpose: Declares the input/result contract for create in SystemDefinition. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: dependencies: SystemFactoryResolver<K, R, L, D>
     * 输出 / Returns: T | Promise<T>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    create(dependencies: SystemFactoryResolver<K, R, L, D>): T | Promise<T>;
    /**
     * 签名 / Signature: SystemDefinition.initialize.
     * 功能：为装配系统服务并提供受限解析器声明 initialize 的输入与结果契约，所属容器为 SystemDefinition。
     * Purpose: Declares the input/result contract for initialize in SystemDefinition. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: value: T; dependencies: SystemFactoryResolver<K, R, L, D>
     * 输出 / Returns: void | Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    initialize(value: T, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
    /**
     * 签名 / Signature: SystemDefinition.dispose.
     * 功能：为装配系统服务并提供受限解析器声明 dispose 的输入与结果契约，所属容器为 SystemDefinition。
     * Purpose: Declares the input/result contract for dispose in SystemDefinition. Module responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
     * 输入 / Inputs: value: T | undefined; dependencies: SystemFactoryResolver<K, R, L, D>
     * 输出 / Returns: void | Promise<void>.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    dispose(value: T | undefined, dependencies: SystemFactoryResolver<K, R, L, D>): void | Promise<void>;
  };

/** Host providers share the same instance, broker and cleanup machinery. */
export class SystemServices {
  readonly broker: ServiceBroker;
  readonly caller: PluginInstance;
  private owned = new Map<string, { instance: PluginInstance; value: any }>();
  private vmPorts = new WeakMap<PluginInstance, ReturnType<typeof vmAccess>>();
  private startupRecovery = new Map<string, string>();
  readonly lifecycle = new ServiceLifecycle();
  /**
   * 入口 / Entry: SystemServices.constructor.
   * 功能：建立 SystemServices 的装配系统服务并提供受限解析器上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SystemServices context for this module's responsibility: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: directory: PluginDirectory
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `directory.publish`; 更新 / updates `this.broker`, `this.caller`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(readonly directory: PluginDirectory) {
    this.broker = new ServiceBroker(directory, PLUGINS);
    this.caller = directory.begin(
      'system',
      'operation-host',
      APP_VERSION,
      systemArtifactDigest('operation-host'),
    );
    directory.publish(this.caller);
    this.lifecycle.ready('@delegatedProviders', this.delegatedProviders());
  }
  /** 使用最近的实际消费插件及其声明，不能把委派宿主自身当作调用者。 */
  private delegatedProviders(): DelegatedProviderResolver {
    return adapter => {
      const context = resourceContext();
      const consumer = this.directory.all().find(item => item.identity === context?.serviceConsumerPluginInstanceId &&
        item.generation === context?.serviceConsumerPluginGeneration);
      if (!consumer || consumer.source !== 'official' || !['incident-actions', 'flow-connectors'].includes(consumer.pluginId))
        throw new AppError('委派缺少当前执行消费者', 403, 'DELEGATED_IDENTITY_STALE');
      const manifest = PLUGINS.find(item => item.id === consumer.pluginId);
      if (!manifest) throw new AppError('执行消费者未登记', 403, 'DELEGATED_IDENTITY_STALE');
      const ref = adapter === 'maintenance-cleanup'
        ? serviceRef('maintenance', 'maintenanceActions', serviceContracts.MaintenanceActions)
        : adapter === 'resilience-reconcile'
          ? serviceRef('resilience-runs', 'resilienceActions', serviceContracts.ResilienceActions)
          :adapter==='integration-run'&&consumer.pluginId==='flow-connectors'
            ?serviceRef('integration-runners','integrationActions',serviceContracts.IntegrationActions)
            :adapter==='knowledge-publish'&&consumer.pluginId==='flow-connectors'
              ?serviceRef('knowledge-publish','knowledgeActions',serviceContracts.KnowledgeActions):undefined;
      if (!ref) throw new AppError('委派适配器未登记', 400, 'DELEGATED_ADAPTER_DENIED');
      return this.broker.lookup(consumer, manifest, ref, true);
    };
  }
  /** Startup-only API. Public handles are published after the initializer succeeds. */
  /**
   * 入口 / Entry: SystemServices.register.
   * 功能：把系统服务声明适配到依赖生命周期和受限解析器，登记实例拥有者。
   * Purpose: Adapts system service definitions into dependency lifecycle/resolvers and registers instance ownership.
   * 设计：依赖只能读取显式声明的服务；初始化、提供者快照和退休按原对象核对，清理能力不恢复普通业务权限。
   * Design: Only declared dependencies resolve; initialization/provider snapshots/retirement retain original objects and cleanup does not restore business authority.
   * 输入 / Inputs: definition: SystemDefinition<K, T, R, L, D>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.startupRecovery.set`; `this.lifecycle.register`; 更新 / updates `definition`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  register<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(definition: SystemDefinition<K, T, R, L, D>) {
    definition = Object.freeze({ ...definition });
    if (definition.startupRecovery) this.startupRecovery.set(definition.id, definition.startupRecovery);
    /**
     * 入口 / Entry: SystemServices.register.resolver.
     * 功能：从当前输入或状态计算 `Object.freeze({ get: (id: R[number]) => lookup(id, false), late: (id: R[number] | L[number] | D[number]) => lookup(id, true),…`，供调用方后续验证或使用。
     * Purpose: Computes `Object.freeze({ get: (id: R[number]) => lookup(id, false), late: (id: R[number] | L[number] | D[number]) => lookup(id, true),…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: raw: ServiceDependencyResolver; instance: PluginInstance
     * 输出 / Returns: SystemFactoryResolver<K, R, L, D>；结果来自 / values from `Object.freeze({ get: (id: R[number]) => lookup(id, false), late: (id: R[number] | L[number] | D[number]) => lookup(id, true),…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    const resolver = (raw: ServiceDependencyResolver, instance: PluginInstance): SystemFactoryResolver<K, R, L, D> => {
      const originals = new Map<string, PluginInstance>();
      /**
       * 入口 / Entry: SystemServices.register.lookup.
       * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `cleanupService(value, systemServiceContracts[id], original, check)` / `value` 供上层消费（`SystemServices`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `cleanupService(value, systemServiceContracts[id], original, check)` / `value` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
       * 处理：通过 `raw.late`, `raw.get`, `pluginCleanup`, `id.startsWith` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `raw.late`, `raw.get`, `pluginCleanup`, `id.startsWith`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!originals.has(id)`; `id.startsWith('@')`.
       * 输入 / Inputs: id: DependencyId; late: boolean
       * 输出 / Returns: `cleanupService(value, systemServiceContracts[id], original, check)`; `value`; `this.broker.system(instance, id, [id])`.
       * 副作用 / Effects: `id.startsWith`; `originals.set`.
       * 拒绝 / Refusals: 条件 / conditions `pluginCleanup() === instance`; `id.startsWith('@') || ![...definition.requires, ...(definition.disposeRequires || [])].includes(id)`; `!provider || provider.value !== value`; 异常 / errors `new AppError('清理依赖未声明为原资源依赖：' + id, 403, 'SERVICE_DEPENDENCY_DENIED')`; `new AppError('原清理依赖不可用：' + id, 503, 'SERVICE_NOT_READY')`.
       */
      const lookup = (id: DependencyId, late: boolean) => {
        const value = late ? raw.late(id) : raw.get(id);
        if (pluginCleanup() === instance) {
          if (id.startsWith('@') || ![...definition.requires, ...(definition.disposeRequires || [])].includes(id))
            throw new AppError('清理依赖未声明为原资源依赖：' + id, 403, 'SERVICE_DEPENDENCY_DENIED');
          const provider = this.owned.get(id);
          if (!provider || provider.value !== value)
            throw new AppError('原清理依赖不可用：' + id, 503, 'SERVICE_NOT_READY');
          if (!originals.has(id)) originals.set(id, provider.instance);
          const original = originals.get(id)!;
          /**
           * 入口 / Entry: SystemServices.register.check.
           * 功能：在装配系统服务并提供受限解析器中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SystemServices`）。
           * Purpose: Checks admission, input or resource ownership in `SystemServices`; the calls and state transitions below complete the operation. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
           * 处理：通过 `pluginCleanup`, `inline.includes`, `this.directory.get`, `this.owned.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
           * Processing: Coordinates its dependencies through `pluginCleanup`, `inline.includes`, `this.directory.get`, `this.owned.get`; the branches below determine continuation, return or refusal.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 拒绝 / Refusals: 条件 / conditions `pluginCleanup() !== instance || !['draining', 'cleanup-pending'].includes(instance.phase) || this.directory.get('system', def…`; `(late ? raw.late(id) : raw.get(id)) !== value`; 异常 / errors `new AppError('原服务清理上下文或代次已变化', 403, 'PLUGIN_REVOKED')`; `new AppError('原清理依赖已变化：' + id, 403, 'PLUGIN_REVOKED')`.
           */
          const check = () => {
            if (pluginCleanup() !== instance || !['draining', 'cleanup-pending'].includes(instance.phase) ||
                this.directory.get('system', definition.id) !== instance ||
                this.directory.get('system', id) !== original || this.owned.get(id)?.instance !== original)
              throw new AppError('原服务清理上下文或代次已变化', 403, 'PLUGIN_REVOKED');
            if ((late ? raw.late(id) : raw.get(id)) !== value)
              throw new AppError('原清理依赖已变化：' + id, 403, 'PLUGIN_REVOKED');
            original.check('services');
          };
          return cleanupService(value, systemServiceContracts[id], original, check);
        }
        if (id.startsWith('@')) return value;
        const provider = this.directory.get('system', id);
        if (provider) {
          const original = originals.get(id);
          if (original && original !== provider)
            throw new AppError('服务依赖代次已变化：' + id, 403, 'PLUGIN_REVOKED');
          originals.set(id, provider);
        }
        return this.broker.system(instance, id, [id]);
      };
      return Object.freeze({
      /**
       * 入口 / Entry: SystemServices.register.get.
       * 功能：把本层请求转交 `lookup`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `lookup` and propagates the provider result or rejection.
       * 输入 / Inputs: id: R[number]
       * 输出 / Returns: `lookup(id, false)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      get: (id: R[number]) => lookup(id, false),
        /**
         * 入口 / Entry: SystemServices.register.late.
         * 功能：把本层请求转交 `lookup`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `lookup` and propagates the provider result or rejection.
         * 输入 / Inputs: id: R[number] | L[number] | D[number]
         * 输出 / Returns: `lookup(id, true)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        late: (id: R[number] | L[number] | D[number]) => lookup(id, true),
        /**
         * 入口 / Entry: SystemServices.register.self.
         * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.broker.system(instance, definition.id, [definition.id])!` 供上层消费（`SystemServices`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `this.broker.system(instance, definition.id, [definition.id])!` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
         * 处理：通过 `raw.self`, `this.broker.system` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `raw.self`, `this.broker.system`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.broker.system(instance, definition.id, [definition.id])!`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        self: () => { raw.self(); return this.broker.system(instance, definition.id, [definition.id])!; },
        /**
         * 入口 / Entry: SystemServices.register.vm.
         * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.vm(definition.id, raw.get<Machines>('@machines'))` 供上层消费（`SystemServices`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `this.vm(definition.id, raw.get<Machines>('@machines'))` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
         * 处理：通过 `this.vm`, `raw.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.vm`, `raw.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.vm(definition.id, raw.get<Machines>('@machines'))`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        vm: () => this.vm(definition.id, raw.get<Machines>('@machines')),
        executionCleanup: () => {
          if (!['browserSessions', 'databaseRehearsal', 'eventSessions', 'mediaTasks', 'learningToolSessions'].includes(definition.id) ||
            !definition.requires.includes('imageAssets') || !definition.requires.includes('@machines'))
            throw new AppError('固定会话清理依赖未声明', 403, 'SERVICE_DEPENDENCY_DENIED');
          const assets = raw.get<ImageAssets>('imageAssets'), machines = raw.get<Machines>('@machines'),
            provider = this.owned.get('imageAssets');
          if (!(assets instanceof ImageAssets) || !provider || provider.value !== assets)
            throw new AppError('原镜像服务不可用', 503, 'SERVICE_NOT_READY');
          const check = () => {
            if (this.directory.get('system', definition.id) !== instance || this.owned.get(definition.id)?.instance !== instance ||
              this.directory.get('system', 'imageAssets') !== provider.instance || this.owned.get('imageAssets')?.value !== assets)
              throw new AppError('原资源提供者已更换', 403, 'PLUGIN_REVOKED');
            // This assembly-only port can only reconstruct cleanup for the original ledger row.
            // Revoking ordinary services must not revoke reclamation of that original resource.
          };
          check();
          return executionCleanupFactory(definition.id, assets, machines, check);
        },
      }) as SystemFactoryResolver<K, R, L, D>;
    };
    this.lifecycle.register({
      ...definition,
      /**
       * 入口 / Entry: SystemServices.register.create.
       * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `entry.value` 供上层消费（`SystemServices`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `entry.value` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
       * 处理：通过 `this.owned.has`, `this.directory.begin`, `systemArtifactDigest`, `this.owned.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.owned.has`, `this.directory.begin`, `systemArtifactDigest`, `this.owned.set`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: raw
       * 输出 / Returns: `entry.value`.
       * 副作用 / Effects: `this.owned.set`; `instance.scope.add`; `startupDiagnostic`; 更新 / updates `entry.value`, `instance.error`, `instance.phase`.
       * 拒绝 / Refusals: 条件 / conditions `this.owned.has(definition.id)`; 异常 / errors `new AppError('系统服务已注册：' + definition.id, 409)`; `error`.
       * 失败处理：catch 分支执行 `instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);`; `instance.revoke();`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);`; `instance.revoke();`; these statements determine whether a failure is absorbed or rejected again.
       */
      create: async (raw) => {
        if (this.owned.has(definition.id)) throw new AppError('系统服务已注册：' + definition.id, 409);
        const instance = this.directory.begin(
          'system',
          definition.id,
          APP_VERSION,
          systemArtifactDigest(definition.id),
        );
        const entry: { instance: PluginInstance; value: T | undefined } = { instance, value: undefined };
        this.owned.set(definition.id, entry);
        const dependencies = resolver(raw, instance);
        instance.scope.add(() => Promise.resolve(definition.dispose(entry.value, dependencies)));
        try {
          entry.value = await withPluginAuthority(instance, () => definition.create(dependencies));
          return entry.value;
        } catch (error) {
          instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);
          instance.revoke();
          instance.phase = 'cleanup-pending';
          this.directory.changed();
          throw error;
        }
      },
      /**
       * 入口 / Entry: SystemServices.register.initialize.
       * 功能：在装配系统服务并提供受限解析器中，初始化并核对当前领域状态；处理结果记录到 `instance.activationMs`, `instance.error`, `instance.phase`（`SystemServices`）。
       * Purpose: Initializes and verifies current domain state in `SystemServices`; the outcome is recorded in `instance.activationMs`, `instance.error`, `instance.phase`. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
       * 处理：通过 `this.owned.get`, `performance.now`, `withPluginAuthority`, `this.broker.registerSystem` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.owned.get`, `performance.now`, `withPluginAuthority`, `this.broker.registerSystem`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: value; raw
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.broker.registerSystem`; `this.directory.publish`; `startupDiagnostic`; 更新 / updates `instance.activationMs`, `instance.error`, `instance.phase`.
       * 拒绝 / Refusals: 条件 / conditions `!this.lifecycle.accepting`; 异常 / errors `new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING')`; `error`.
       * 失败处理：catch 分支执行 `instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);`; `instance.revoke();`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);`; `instance.revoke();`; these statements determine whether a failure is absorbed or rejected again.
       */
      initialize: async (value, raw) => {
        const instance = this.owned.get(definition.id)!.instance;
        const started = performance.now();
        try {
          await withPluginAuthority(instance, () => definition.initialize(value, resolver(raw, instance)));
          if (!this.lifecycle.accepting) throw new AppError('初始化期间服务已关闭', 503, 'SERVICE_DRAINING');
          this.broker.registerSystem(instance, value);
          instance.activationMs = performance.now() - started;
          this.directory.publish(instance);
        } catch (error) {
          instance.error = definition.startup === 'degradable' ? startupDiagnostic(error) : String(error);
          instance.revoke();
          instance.phase = 'cleanup-pending';
          this.directory.changed();
          throw error;
        }
      },
      /**
       * 入口 / Entry: SystemServices.register.dispose.
       * 功能：把本层请求转交 `this.retire`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.retire` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.retire(definition.id)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      dispose: () => this.retire(definition.id),
    });
  }
  /**
   * 入口 / Entry: SystemServices.start.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.broker.system<SystemServiceContracts[K]>(this.caller, definition.id, [definition.id])!` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `this.broker.system<SystemServiceContracts[K]>(this.caller, definition.id, [definition.id])!` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.register`, `this.lifecycle.start`, `this.broker.system` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.register`, `this.lifecycle.start`, `this.broker.system`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: definition: SystemDefinition<K, T, R, L, D>
   * 输出 / Returns: Promise<SystemServiceContracts[K]>；结果来自 / values from `this.broker.system<SystemServiceContracts[K]>(this.caller, definition.id, [definition.id])!`.
   * 副作用 / Effects: `this.register`; `this.lifecycle.start`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async start<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(definition: SystemDefinition<K, T, R, L, D>): Promise<SystemServiceContracts[K]> {
    this.register(definition);
    await this.lifecycle.start<T>(definition.id);
    return this.broker.system<SystemServiceContracts[K]>(this.caller, definition.id, [definition.id])!;
  }
  /**
   * 入口 / Entry: SystemServices.startDegradable.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.require(definition.id)` / `undefined` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `this.require(definition.id)` / `undefined` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.register`, `this.lifecycle.startDegradable`, `this.require`, `this.recordUnavailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.register`, `this.lifecycle.startDegradable`, `this.require`, `this.recordUnavailable`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value !== undefined`.
   * 输入 / Inputs: definition: SystemDefinition<K, T, R, L, D> & { startup: 'degradable' }
   * 输出 / Returns: Promise<SystemServiceContracts[K] | undefined>；结果来自 / values from `this.require(definition.id)`; `undefined`.
   * 副作用 / Effects: `this.register`; `this.lifecycle.startDegradable`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async startDegradable<K extends keyof SystemServiceContracts, T extends SystemServiceContracts[K],
    const R extends readonly DependencyId[], const L extends readonly DependencyId[] = readonly [],
    const D extends readonly DependencyId[] = readonly []>(
    definition: SystemDefinition<K, T, R, L, D> & { startup: 'degradable' },
  ): Promise<SystemServiceContracts[K] | undefined> {
    this.register(definition);
    const value = await this.lifecycle.startDegradable<T>(definition.id);
    if (value !== undefined) return this.require(definition.id);
    await this.recordUnavailable(definition.id);
    return undefined;
  }
  /**
   * 入口 / Entry: SystemServices.recordUnavailable.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `void` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.lifecycle.view().find`, `this.lifecycle.view`, `this.directory.get`, `this.directory.begin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifecycle.view().find`, `this.lifecycle.view`, `this.directory.get`, `this.directory.begin`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!stage?.unavailable`; `!instance`; `instance.phase !== 'cleanup-pending'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.startupRecovery.get`; 更新 / updates `instance`, `instance.error`, `instance.phase`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async recordUnavailable(id: string) {
    const stage = this.lifecycle.view().find(entry => entry.id === id);
    if (!stage?.unavailable) return;
    let instance = this.directory.get('system', id);
    if (!instance) {
      instance = this.directory.begin('system', id, APP_VERSION, systemArtifactDigest(id));
      instance.revoke();
      await instance.scope.dispose();
    }
    const original = instance.error || stage.error || '依赖服务不可用';
    instance.error = `${original}。${this.startupRecovery.get(id) || '检查本服务配置与启动诊断'}；修复后重启 Sakura。`;
    if (instance.phase !== 'cleanup-pending') instance.phase = 'failed';
    this.directory.changed();
  }
  /**
   * 入口 / Entry: SystemServices.require.
   * 功能：在装配系统服务并提供受限解析器中，核对调用资格、输入或资源归属；本入口产生 `this.broker.system<SystemServiceContracts[K]>(this.caller, id, [id])!` 供上层消费（`SystemServices`）。
   * Purpose: Checks admission, input or resource ownership in `SystemServices`; this entry produces `this.broker.system<SystemServiceContracts[K]>(this.caller, id, [id])!` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.has`, `this.broker.system` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.has`, `this.broker.system`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: K
   * 输出 / Returns: SystemServiceContracts[K]；结果来自 / values from `this.broker.system<SystemServiceContracts[K]>(this.caller, id, [id])!`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.has(id)`; 异常 / errors `new AppError(`服务 ${id} 当前不可用；请查看插件管理中的启动诊断，修复后重启 Sakura。`, 503, 'SERVICE_UNAVAILABLE')`.
   */
  require<K extends keyof SystemServiceContracts>(id: K): SystemServiceContracts[K] {
    if (!this.has(id))
      throw new AppError(`服务 ${id} 当前不可用；请查看插件管理中的启动诊断，修复后重启 Sakura。`,
        503, 'SERVICE_UNAVAILABLE');
    return this.broker.system<SystemServiceContracts[K]>(this.caller, id, [id])!;
  }
  /**
   * 入口 / Entry: SystemServices.ready.
   * 功能：在装配系统服务并提供受限解析器中，读取或核对领域状态并构造调用方可消费的结果；完成下述调用及状态处理（`SystemServices`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SystemServices`; the calls and state transitions below complete the operation. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.lifecycle.ready` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifecycle.ready`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: K; value: SystemExternalDependencies[K]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  ready<K extends keyof SystemExternalDependencies>(id: K, value: SystemExternalDependencies[K]) {
    this.lifecycle.ready(id, value);
  }
  /**
   * 入口 / Entry: SystemServices.startAll.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; the calls and state transitions below complete the operation. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.lifecycle.startAll`, `this.lifecycle.view`, `this.recordUnavailable` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifecycle.startAll`, `this.lifecycle.view`, `this.recordUnavailable`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.unavailable`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lifecycle.startAll`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async startAll() {
    await this.lifecycle.startAll();
    for (const entry of this.lifecycle.view()) if (entry.unavailable) await this.recordUnavailable(entry.id);
  }
  /**
   * 入口 / Entry: SystemServices.vm.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `port` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `port` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.directory.get`, `this.vmPorts.get`, `vmAccess`, `this.vmPorts.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.get`, `this.vmPorts.get`, `vmAccess`, `this.vmPorts.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!port`.
   * 输入 / Inputs: id: string; machines: Machines
   * 输出 / Returns: `port`.
   * 副作用 / Effects: `this.vmPorts.set`; 更新 / updates `port`.
   * 拒绝 / Refusals: 条件 / conditions `!instance`; 异常 / errors `new Error('系统服务未建立实例：' + id)`.
   */
  vm(id: string, machines: Machines) {
    const instance = this.directory.get('system', id)!;
    if (!instance) throw new Error('系统服务未建立实例：' + id);
    let port = this.vmPorts.get(instance);
    if (!port) {
      port = vmAccess(machines, instance.scope, instance, (vmId, signal, work) =>
        ExecutionScope.run(
          {
            machines,
            vmId,
            projectId: resourceContext()?.projectId || 'default',
            owner: ExecutionScope.current()?.owner || instance.owner,
            signal,
            delegate: true,
          },
          work,
        ),
      );
      this.vmPorts.set(instance, port);
    }
    return port;
  }
  /**
   * 入口 / Entry: SystemServices.resolver.
   * 功能：从当前输入或状态计算 `Object.freeze({ optional: <K extends keyof HostServiceContracts>(id: K) => this.broker.system<HostServiceContracts[K]>(consum…`，供调用方后续验证或使用。
   * Purpose: Computes `Object.freeze({ optional: <K extends keyof HostServiceContracts>(id: K) => this.broker.system<HostServiceContracts[K]>(consum…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: consumer: PluginInstance; dependencies: readonly string[]
   * 输出 / Returns: HostServiceResolver；结果来自 / values from `Object.freeze({ optional: <K extends keyof HostServiceContracts>(id: K) => this.broker.system<HostServiceContracts[K]>(consum…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  resolver(consumer: PluginInstance, dependencies: readonly string[]): HostServiceResolver {
    return Object.freeze({
      /**
       * 入口 / Entry: SystemServices.resolver.optional.
       * 功能：把本层请求转交 `this.broker.system`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.broker.system` and propagates the provider result or rejection.
       * 输入 / Inputs: id: K
       * 输出 / Returns: `this.broker.system<HostServiceContracts[K]>(consumer, id, dependencies)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      optional: <K extends keyof HostServiceContracts>(id: K) =>
        this.broker.system<HostServiceContracts[K]>(consumer, id, dependencies),
    });
  }
  /**
   * 入口 / Entry: SystemServices.official.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `undefined` / `this.broker.lookup( this.caller, { ...provider, id: this.caller.pluginId, requires: [], optional: PLUGINS.map((item) => ({ id…` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `undefined` / `this.broker.lookup( this.caller, { ...provider, id: this.caller.pluginId, requires: [], optional: PLUGINS.map((item) => ({ id…` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `PLUGINS.find`, `this.broker.lookup`, `PLUGINS.map`, `serviceRef` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `PLUGINS.find`, `this.broker.lookup`, `PLUGINS.map`, `serviceRef`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!provider`.
   * 输入 / Inputs: key: string
   * 输出 / Returns: T | undefined；结果来自 / values from `undefined`; `this.broker.lookup( this.caller, { ...provider, id: this.caller.pluginId, requires: [], optional: PLUGINS.map((item) => ({ id…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  official<T>(key: string): T | undefined {
    const provider = PLUGINS.find((item) => item.services.includes(key));
    if (!provider) return undefined;
    return this.broker.lookup(
      this.caller,
      {
        ...provider,
        id: this.caller.pluginId,
        requires: [],
        optional: PLUGINS.map((item) => ({ id: item.id, version: item.version })),
      },
      serviceRef<T>(provider.id, key),
      true,
    );
  }
  /**
   * 入口 / Entry: SystemServices.jobStores.
   * 功能：在装配系统服务并提供受限解析器中，执行此领域的具体处理步骤并返回其结果；本入口产生 `[...this.owned.values()].flatMap(entry => entry.instance.phase === 'running' && entry.value?.jobs ? [entry.value.jobs as Jobs…` 供上层消费（`SystemServices`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SystemServices`; this entry produces `[...this.owned.values()].flatMap(entry => entry.instance.phase === 'running' && entry.value?.jobs ? [entry.value.jobs as Jobs…` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `inline.flatMap`, `this.owned.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.flatMap`, `this.owned.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Jobs[]；结果来自 / values from `[...this.owned.values()].flatMap(entry => entry.instance.phase === 'running' && entry.value?.jobs ? [entry.value.jobs as Jobs…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  jobStores(): Jobs[] {
    return [...this.owned.values()].flatMap(entry =>
      entry.instance.phase === 'running' && entry.value?.jobs ? [entry.value.jobs as Jobs] : []);
  }
  /**
   * 入口 / Entry: SystemServices.has.
   * 功能：从当前输入或状态计算 `this.owned.get(id)?.instance.phase === 'running'`，供调用方后续验证或使用。
   * Purpose: Computes `this.owned.get(id)?.instance.phase === 'running'` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.owned.get(id)?.instance.phase === 'running'`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  has(id: string) {
    return this.owned.get(id)?.instance.phase === 'running';
  }
  /**
   * 入口 / Entry: SystemServices.ownsInstance.
   * 功能：从当前输入或状态计算 `instance === this.caller || this.owned.get(instance.pluginId)?.instance === instance`，供调用方后续验证或使用。
   * Purpose: Computes `instance === this.caller || this.owned.get(instance.pluginId)?.instance === instance` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: instance: PluginInstance
   * 输出 / Returns: `instance === this.caller || this.owned.get(instance.pluginId)?.instance === instance`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  ownsInstance(instance: PluginInstance) {
    return instance === this.caller || this.owned.get(instance.pluginId)?.instance === instance;
  }
  /**
   * 入口 / Entry: SystemServices.retire.
   * 功能：在装配系统服务并提供受限解析器中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`SystemServices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SystemServices`; this entry produces `void` for its caller. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.owned.get`, `instance.revoke`, `this.directory.changed`, `instance.scope.dispose` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.owned.get`, `instance.revoke`, `this.directory.changed`, `instance.scope.dispose`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.owned.delete`; 更新 / updates `instance.phase`, `instance.error`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 收尾：退出 try 区域时始终执行 `this.directory.changed();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.directory.changed();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `instance.phase = 'cleanup-pending';`; `instance.error = originalError ? `${originalError}；清理待确认：${String(error)}` : String(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `instance.phase = 'cleanup-pending';`; `instance.error = originalError ? `${originalError}；清理待确认：${String(error)}` : String(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async retire(id: string) {
    const entry = this.owned.get(id);
    if (!entry) return;
    const { instance } = entry;
    const originalError = instance.error;
    instance.revoke();
    this.directory.changed();
    try {
      await instance.scope.dispose((dispose) => Promise.resolve(withPluginCleanup(instance, dispose)));
      instance.phase = 'inactive';
      this.broker.remove(instance);
      this.owned.delete(id);
      this.lifecycle.confirmDisposed(id);
    } catch (error) {
      instance.phase = 'cleanup-pending';
      instance.error = originalError ? `${originalError}；清理待确认：${String(error)}` : String(error);
      throw error;
    } finally {
      this.directory.changed();
    }
  }
  /**
   * 入口 / Entry: SystemServices.close.
   * 功能：在装配系统服务并提供受限解析器中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.caller.phase`, `this.caller.error`（`SystemServices`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SystemServices`; the outcome is recorded in `this.caller.phase`, `this.caller.error`. Module context: Assembles system services and limited resolvers, coordinating readiness, instance ownership and retirement.
   * 处理：通过 `this.lifecycle.close`, `failures.push`, `this.lifecycle.view().map`, `this.lifecycle.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.lifecycle.close`, `failures.push`, `this.lifecycle.view().map`, `this.lifecycle.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.lifecycle.close`; `failures.push`; 更新 / updates `this.caller.phase`, `this.caller.error`.
   * 拒绝 / Refusals: 条件 / conditions `failures.length`; 异常 / errors `new AggregateError(failures, '系统服务清理未完成')`; `error`.
   * 收尾：退出 try 区域时始终执行 `this.directory.changed();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.directory.changed();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `failures.push(error);`; `this.caller.phase = 'cleanup-pending';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `failures.push(error);`; `this.caller.phase = 'cleanup-pending';`; these statements determine whether a failure is absorbed or rejected again.
   */
  async close() {
    const failures: unknown[] = [];
    try {
      await this.lifecycle.close();
    } catch (error) {
      failures.push(error);
    }
    const managed = new Set(this.lifecycle.view().map((entry) => entry.id));
    for (const id of [...this.owned.keys()].reverse().filter((id) => !managed.has(id))) {
      try {
        await this.retire(id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, '系统服务清理未完成');
    this.caller.revoke();
    try {
      await this.caller.scope.dispose();
      this.caller.phase = 'inactive';
    } catch (error) {
      this.caller.phase = 'cleanup-pending'; this.caller.error = String(error);
      throw error;
    } finally { this.directory.changed(); }
  }
}

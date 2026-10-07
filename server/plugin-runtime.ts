/**
 * 模块职责：装配插件服务、任务与终端能力，执行配置校验并协调卸载及原实例恢复。
 * Module purpose: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { APP_VERSION } from '../shared/version.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { pluginArtifactDigest, systemArtifactDigest } from './plugin-artifact.ts';
import { PluginDirectory } from './plugin-directory.ts';
import { ServiceBroker } from './service-broker.ts';
import { withPluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import type { JobView } from '../shared/contracts/jobs.ts';
import { type VMConfig } from '../shared/contracts/vm.ts';
import { AppError } from '../shared/errors.ts';

import type { Machines } from './machines.ts';
import { OperationTracker, requestScope } from './operation-scope.ts';
import { currentOperation } from './operation-gateway.ts';
import { sendJson } from './http-response.ts';
import { noteOperationBusinessResult } from './operation-results.ts';
import { withResourceContext } from './host-runtime/index.ts';
import { SERVICE_KEYS, type PluginServices } from './plugin-services.ts';
import { TerminalBackend, type TerminalService } from './terminal-backend.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { SystemServices } from './system-services.ts';

import { resolvePlugins } from '../shared/plugin-selection.ts';
import { emptySelection, PLUGINS } from '../shared/plugins.ts';
import { pluginContext, type PluginContext } from './plugin-api.ts';
import { PluginScope, withinDeadline } from './plugin-scope.ts';
import {
  loaders,
  matchOperationPath,
  routeContribution,
  socketOwner,
  validateRegistry,
  type PluginModule,
} from './plugins/registry.ts';

/** Optional plugin host. No plugin services are constructed until explicitly selected. */
export interface PluginRuntime extends PluginServices {}
export class PluginRuntime {
  readonly broker: ServiceBroker;
  /**
   * 入口 / Entry: PluginRuntime.enabled.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `new Set( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase === 'running') .map((ite…` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `new Set( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase === 'running') .map((ite…` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ReadonlySet<string>；结果来自 / values from `new Set( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase === 'running') .map((ite…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get enabled(): ReadonlySet<string> {
    return new Set(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.phase === 'running')
        .map((item) => item.pluginId),
    );
  }
  /**
   * 入口 / Entry: PluginRuntime.errors.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.error) .map((item) …` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.error) .map((item) …` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Record<string, string>；结果来自 / values from `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.error) .map((item) …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get errors(): Record<string, string> {
    return Object.fromEntries(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.error)
        .map((item) => [item.pluginId, item.error!]),
    );
  }
  /**
   * 入口 / Entry: PluginRuntime.lifecycle.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase !== 'inactive…` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase !== 'inactive…` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.view().instances.filter().map`, `this.directory.view().instances.filter`, `this.directory.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }>；结果来自 / values from `Object.fromEntries( this.directory .view() .instances.filter((item) => item.source === 'official' && item.phase !== 'inactive…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get lifecycle(): Record<string, { phase: 'active' | 'failed' | 'skipped'; activationMs: number }> {
    return Object.fromEntries(
      this.directory
        .view()
        .instances.filter((item) => item.source === 'official' && item.phase !== 'inactive')
        .map((item) => [
          item.pluginId,
          {
            phase: item.phase === 'running' ? 'active' : item.phase === 'skipped' ? 'skipped' : 'failed',
            activationMs: item.activationMs,
          },
        ]),
    );
  }
  private modules = new Map<string, PluginModule>();
  private contexts = new Map<string, PluginContext>();
  private scopes = new Map<string, PluginScope>();
  private services = new Map<string, unknown>();
  private pluginJobs = new Map<
    JobsV1,
    { owner: string;
    /**
     * 签名 / Signature: PluginRuntime.retry.
     * 功能：为装配插件服务、任务与终端能力声明 retry 的输入与结果契约，所属容器为 PluginRuntime。
     * Purpose: Declares the input/result contract for retry in PluginRuntime. Module responsibility: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
     * 输入 / Inputs: job: JobView
     * 输出 / Returns: Promise<unknown> | unknown.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    retry: (job: JobView) => Promise<unknown> | unknown }
  >();
  readonly operations = new OperationTracker();
  /**
   * 入口 / Entry: PluginRuntime.mutations.
   * 功能：向调用者提供 `this.operations.active` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.operations.active` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.operations.active`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get mutations() {
    return this.operations.active;
  }
  /**
   * 入口 / Entry: PluginRuntime.vm.
   * 功能：向调用者提供 `this.machines` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.machines` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.machines`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get vm() {
    return this.machines;
  }
  /**
   * 入口 / Entry: PluginRuntime.mutations.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.operations.active`（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; the outcome is recorded in `this.operations.active`. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 输入 / Inputs: value: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.operations.active`.
   */
  set mutations(value: number) {
    this.operations.active = value;
  }
  importing = false;
  private exclusives = new Set<string>();
  /**
   * 入口 / Entry: PluginRuntime.exclusive.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await work()` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `await work()` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.exclusives.has`, `this.exclusives.add`, `work`, `this.exclusives.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.exclusives.has`, `this.exclusives.add`, `work`, `this.exclusives.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: name: string; work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `await work()`.
   * 副作用 / Effects: `this.exclusives.add`; `this.exclusives.delete`; 更新 / updates `this.importing`.
   * 拒绝 / Refusals: 条件 / conditions `this.exclusives.has(name)`; 异常 / errors `new AppError('另一项操作仍在进行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.exclusives.delete(name);`; `this.importing = this.exclusives.has('import');`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.exclusives.delete(name);`; `this.importing = this.exclusives.has('import');`; these steps also apply to exceptional exits.
   */
  async exclusive<T>(name: string, work: () => Promise<T>): Promise<T> {
    if (this.exclusives.has(name)) throw new AppError('另一项操作仍在进行', 409);
    this.exclusives.add(name);
    this.importing = this.exclusives.has('import');
    try {
      return await work();
    } finally {
      this.exclusives.delete(name);
      this.importing = this.exclusives.has('import');
    }
  }
  private closed = false;
  private closing?: Promise<void>;
  private active = new Map<AbortController, Promise<boolean>>();
  private cleanupPending = new Set<string>();
  private ownsSystem = false;
  private terminalBackend: TerminalBackend;
  private terminalInstance: PluginInstance;
  /**
   * 入口 / Entry: PluginRuntime.terminalHandle.
   * 功能：把本层请求转交 `this.terminalBackend.handle`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.terminalBackend.handle` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: TerminalService；结果来自 / values from `this.terminalBackend.handle()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  terminalHandle(): TerminalService {
    return this.terminalBackend.handle();
  }
  /**
   * 入口 / Entry: PluginRuntime.recoverProvider.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `void` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.directory.all().find`, `this.directory.all`, `this.modules.has`, `this.unload` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.all().find`, `this.directory.all`, `this.modules.has`, `this.unload`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance.source === 'official' && this.modules.has(instance.pluginId)`.
   * 输入 / Inputs: identity: string; generation: string; artifactDigest: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `instance.phase`, `instance.error`.
   * 拒绝 / Refusals: 条件 / conditions `!instance || instance.phase !== 'cleanup-pending' || !(instance === this.terminalInstance || instance.source === 'official')`; 异常 / errors `new AppError('原插件恢复实例不可用', 409, 'RECOVERY_STALE')`; `error`.
   * 收尾：退出 try 区域时始终执行 `this.directory.changed();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.directory.changed();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `instance.phase = 'cleanup-pending';`; `instance.error = String(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `instance.phase = 'cleanup-pending';`; `instance.error = String(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async recoverProvider(identity: string, generation: string, artifactDigest: string) {
    const instance = this.directory.all().find(item => item.identity === identity && item.generation === generation && item.artifactDigest === artifactDigest);
    if (!instance || instance.phase !== 'cleanup-pending' ||
        !(instance === this.terminalInstance || instance.source === 'official'))
      throw new AppError('原插件恢复实例不可用', 409, 'RECOVERY_STALE');
    if (instance.source === 'official' && this.modules.has(instance.pluginId)) {
      await this.unload(instance.pluginId);
      return;
    }
    // Includes the original terminal scope and activation failures before module publication.
    instance.revoke(); this.directory.changed();
    try {
      await instance.scope.dispose(dispose => Promise.resolve(withPluginCleanup(instance, dispose)));
      this.broker.remove(instance);
      instance.phase = 'inactive';
    } catch (error) {
      instance.phase = 'cleanup-pending'; instance.error = String(error);
      throw error;
    } finally { this.directory.changed(); }
  }
  /**
   * 入口 / Entry: PluginRuntime.pluginResources.
   * 功能：从当前输入或状态计算 `[...this.scopes].map(([id, scope]) => ({ id, cleanupPending: this.cleanupPending.has(id), ...scope.diagnostics(), }))`，供调用方后续验证或使用。
   * Purpose: Computes `[...this.scopes].map(([id, scope]) => ({ id, cleanupPending: this.cleanupPending.has(id), ...scope.diagnostics(), }))` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.scopes].map(([id, scope]) => ({ id, cleanupPending: this.cleanupPending.has(id), ...scope.diagnostics(), }))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  pluginResources() {
    return [...this.scopes].map(([id, scope]) => ({
      id,
      cleanupPending: this.cleanupPending.has(id),
      ...scope.diagnostics(),
    }));
  }
  /**
   * 入口 / Entry: PluginRuntime.constructor.
   * 功能：建立 PluginRuntime 的装配插件服务、任务与终端能力上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PluginRuntime context for this module's responsibility: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; directory: default=new PluginDirectory(); system: default=new SystemServices(directory)
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `directory.publish`; 更新 / updates `this.broker`, `this.terminalInstance`, `this.terminalBackend`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private constructor(
    public machines: Machines,
    readonly directory = new PluginDirectory(),
    readonly system = new SystemServices(directory),
  ) {
    this.broker = system.broker;
    this.terminalInstance = directory.begin(
      'system',
      'terminal-backend',
      APP_VERSION,
      systemArtifactDigest('terminal-backend'),
    );
    this.terminalBackend = new TerminalBackend(
      machines,
      this.terminalInstance,
      {
        /**
         * 入口 / Entry: PluginRuntime.constructor.secrets.
         * 功能：向调用者提供 `host.secrets` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `host.secrets` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `host.secrets`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get secrets() {
          return host.secrets;
        },
        /**
         * 入口 / Entry: PluginRuntime.constructor.network.
         * 功能：向调用者提供 `host.network` 的当前视图，不复制独立的业务状态。
         * Purpose: Exposes the current `host.network` view rather than creating separate domain state.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `host.network`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         */
        get network() {
          return host.network;
        },
      },
      this.broker,
      this.system.caller,
    );
    const host = this;
    directory.publish(this.terminalInstance);
    for (const key of SERVICE_KEYS)
      Object.defineProperty(this, key, {
        configurable: true,
        enumerable: true,
        /**
         * 入口 / Entry: PluginRuntime.constructor.get.
         * 功能：把本层请求转交 `this.system.official`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.system.official` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.system.official(key)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        get: () => this.system.official(key),
      });
  }
  /**
   * 入口 / Entry: PluginRuntime.serviceValue.
   * 功能：把本层请求转交 `this.services.get`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.services.get` and propagates the provider result or rejection.
   * 输入 / Inputs: key: string
   * 输出 / Returns: T | undefined；结果来自 / values from `this.services.get(key) as T | undefined`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  serviceValue<T = unknown>(key: string): T | undefined {
    return this.services.get(key) as T | undefined;
  }
  /**
   * 入口 / Entry: PluginRuntime.provideService.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; the calls and state transitions below complete the operation. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.serviceValue`, `this.services.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serviceValue`, `this.services.set`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string; value: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.services.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.serviceValue(key) !== undefined`; 异常 / errors `new Error(`插件服务已注册：${key}`)`.
   */
  provideService(key: string, value: unknown) {
    if (this.serviceValue(key) !== undefined) throw new Error(`插件服务已注册：${key}`);
    this.services.set(key, value);
  }
  /**
   * 入口 / Entry: PluginRuntime.registerPluginJobs.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; the calls and state transitions below complete the operation. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `PLUGINS.find`, `manifest.services.some`, `this.pluginJobs.has`, `this.pluginJobs.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `PLUGINS.find`, `manifest.services.some`, `this.pluginJobs.has`, `this.pluginJobs.set`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `scope`.
   * 输入 / Inputs: owner: string; store: JobsV1; retry: (job: JobView) => Promise<unknown> | unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.pluginJobs.set`; `scope.signal.addEventListener`; `scope.add`.
   * 拒绝 / Refusals: 条件 / conditions `!manifest?.services.some((key) => { const service = this.serviceValue(key) as { jobs?: JobsV1 } | undefined; return service =…`; `this.pluginJobs.has(store)`; 异常 / errors `new Error(`插件 ${owner} 只能注册自有任务存储`)`; `new Error(`任务存储已注册：${owner}`)`.
   */
  registerPluginJobs(owner: string, store: JobsV1, retry: (job: JobView) => Promise<unknown> | unknown) {
    const manifest = PLUGINS.find((item) => item.id === owner);
    if (
      !manifest?.services.some((key) => {
        const service = this.serviceValue(key) as { jobs?: JobsV1 } | undefined;
        return service === store || service?.jobs === store;
      })
    )
      throw new Error(`插件 ${owner} 只能注册自有任务存储`);
    if (this.pluginJobs.has(store)) throw new Error(`任务存储已注册：${owner}`);
    this.pluginJobs.set(store, { owner, retry });
    this.directory.get('official', owner)?.contribute('job-retry', owner);
    const scope = this.scopes.get(owner);
    if (scope) {
      /**
       * 入口 / Entry: PluginRuntime.registerPluginJobs.cancel.
       * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; the calls and state transitions below complete the operation. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
       * 处理：通过 `store.list`, `store.cancel` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `store.list`, `store.cancel`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `job.status === 'running'`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => {
        for (const job of store.list()) if (job.status === 'running') store.cancel(job.id!);
      };
      scope.signal.addEventListener('abort', cancel, { once: true });
      scope.add(async () => {
        await store.close();
        if (store.list().some((job) => job.admission === 'cleanup-pending'))
          throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
        scope.signal.removeEventListener('abort', cancel);
      });
    }
  }
  /**
   * 入口 / Entry: PluginRuntime.retryHandler.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `( registration && instance && ((job: JobView) => { const check = () => { instance.check('jobs'); if (this.directory.get('offi…` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `( registration && instance && ((job: JobView) => { const check = () => { instance.check('jobs'); if (this.directory.get('offi…` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.pluginJobs.get`, `this.directory.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pluginJobs.get`, `this.directory.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: store: JobsV1
   * 输出 / Returns: `( registration && instance && ((job: JobView) => { const check = () => { instance.check('jobs'); if (this.directory.get('offi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retryHandler(store: JobsV1) {
    const registration = this.pluginJobs.get(store);
    const instance = registration && this.directory.get('official', registration.owner);
    /**
     * 入口 / Entry: PluginRuntime.retryHandler.callback@216.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: job: JobView
     * 输出 / Returns: `instance.scope.run(() => withPluginAuthority(instance, () => registration.retry(job), check))`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `(current || job).admission === 'cleanup-pending' && !(current || job).cleanupResolvedAt`; 异常 / errors `new AppError('资源清理尚未确认，请先执行领域恢复', 409, 'PLUGIN_CLEANUP_PENDING')`.
     */
    return (
      registration &&
      instance &&
      ((job: JobView) => {
        /**
         * 入口 / Entry: PluginRuntime.retryHandler.check.
         * 功能：在装配插件服务、任务与终端能力中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`PluginRuntime`）。
         * Purpose: Checks admission, input or resource ownership in `PluginRuntime`; the calls and state transitions below complete the operation. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
         * 处理：通过 `instance.check`, `this.directory.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `instance.check`, `this.directory.get`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 拒绝 / Refusals: 条件 / conditions `this.directory.get('official', registration.owner) !== instance`; 异常 / errors `new AppError('插件任务重试代次已改变', 403, 'PLUGIN_REVOKED')`.
         */
        const check = () => {
          instance.check('jobs');
          if (this.directory.get('official', registration.owner) !== instance)
            throw new AppError('插件任务重试代次已改变', 403, 'PLUGIN_REVOKED');
        };
        check();
        const current = job.id ? store.get(job.id) : undefined;
        if ((current || job).admission === 'cleanup-pending' && !(current || job).cleanupResolvedAt)
          throw new AppError('资源清理尚未确认，请先执行领域恢复', 409, 'PLUGIN_CLEANUP_PENDING');
        return instance.scope.run(() => withPluginAuthority(instance, () => registration.retry(job), check));
      })
    );
  }
  /**
   * 入口 / Entry: PluginRuntime.create.
   * 功能：按插件选择与依赖装配模块，核对 manifest、实际路由和公共服务后激活实例。
   * Purpose: Assembles selected plugin modules/dependencies and activates instances after manifest/route/public-service checks.
   * 设计：声明与实现必须完全一致，实例代次和产物摘要先固定；激活失败进入原实例卸载，未确认清理阻止替换。
   * Design: Declarations must match implementations; generations/digests are pinned and activation failure unloads the original instance without replacing pending cleanup.
   * 输入 / Inputs: machines: Machines; selected: string[] default=[]; rolloutAllowed: (pluginId: string) => boolean default=() => true; directory: default=new PluginDirectory(); system: SystemServices optional
   * 输出 / Returns: `host`.
   * 副作用 / Effects: `directory.setDesired`; `host.scopes.set`; `scope.add`; `host.contexts.set`; `host.modules.set`; 更新 / updates `host.ownsSystem`, `instance.error`, `instance.phase`, `module`.
   * 拒绝 / Refusals: 条件 / conditions `!isDeepStrictEqual(module.manifest, manifest) || typeof module.activate !== 'function' || typeof module.route !== 'function'`; `!isDeepStrictEqual(declaredOperations, implementedOperations) || !isDeepStrictEqual(declaredHttpHandlers, implementedHttpHand…`; `host.serviceValue(key) === undefined`; 异常 / errors `new Error(`插件入口与声明不一致：${id}`)`; `new Error(`插件操作实现与声明不一致：${id}`)`.
   * 失败处理：catch 分支执行 `instance.error = (error as Error).message;`; `instance.activationMs = Math.round(performance.now() - startedAt);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `instance.error = (error as Error).message;`; `instance.activationMs = Math.round(performance.now() - startedAt);`; these statements determine whether a failure is absorbed or rejected again.
   */
  static async create(
    machines: Machines,
    selected: string[] = [],
    rolloutAllowed: (pluginId: string) => boolean = () => true,
    directory = new PluginDirectory(),
    system?: SystemServices,
  ) {
    validateRegistry();
    const host = new PluginRuntime(machines, directory, system);
    host.ownsSystem = !system;
    directory.setDesired('official', selected);
    for (const id of resolvePlugins({ ...emptySelection(), plugins: selected })) {
      const startedAt = performance.now();
      const manifest = PLUGINS.find((item) => item.id === id)!;
      const instance = directory.begin(
        'official',
        id,
        manifest.version,
        await pluginArtifactDigest(manifest),
      );
      instance.declareManaged(manifest.contributes.managed);
      if (!rolloutAllowed(id)) {
        instance.error = '当前主机未命中功能灰度策略；请在系统设置中调整并重启 Sakura 服务';
        instance.phase = 'skipped';
        await instance.scope.dispose();
        directory.changed();
        continue;
      }
      if (manifest.requires.some((dependency) => !host.enabled.has(dependency.id))) {
        instance.error = '依赖插件启动失败';
        instance.phase = 'skipped';
        await instance.scope.dispose();
        directory.changed();
        continue;
      }
      let module: PluginModule | undefined;
      let started = false;
      try {
        module = await loaders[id]();
        if (
          !isDeepStrictEqual(module.manifest, manifest) ||
          typeof module.activate !== 'function' ||
          typeof module.route !== 'function'
        )
          throw new Error(`插件入口与声明不一致：${id}`);
        const declaredOperations = manifest.contributes.operations.map((item) => item.id).sort();
        const implementedOperations = Object.keys(module.operations || {}).sort();
        const declaredHttpHandlers = manifest.contributes.routes.filter(item => item.handler === 'route').map(item => item.id).sort();
        const implementedHttpHandlers = Object.keys(module.httpHandlers || {}).sort();
        if (
          !isDeepStrictEqual(declaredOperations, implementedOperations) ||
          !isDeepStrictEqual(declaredHttpHandlers, implementedHttpHandlers) ||
          implementedHttpHandlers.some(key => typeof module!.httpHandlers![key] !== 'function') ||
          implementedOperations.some(
            (key) =>
              typeof module!.operations![key].execute !== 'function' ||
              typeof module!.operations![key].response?.parse !== 'function',
          )
        )
          throw new Error(`插件操作实现与声明不一致：${id}`);
        const scope = instance.scope;
        host.scopes.set(id, scope);
        // Register before activation so partial construction is still owned after activation fails.
        const closedServices = new Set<unknown>();
        for (const key of manifest.services)
          /**
           * 入口 / Entry: PluginRuntime.create.callback@295.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（scope.add）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (scope.add).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `void`.
           * 副作用 / Effects: `closedServices.has`; `service.close`; `service.jobs.close`; `closedServices.add`.
           * 拒绝 / Refusals: 条件 / conditions `service.jobs?.list().some((job) => job.admission === 'cleanup-pending')`; 异常 / errors `new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING')`.
           */
          scope.add(async () => {
            const service = host.serviceValue(key) as
              {
              /**
               * 签名 / Signature: PluginRuntime.create.close.
               * 功能：为装配插件服务、任务与终端能力声明 close 的输入与结果契约，所属容器为 PluginRuntime.create。
               * Purpose: Declares the input/result contract for close in PluginRuntime.create. Module responsibility: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
               * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
               * 输出 / Returns: Promise<void> | void.
               * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
               * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
               */
              close?: () => Promise<void> | void; jobs?: JobsV1 } | undefined;
            if (!service || closedServices.has(service)) return;
            if (service.close) await service.close();
            else if (service.jobs) await service.jobs.close();
            if (service.jobs?.list().some((job) => job.admission === 'cleanup-pending'))
              throw new AppError('插件任务仍有资源等待领域恢复', 503, 'PLUGIN_CLEANUP_PENDING');
            closedServices.add(service);
          });
        const context = pluginContext(host, manifest, PLUGINS, instance);
        host.contexts.set(id, context);
        if (module.deactivate) scope.add(() => module!.deactivate!(context));
        host.modules.set(id, module);
        started = true;
        await withinDeadline(
          scope.run(() => withPluginAuthority(instance, () => module!.activate(context))),
          manifest.lifecycle.activateMs,
          `${id} 激活`,
          () => scope.abort(),
        );
        for (const key of manifest.services)
          if (host.serviceValue(key) === undefined) throw new Error(`插件未注册声明的服务：${id}.${key}`);
        host.modules.set(id, module);
        for (const [kind, targets] of Object.entries(manifest.contributes)) {
          if (kind === 'managed' || kind === 'operations') continue;
          const name =
            (
              {
                sockets: 'socket',
                pages: 'page',
                tabs: 'tab',
                developmentSections: 'developmentSection',
                operations: 'operation',
                routes: 'operation',
              } as Record<string, string>
            )[kind] || kind;
          for (const target of targets)
            instance.contribute(
              name as import('../shared/contracts/plugin-runtime.ts').PluginContributionKind,
              typeof target === 'string' ? target : 'path' in target ? target.path : String(target),
            );
        }
        directory.publish(instance);
        instance.activationMs = Math.round(performance.now() - startedAt);
      } catch (error) {
        instance.error = (error as Error).message;
        instance.activationMs = Math.round(performance.now() - startedAt);
        if (module && started) {
          try {
            await host.dispose(module);
          } catch (cleanup) {
            instance.error += '；清理失败：' + (cleanup as Error).message;
          }
        }
        if (instance.phase !== 'cleanup-pending') {
          instance.phase = 'failed';
          await instance.scope.dispose().catch((cleanup) => {
            instance.phase = 'cleanup-pending';
            instance.error = String(cleanup);
          });
        }
        directory.changed();
      }
    }
    return host;
  }
  /**
   * 入口 / Entry: PluginRuntime.require.
   * 功能：在装配插件服务、任务与终端能力中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`PluginRuntime`）。
   * Purpose: Checks admission, input or resource ownership in `PluginRuntime`; the calls and state transitions below complete the operation. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.enabled.has`, `this.directory.get().check`, `this.directory.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enabled.has`, `this.directory.get().check`, `this.directory.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.enabled.has(id)`; 异常 / errors `new AppError('请在插件中心启用插件「' + id + '」，并重启 Sakura 服务', 403)`.
   */
  require(id: string) {
    if (!this.enabled.has(id))
      throw new AppError('请在插件中心启用插件「' + id + '」，并重启 Sakura 服务', 403);
    this.directory.get('official', id)?.check();
  }
  /**
   * 入口 / Entry: PluginRuntime.socketEnabled.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `!!owner && this.enabled.has(owner)` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `!!owner && this.enabled.has(owner)` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `socketOwner`, `this.enabled.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socketOwner`, `this.enabled.has`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: channel: 'desktop' | 'terminal-session'
   * 输出 / Returns: `!!owner && this.enabled.has(owner)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  socketEnabled(channel: 'desktop' | 'terminal-session') {
    const owner = socketOwner(channel);
    return !!owner && this.enabled.has(owner);
  }
  /**
   * 入口 / Entry: PluginRuntime.validateConfig.
   * 功能：在装配插件服务、任务与终端能力中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`PluginRuntime`）。
   * Purpose: Checks admission, input or resource ownership in `PluginRuntime`; this entry produces `void` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.require` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.require`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!input || typeof input !== 'object'`; `value.distro && value.distro !== 'alpine' && value.distro !== previous?.distro`; `value.template && value.template !== 'none' && value.template !== previous?.template`.
   * 输入 / Inputs: input: unknown; previous: VMConfig optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  validateConfig(input: unknown, previous?: VMConfig) {
    if (!input || typeof input !== 'object') return; // The VM schema reports invalid input.
    const value = input as Partial<VMConfig>;
    if (value.distro && value.distro !== 'alpine' && value.distro !== previous?.distro)
      this.require('images');
    if (value.template && value.template !== 'none' && value.template !== previous?.template)
      this.require('projects');
    if (value.forwards && JSON.stringify(value.forwards) !== JSON.stringify(previous?.forwards || []))
      this.require('network');
  }
  /**
   * 入口 / Entry: PluginRuntime.jobStores.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `stores` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `stores` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.system.jobStores`, `this.modules.values`, `this.serviceValue`, `stores.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.system.jobStores`, `this.modules.values`, `this.serviceValue`, `stores.includes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `store && !stores.includes(store)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: JobsV1[]；结果来自 / values from `stores`.
   * 副作用 / Effects: `stores.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  jobStores(): JobsV1[] {
    const stores: JobsV1[] = [...this.system.jobStores()];
    for (const module of this.modules.values())
      for (const key of module.manifest.services) {
        const service = this.serviceValue(key) as { jobs?: JobsV1 } | undefined;
        const store = key === 'jobs' ? this.serviceValue<JobsV1>(key) : service?.jobs;
        if (store && !stores.includes(store)) stores.push(store);
      }
    return stores;
  }
  /**
   * 入口 / Entry: PluginRuntime.dispose.
   * 功能：在装配插件服务、任务与终端能力中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `instance.phase`, `instance.error`（`PluginRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginRuntime`; the outcome is recorded in `instance.phase`, `instance.error`. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.scopes.get`, `this.directory.get`, `instance.revoke`, `this.directory.changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scopes.get`, `this.directory.get`, `instance.revoke`, `this.directory.changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.owner === id`.
   * 输入 / Inputs: module: PluginModule
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scope.abort`; `this.cleanupPending.add`; `this.services.delete`; `this.pluginJobs.delete`; `this.contexts.delete`; 更新 / updates `instance.phase`, `instance.error`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.cleanupPending.add(id);`; `scope?.cleanupPending(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.cleanupPending.add(id);`; `scope?.cleanupPending(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async dispose(module: PluginModule) {
    const id = module.manifest.id;
    const scope = this.scopes.get(id);
    const closeMs = module.manifest.lifecycle.closeMs;
    const instance = this.directory.get('official', id)!;
    instance.revoke();
    this.directory.changed();
    scope?.abort();
    try {
      await withinDeadline(
        scope?.dispose((disposer) =>
          withinDeadline(withPluginCleanup(instance, disposer), closeMs, `${id} 资源关闭`),
        ),
        closeMs,
        `${id} 资源清理`,
      );
    } catch (error) {
      this.cleanupPending.add(id);
      scope?.cleanupPending(error);
      instance.phase = 'cleanup-pending';
      instance.error = '插件清理未完成：' + (error as Error).message;
      this.directory.changed();
      throw error;
    }
    for (const key of module.manifest.services) this.services.delete(key);
    this.broker.remove(instance);
    for (const [store, value] of this.pluginJobs) if (value.owner === id) this.pluginJobs.delete(store);
    this.contexts.delete(id);
    this.scopes.delete(id);
    this.modules.delete(id);
    this.cleanupPending.delete(id);
    instance.phase = 'inactive';
    this.directory.changed();
  }
  /** Stop new dispatch immediately. Providers remain until their dependents have unloaded. */
  /**
   * 入口 / Entry: PluginRuntime.unload.
   * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`PluginRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `void` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.modules.get`, `inline.filter`, `this.modules.values`, `dependents.map().join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.modules.get`, `inline.filter`, `this.modules.values`, `dependents.map().join`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!module`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `dependents.length`; 异常 / errors `new AppError( '请先停用依赖此插件的插件：' + dependents.map((item) => item.manifest.id).join('、'), 409, 'PLUGIN_DEPENDENTS_ACTIVE', )`.
   */
  async unload(id: string) {
    const module = this.modules.get(id);
    if (!module) return;
    const dependents = [...this.modules.values()].filter(
      (item) =>
        item.manifest.id !== id &&
        (this.enabled.has(item.manifest.id) || this.cleanupPending.has(item.manifest.id)) &&
        item.manifest.requires.some((dependency) => dependency.id === id),
    );
    if (dependents.length)
      throw new AppError(
        '请先停用依赖此插件的插件：' + dependents.map((item) => item.manifest.id).join('、'),
        409,
        'PLUGIN_DEPENDENTS_ACTIVE',
      );
    await this.dispose(module);
  }
  /**
   * 入口 / Entry: PluginRuntime.close.
   * 功能：在装配插件服务、任务与终端能力中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`, `this.closing`（`PluginRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginRuntime`; the outcome is recorded in `this.closed`, `this.closing`. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
   * 处理：通过 `this.directory.all`, `instance.revoke`, `this.directory.changed`, `this.scopes.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.directory.all`, `instance.revoke`, `this.directory.changed`, `this.scopes.values`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.closing`; `instance.source === 'official' && instance.phase === 'running'`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scope.abort`; `abort.abort`; 更新 / updates `this.closed`, `this.closing`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.closing = undefined;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.closing = undefined;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async close() {
    if (!this.closing) {
      this.closed = true;
      for (const instance of this.directory.all())
        if (instance.source === 'official' && instance.phase === 'running') instance.revoke();
      this.directory.changed();
      for (const scope of this.scopes.values()) scope.abort();
      for (const abort of this.active.keys()) abort.abort();
      /**
       * 入口 / Entry: PluginRuntime.close.callback@451.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `errors.push`; `this.system.close`; 更新 / updates `this.terminalInstance.phase`, `this.terminalInstance.error`.
       * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `new AggregateError(errors, '插件关闭失败')`.
       * 失败处理：catch 分支执行 `errors.push(error);`; `this.terminalInstance.phase = 'cleanup-pending';`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `errors.push(error);`; `this.terminalInstance.phase = 'cleanup-pending';`; these statements determine whether a failure is absorbed or rejected again.
       */
      this.closing = (async () => {
        // Dispose dependents before their providers; always attempt all cleanup.
        const errors: unknown[] = [];
        try {
          await withinDeadline(Promise.allSettled([...this.active.values()]), 10000, '插件请求清理');
        } catch (error) {
          errors.push(error);
        }
        for (const module of [...this.modules.values()].reverse()) {
          try {
            await this.unload(module.manifest.id);
          } catch (error) {
            errors.push(error);
          }
        }
        this.terminalInstance.revoke();
        try {
          await this.terminalInstance.scope.dispose((dispose) =>
            Promise.resolve(withPluginCleanup(this.terminalInstance, dispose)),
          );
          this.terminalInstance.phase = 'inactive';
        } catch (error) {
          this.terminalInstance.phase = 'cleanup-pending';
          this.terminalInstance.error = String(error);
          errors.push(error);
        }
        this.directory.changed();
        if (this.ownsSystem) {
          try {
            await this.system.close();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length) throw new AggregateError(errors, '插件关闭失败');
      })();
    }
    try {
      await this.closing;
    } catch (error) {
      this.closing = undefined;
      throw error;
    }
  }
  /**
   * 入口 / Entry: PluginRuntime.route.
   * 功能：将已声明插件 HTTP 操作交给当前模块处理，并限制方法、启用状态和响应范围。
   * Purpose: Dispatches declared HTTP operations to the current plugin module under method, enablement and response constraints.
   * 设计：路由归属与当前操作一致才能执行；失效插件或更换代次拒绝，任务及回执仍关联原实例。
   * Design: Route ownership must match the operation; revoked/replaced instances refuse execution while jobs/receipts retain original identity.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL; body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>
   * 输出 / Returns: `false`; `pending`.
   * 副作用 / Effects: `requestScope`; `pluginScope.signal.addEventListener`; `this.active.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!contribution.methods.some((method) => method === req.method)`; `!policy`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('不支持此方法', 405)`.
   */
  async route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    body: (req: IncomingMessage, signal?: AbortSignal, limit?: number) => Promise<any>,
  ) {
    const contribution = routeContribution(url.pathname);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (!contribution) return false;
    const { owner } = contribution;
    if (owner !== 'tasks') this.require(owner);
    if (!contribution.methods.some((method) => method === req.method))
      throw new AppError('不支持此方法', 405);
    const policy = currentOperation();
    if (!policy) throw new AppError('插件入口缺少已准入的操作声明', 403, 'OPERATION_NOT_ADMITTED');
    const handler = owner === 'tasks' ? (await import('./plugins/tasks.ts')).route :
      this.modules.get(owner)!.httpHandlers?.[policy.id.slice(owner.length + 1)];
    const module = owner === 'tasks' ? undefined : this.modules.get(owner)!;
    const declaredOperation = module?.manifest.contributes.operations.find(
      (item) => owner + '.' + item.id === policy.id,
    );
    const operation = declaredOperation && module?.operations?.[declaredOperation.id];
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (!operation && !handler) throw new AppError('操作没有原插件登记处理器', 503, 'OPERATION_HANDLER_MISSING');
    const mutation = policy.mutating;
    const targetVm = matchOperationPath(policy.path, url.pathname)?.vmId;
    if (policy.vmLock === 'require-unlocked' && targetVm)
      this.machines.requireUnlocked?.(targetVm);
    const releaseMutation = mutation ? this.operations.enter() : () => {};
    const scope = requestScope(req, res),
      abort = scope.controller;
    const pluginScope = this.scopes.get(owner);
    /**
     * 入口 / Entry: PluginRuntime.route.revoke.
     * 功能：把本层请求转交 `abort.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `abort.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `abort.abort(pluginScope?.signal.reason)`.
     * 副作用 / Effects: `abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const revoke = () => abort.abort(pluginScope?.signal.reason);
    pluginScope?.signal.addEventListener('abort', revoke, { once: true });
    if (pluginScope?.signal.aborted) revoke();
    /**
     * 入口 / Entry: PluginRuntime.route.callback@577.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().finally）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().finally).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.active.delete`; `releaseMutation`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: PluginRuntime.route.callback@531.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `pluginScope ? pluginScope.run(() => withPluginAuthority(this.directory.get('official', owner)!, dispatch)) : dispatch()`.
     * 副作用 / Effects: `abort.signal.throwIfAborted`.
     * 拒绝 / Refusals: 条件 / conditions `policy.maintenance === 'block' && this.migration?.blocked`; 异常 / errors `new AppError('数据目录迁移维护中', 409)`.
     */
    const pending = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        if (policy.maintenance === 'block' && this.migration?.blocked)
          throw new AppError('数据目录迁移维护中', 409);
        /**
         * 入口 / Entry: PluginRuntime.route.callback@537.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `sendJson(res, result, declaredOperation.status)`.
         * 副作用 / Effects: `operation.request.parse`; `operation.execute.call`; `abort.signal.throwIfAborted`; `sendJson`.
         * 拒绝 / Refusals: 条件 / conditions `!parsed.success`; 异常 / errors `new AppError(`插件 ${owner} 的响应不符合操作协议`, 502, 'INVALID_PLUGIN_RESPONSE')`.
         */
        /**
         * 入口 / Entry: PluginRuntime.route.route.
         * 功能：将已声明插件 HTTP 操作交给当前模块处理，并限制方法、启用状态和响应范围。
         * Purpose: Dispatches declared HTTP operations to the current plugin module under method, enablement and response constraints.
         * 设计：路由归属与当前操作一致才能执行；失效插件或更换代次拒绝，任务及回执仍关联原实例。
         * Design: Route ownership must match the operation; revoked/replaced instances refuse execution while jobs/receipts retain original identity.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `operation && declaredOperation ? (async () => { // Operations without a request schema have no body (for example DELETE). con…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const route = () =>
          operation && declaredOperation
            ? (
            /**
             * 中文功能：按操作 request Schema 读取/校验输入，调用原插件上下文，复核取消及 response Schema 后发送 JSON。
             * English: Reads/validates input using the operation request schema, executes in the original plugin context and checks cancellation/response schema before sending JSON.
             * 所属 / Owner: PluginRuntime.route.pending.finally.route.
             * 输入 / Inputs: 无显式参数 / no explicit parameters.
             */
            async () => {
                // Operations without a request schema have no body (for example DELETE).
                const raw =
                  req.method === 'GET' || !operation.request ? undefined : await body(req, abort.signal);
                const input = operation.request ? operation.request.parse(raw) : raw;
                const output = await operation.execute.call(
                  this.contexts.get(owner)!,
                  url,
                  input,
                  abort.signal,
                );
                noteOperationBusinessResult(declaredOperation.status || 200);
                abort.signal.throwIfAborted();
                const parsed = operation.response.safeParse(output);
                if (!parsed.success)
                  throw new AppError(`插件 ${owner} 的响应不符合操作协议`, 502, 'INVALID_PLUGIN_RESPONSE');
                const result = parsed.data;
                return sendJson(res, result, declaredOperation.status);
              })()
            : (handler as import('./plugin-api.ts').PluginRoute).call(
                owner === 'tasks' ? (this as unknown as PluginContext) : this.contexts.get(owner)!,
                req,
                res,
                url,
                async (request, signal, limit) => {
                  const value = await body(request, signal || abort.signal, limit);
                  if (policy.maintenance === 'block' && this.migration?.blocked)
                    throw new AppError('数据目录迁移维护中', 409);
                  return value;
                },
                abort.signal,
              );
        /**
         * 入口 / Entry: PluginRuntime.route.dispatch.
         * 功能：在装配插件服务、任务与终端能力中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.workspaces && targetVm && policy.projectScoped && /^[0-9a-f-]{36}$/i.test(targetVm) ? this.workspaces.projects.with(targ…` 供上层消费（`PluginRuntime`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginRuntime`; this entry produces `this.workspaces && targetVm && policy.projectScoped && /^[0-9a-f-]{36}$/i.test(targetVm) ? this.workspaces.projects.with(targ…` for its caller. Module context: Assembles plugin services, jobs and terminal capabilities, checking configuration and coordinating original-instance recovery.
         * 处理：通过 `inline.test`, `this.workspaces.projects.with`, `url.searchParams.get`, `route` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `inline.test`, `this.workspaces.projects.with`, `url.searchParams.get`, `route`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `this.workspaces && targetVm && policy.projectScoped && /^[0-9a-f-]{36}$/i.test(targetVm) ? this.workspaces.projects.with(targ…`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const dispatch = () =>
          this.workspaces && targetVm && policy.projectScoped && /^[0-9a-f-]{36}$/i.test(targetVm)
            ? this.workspaces.projects.with(targetVm, url.searchParams.get('project'), route)
            : route();
        return pluginScope
          ? pluginScope.run(() => withPluginAuthority(this.directory.get('official', owner)!, dispatch))
          : dispatch();
      })
      .finally(() => {
        this.active.delete(abort);
        releaseMutation();
        pluginScope?.signal.removeEventListener('abort', revoke);
        scope.dispose();
      });
    this.active.set(abort, pending);
    return pending;
  }
}

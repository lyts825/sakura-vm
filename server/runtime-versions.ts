/**
 * 模块职责：管理项目运行时探测、选择和安装，按项目串行版本变更并关联原执行作用域。
 * Module purpose: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
 */
import type { WorkspacesV1 } from './service-contracts/v1.ts';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { projectVersion, type Project } from './project-config.ts';

import { Jobs } from './jobs.ts';
import { guestTask } from './guest-task.ts';
import { randomUUID } from 'node:crypto';
import { projectIdentityTask } from './project-run-scope.ts';
import {
  parseRuntimeProbe,
  runtimeProbeCommand,
  runtimeProbeTimeout,
  type RuntimeProbeSample,
} from './runtime-probe.ts';
import {
  runtimeInstallCommand,
  parseRuntimeInstall,
  parseRuntimeInstallRecovery,
  runtimeInstallSetup,
} from './runtime-install.ts';
import {
  exactVersion,
  runtimesSchema,
  matchesVersion,
  type RuntimeVersionsConfig,
} from './runtime-config.ts';
export { exactVersion, runtimesSchema, runtimeRoot, runtimeBin, runtimeEnvironment,
  declarationVersion, matchesVersion, type RuntimeVersionsConfig } from './runtime-config.ts';
export type RuntimeProbeState = 'unprobed' | 'cached' | 'stale' | 'running' | 'failed';
type CompletedSample = { sample: RuntimeProbeSample; configVersion: string;
  live: unknown; checkedAt: string; at: number; invalidated: boolean };
type Pending = { controller: AbortController; done: Promise<unknown> };
/**
 * 入口 / Entry: cleanupFailure.
 * 功能：从当前输入或状态计算 `error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED', 'PROJECT_IDENTITY_NETWORK_CLEAN…`，供调用方后续验证或使用。
 * Purpose: Computes `error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED', 'PROJECT_IDENTITY_NETWORK_CLEAN…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: `error instanceof AppError && ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED', 'PROJECT_IDENTITY_NETWORK_CLEAN…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const cleanupFailure = (error: unknown) => error instanceof AppError &&
  ['GUEST_TASK_CLEANUP_FAILED', 'PROJECT_IDENTITY_CLEANUP_FAILED',
    'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED', 'RUNTIME_INSTALL_CLEANUP_FAILED'].includes(error.code || '');
export class RuntimeVersions {
  jobs = new Jobs('runtime-versions');
  private samples = new Map<string, CompletedSample>();
  private failures = new Map<string, string>();
  private pending = new Map<string, Pending>();
  private closed = false;
  private closing?: Promise<void>;
  /**
   * 签名 / Signature: RuntimeVersions.unsubscribe.
   * 功能：为管理项目运行时探测、选择和安装声明 unsubscribe 的输入与结果契约，所属容器为 RuntimeVersions。
   * Purpose: Declares the input/result contract for unsubscribe in RuntimeVersions. Module responsibility: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private unsubscribe: () => void;
  /**
   * 入口 / Entry: RuntimeVersions.constructor.
   * 功能：建立 RuntimeVersions 的管理项目运行时探测、选择和安装上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the RuntimeVersions context for this module's responsibility: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; workspaces: WorkspacesV1; options: { runTask?: typeof projectIdentityTask; runInstallTask?: typeof guestTask; now?: () =… default={}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.unsubscribe`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(private machines: Machines, private workspaces: WorkspacesV1,
    private options: { runTask?: typeof projectIdentityTask; runInstallTask?: typeof guestTask;
      /**
       * 签名 / Signature: RuntimeVersions.constructor.now.
       * 功能：为管理项目运行时探测、选择和安装声明 now 的输入与结果契约，所属容器为 RuntimeVersions.constructor。
       * Purpose: Declares the input/result contract for now in RuntimeVersions.constructor. Module responsibility: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: number.
       * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
       * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
       */
      now?: () => number } = {}) {
    this.unsubscribe = workspaces.onConfigChange(() => {
      for (const value of this.samples.values()) value.invalidated = true;
      return Promise.resolve();
    });
  }
  /**
   * 入口 / Entry: RuntimeVersions.now.
   * 功能：从当前输入或状态计算 `this.options.now?.() ?? Date.now()`，供调用方后续验证或使用。
   * Purpose: Computes `this.options.now?.() ?? Date.now()` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.options.now?.() ?? Date.now()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private now() { return this.options.now?.() ?? Date.now(); }
  /**
   * 入口 / Entry: RuntimeVersions.key.
   * 功能：把本层请求转交 `this.workspaces.projects.key`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.workspaces.projects.key` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.workspaces.projects.key(id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private key(id: string) { return this.workspaces.projects.key(id); }
  /**
   * 入口 / Entry: RuntimeVersions.assertOpen.
   * 功能：在管理项目运行时探测、选择和安装中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`RuntimeVersions`）。
   * Purpose: Checks admission, input or resource ownership in `RuntimeVersions`; the calls and state transitions below complete the operation. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; 异常 / errors `new AppError('运行时服务正在关闭', 503, 'RUNTIME_CLOSED')`.
   */
  private assertOpen(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (this.closed) throw new AppError('运行时服务正在关闭', 503, 'RUNTIME_CLOSED');
  }
  /**
   * 入口 / Entry: RuntimeVersions.operation.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；本入口产生 `done` 供上层消费（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; this entry produces `done` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.assertOpen`, `this.key`, `this.pending.has`, `signal.addEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertOpen`, `this.key`, `this.pending.has`, `signal.addEventListener`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `signal?.aborted`.
   * 输入 / Inputs: id: string; signal: AbortSignal | undefined; action: (signal: AbortSignal) => Promise<T>
   * 输出 / Returns: `done`.
   * 副作用 / Effects: `signal.addEventListener`; `abort`; `this.pending.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.pending.has(key)`; 异常 / errors `new AppError('该项目的版本操作仍在进行', 409, 'RUNTIME_BUSY')`.
   */
  private operation<T>(id: string, signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>) {
    this.assertOpen(signal);
    const key = this.key(id);
    if (this.pending.has(key)) throw new AppError('该项目的版本操作仍在进行', 409, 'RUNTIME_BUSY');
    /**
     * 入口 / Entry: RuntimeVersions.operation.abort.
     * 功能：把本层请求转交 `controller.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `controller.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `controller.abort(signal?.reason)`.
     * 副作用 / Effects: `controller.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const done = Promise.resolve().then(() => action(controller.signal)).catch(error => {
      this.failures.set(key, error instanceof AppError && /^[A-Z_]{1,80}$/.test(error.code || '')
        ? error.code! : controller.signal.aborted ? 'RUNTIME_CANCELLED' : 'RUNTIME_PROBE_FAILED');
      while (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
      throw error;
    }).finally(() => {
      signal?.removeEventListener('abort', abort);
      if (this.pending.get(key)?.controller === controller) this.pending.delete(key);
    });
    this.pending.set(key, { controller, done });
    return done;
  }
  /**
   * 入口 / Entry: RuntimeVersions.current.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; the calls and state transitions below complete the operation. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.assertOpen`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertOpen`, `this.workspaces.projects.current`, `this.machines.live.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; scope: string; live: unknown; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.workspaces.projects.current(id) !== scope || !live || this.machines.live.get(id) !== live || this.machines.state(id) !==…`; 异常 / errors `new AppError('实例或项目归属已变化，请重新探测', 409, 'RUNTIME_BINDING_CHANGED')`.
   */
  private current(id: string, scope: string, live: unknown, signal: AbortSignal) {
    this.assertOpen(signal);
    if (this.workspaces.projects.current(id) !== scope || !live ||
        this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
      throw new AppError('实例或项目归属已变化，请重新探测', 409, 'RUNTIME_BINDING_CHANGED');
  }
  /**
   * 入口 / Entry: RuntimeVersions.remember.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; the calls and state transitions below complete the operation. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.samples.delete`, `this.now`, `this.samples.set`, `this.failures.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.samples.delete`, `this.now`, `this.samples.set`, `this.failures.delete`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string; sample: RuntimeProbeSample; configuration: string; live: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.samples.delete`; `this.samples.set`; `this.failures.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private remember(key: string, sample: RuntimeProbeSample, configuration: string, live: unknown) {
    this.samples.delete(key);
    const at = this.now();
    this.samples.set(key, { sample, configVersion: configuration, live,
      checkedAt: new Date(at).toISOString(), at, invalidated: false });
    this.failures.delete(key);
    while (this.samples.size > 256) this.samples.delete(this.samples.keys().next().value!);
  }
  /**
   * 入口 / Entry: RuntimeVersions.receipt.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; the calls and state transitions below complete the operation. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.machines.get`, `signal.throwIfAborted`, `this.machines.exec`, `runtimeInstallCommand` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `signal.throwIfAborted`, `this.machines.exec`, `runtimeInstallCommand`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; pins: RuntimeVersionsConfig; signal: AbortSignal
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async receipt(id: string, pins: RuntimeVersionsConfig, signal: AbortSignal) {
    const architecture = this.machines.get(id).architecture || 'x86_64';
    for (const [tool, version] of Object.entries(pins) as ['node' | 'python', string][]) {
      signal.throwIfAborted();
      const result = await this.machines.exec(id, runtimeInstallCommand({ operation: 'verify', tool, version, architecture }), 15_000, signal);
      parseRuntimeInstall(result, { tool, version, phase: 'ready', architecture });
    }
  }
  /**
   * 入口 / Entry: RuntimeVersions.measure.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；本入口产生 `parseRuntimeProbe(result)` 供上层消费（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; this entry produces `parseRuntimeProbe(result)` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.receipt`, `this.workspaces.resolveProject`, `this.assertOpen`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.receipt`, `this.workspaces.resolveProject`, `this.assertOpen`, `inline`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal
   * 输出 / Returns: `parseRuntimeProbe(result)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async measure(id: string, project: Project, signal: AbortSignal) {
    await this.receipt(id, project.runtimes || {}, signal);
    const resolved = await this.workspaces.resolveProject(id, project);
    this.assertOpen(signal);
    const result = await (this.options.runTask || projectIdentityTask)(this.machines, id, project,
      { command: runtimeProbeCommand(project.runtimes), environment: resolved.environment }, signal,
      undefined, runtimeProbeTimeout);
    this.assertOpen(signal);
    return parseRuntimeProbe(result);
  }
  /**
   * 入口 / Entry: RuntimeVersions.probe.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(id, signal)` 供上层消费（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; this entry produces `this.view(id, signal)` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.operation`, `this.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.operation`, `this.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `this.view(id, signal)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async probe(id: string, signal?: AbortSignal) {
    /**
     * 入口 / Entry: RuntimeVersions.probe.callback@115.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `projectVersion(await this.workspaces.config(id)) !== version`; 异常 / errors `new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED')`.
     */
    await this.operation(id, signal, active => this.machines.locked(id, async () => {
      const scope = this.workspaces.projects.current(id), live = this.machines.live.get(id);
      this.current(id, scope, live, active);
      const project = await this.workspaces.config(id), version = projectVersion(project);
      const sample = await this.measure(id, project, active);
      this.current(id, scope, live, active);
      if (projectVersion(await this.workspaces.config(id)) !== version)
        throw new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED');
      this.current(id, scope, live, active);
      this.remember(this.key(id), sample, version, live);
    }));
    return this.view(id, signal);
  }
  // Compatibility for explicit internal probes. A supplied stale or foreign
  // project cannot be used to launch a different identity than the current one.
  /**
   * 入口 / Entry: RuntimeVersions.inspect.
   * 功能：在管理项目运行时探测、选择和安装中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `(await this.probe(id, signal)).actual` 供上层消费（`RuntimeVersions`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RuntimeVersions`; this entry produces `(await this.probe(id, signal)).actual` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.workspaces.config`, `projectVersion`, `this.probe` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.workspaces.config`, `projectVersion`, `this.probe`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; project: Project; signal: AbortSignal optional
   * 输出 / Returns: `(await this.probe(id, signal)).actual`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `projectVersion(project) !== projectVersion(current) || project._workspace !== current._workspace`; 异常 / errors `new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED')`.
   */
  async inspect(id: string, project: Project, signal?: AbortSignal) {
    const current = await this.workspaces.config(id);
    if (projectVersion(project) !== projectVersion(current) || project._workspace !== current._workspace)
      throw new AppError('项目配置已变化，请重新探测', 409, 'RUNTIME_CONFIGURATION_CHANGED');
    return (await this.probe(id, signal)).actual;
  }
  /**
   * 入口 / Entry: RuntimeVersions.view.
   * 功能：在管理项目运行时探测、选择和安装中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ selected, declared, actual, mismatches: sample ? (['node', 'python'] as const).filter(tool => (selected[tool] || declared[t…` 供上层消费（`RuntimeVersions`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `RuntimeVersions`; this entry produces `{ selected, declared, actual, mismatches: sample ? (['node', 'python'] as const).filter(tool => (selected[tool] || declared[t…` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.assertOpen`, `this.workspaces.config`, `this.key`, `this.samples.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertOpen`, `this.workspaces.config`, `this.key`, `this.samples.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ selected, declared, actual, mismatches: sample ? (['node', 'python'] as const).filter(tool => (selected[tool] || declared[t…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string, signal?: AbortSignal) {
    this.assertOpen(signal);
    const project = await this.workspaces.config(id), selected = project.runtimes || {}, key = this.key(id);
    this.assertOpen(signal);
    const value = this.samples.get(key), sample = value?.sample;
    const actual = sample ? { ...sample.actual } : { node: '', python: '' }, declared = { ...sample?.declared };
    const stale = value && (value.invalidated || this.now() - value.at > 300_000 ||
      value.live !== this.machines.live.get(id) || this.machines.state(id) !== 'running' ||
      value.configVersion !== projectVersion(project));
    const state: RuntimeProbeState = this.pending.has(key) ? 'running' : this.failures.has(key) ? 'failed'
      : !value ? 'unprobed' : stale ? 'stale' : 'cached';
    return { selected, declared, actual,
      mismatches: sample ? (['node', 'python'] as const).filter(tool =>
        (selected[tool] || declared[tool]) && !matchesVersion(actual[tool], selected[tool] || declared[tool]!)) : [],
      probe: { state, checkedAt: value?.checkedAt || null, configVersion: value?.configVersion || null,
        bootId: sample?.bootId || null, ...(this.failures.has(key) ? { errorCode: this.failures.get(key)! } : {}) },
      job: this.jobs.view(key) };
  }
  /**
   * 入口 / Entry: RuntimeVersions.select.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.operation(id, signal, async active => { const captured = await this.machines.locked(id, async () => { const scope = this…` 供上层消费（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; this entry produces `this.operation(id, signal, async active => { const captured = await this.machines.locked(id, async () => { const scope = this…` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `runtimesSchema.parse`, `this.operation` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `runtimesSchema.parse`, `this.operation`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown; signal: AbortSignal optional
   * 输出 / Returns: `this.operation(id, signal, async active => { const captured = await this.machines.locked(id, async () => { const scope = this…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async select(id: string, input: unknown, signal?: AbortSignal) {
    const runtimes = runtimesSchema.parse(input);
    /**
     * 入口 / Entry: RuntimeVersions.select.callback@156.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.operation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.operation).
     * 输入 / Inputs: active
     * 输出 / Returns: `saved`.
     * 副作用 / Effects: `this.workspaces.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.operation(id, signal, async active => {
      /**
       * 入口 / Entry: RuntimeVersions.select.callback@157.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ scope, live, original, candidate, version, sample }`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `sample.actual[tool] !== requested`; 异常 / errors `new AppError(`请先安装并核对 ${tool} ${requested}`, 409, 'RUNTIME_VERSION_MISMATCH')`.
       */
      const captured = await this.machines.locked(id, async () => {
        const scope = this.workspaces.projects.current(id), live = this.machines.live.get(id);
        this.current(id, scope, live, active);
        const original = await this.workspaces.config(id), version = projectVersion(original);
        const candidate: Project = { ...original, runtimes };
        Object.defineProperty(candidate, '_workspace', { value: original._workspace, enumerable: false });
        const sample = await this.measure(id, candidate, active);
        for (const [tool, requested] of Object.entries(runtimes) as ['node' | 'python', string][])
          if (sample.actual[tool] !== requested)
            throw new AppError(`请先安装并核对 ${tool} ${requested}`, 409, 'RUNTIME_VERSION_MISMATCH');
        this.current(id, scope, live, active);
        return { scope, live, original, candidate, version, sample };
      });
      /**
       * 入口 / Entry: RuntimeVersions.select.commit.
       * 功能：把本层请求转交 `this.current`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.current` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.current(id, captured.scope, captured.live, active)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const commit = () => this.current(id, captured.scope, captured.live, active);
      commit();
      const saved = await this.workspaces.save(id, captured.candidate, undefined, captured.version, commit);
      // A successful atomic configuration publication is not rolled back when
      // the caller disconnects afterwards. Do not publish a sample after abort.
      commit();
      this.remember(this.key(id), captured.sample, projectVersion(saved), captured.live);
      return saved;
    });
  }
  /**
   * 入口 / Entry: RuntimeVersions.install.
   * 功能：在管理项目运行时探测、选择和安装中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.jobs.start( this.workspaces.projects.key(id), async (log, signal) => this.machines.locked(id, async () => { this.current…` 供上层消费（`RuntimeVersions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `RuntimeVersions`; this entry produces `this.jobs.start( this.workspaces.projects.key(id), async (log, signal) => this.machines.locked(id, async () => { this.current…` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.assertOpen`, `z.object().strict().parse`, `z.object().strict`, `z.object` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertOpen`, `z.object().strict().parse`, `z.object().strict`, `z.object`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `this.jobs.start( this.workspaces.projects.key(id), async (log, signal) => this.machines.locked(id, async () => { this.current…`.
   * 副作用 / Effects: `this.jobs.start`.
   * 拒绝 / Refusals: 条件 / conditions `this.machines.state(id) !== 'running'`; `tool === 'node' && (!vm.distro || vm.distro === 'alpine')`; 异常 / errors `new AppError('请先启动发行版')`; `new AppError('Node 官方预编译版本需要 Debian/Ubuntu；Alpine 可继续使用发行版 Node')`.
   */
  async install(id: string, input: unknown) {
    this.assertOpen();
    const { tool, version } = z
      .object({ tool: z.enum(['node', 'python']), version: exactVersion })
      .strict()
      .parse(input);
    const vm = this.machines.get(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动发行版');
    if (tool === 'node' && (!vm.distro || vm.distro === 'alpine'))
      throw new AppError('Node 官方预编译版本需要 Debian/Ubuntu；Alpine 可继续使用发行版 Node');
    const live = this.machines.live.get(id), scope = this.workspaces.projects.current(id);
    const architecture = vm.architecture || 'x86_64';
    const installId = randomUUID(), runId = randomUUID();
    /**
     * 入口 / Entry: RuntimeVersions.install.callback@195.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.machines.locked）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.machines.locked).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.machines.exec`; `key.startsWith`; 更新 / updates `existing`, `confirmed`, `value.invalidated`, `retired`.
     * 拒绝 / Refusals: 条件 / conditions `kernel.code !== 0 || !bootId.success`; `!confirmed`; `!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running'`; 异常 / errors `new AppError('无法固定安装开机身份', 409, 'RUNTIME_BINDING_CHANGED')`; `new AppError('安装清理归属未确认，请恢复实例后重试安装', 503, 'RUNTIME_INSTALL_CLEANUP_FAILED')`.
     * 收尾：退出 try 区域时始终执行 `if (!confirmed) { // A cancelled body cannot publish ready. This independent control // connection retires only its exact rec…`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `if (!confirmed) { // A cancelled body cannot publish ready. This independent control // connection retires only its exact rec…`; these steps also apply to exceptional exits.
     * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.jobs.start(
      this.workspaces.projects.key(id),
      async (log, signal) => this.machines.locked(id,
      /**
       * 中文功能：固定 boot 和原项目/live 后准备运行时安装，严格校验 prepared/ready 回执并确认发布，成功使采样缓存失效。
       * English: Pins boot/original project/live, prepares runtime installation, validates prepared/ready receipts and confirms publication, invalidating sample caches on success.
       * 所属 / Owner: RuntimeVersions.install.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 设计：未确认时通过独立控制连接最多三次退役同一 installId；原 live 不存在或退役未证明时保留 503 清理失败。
       * Design: Without confirmation, retire the same installId up to three times through independent control; absent original live or unproven retirement remains a 503 cleanup failure.
       */
      async () => {
        this.current(id, scope, live, signal);
        const kernel = await this.machines.exec(id,
          'env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin HOME=/ LANG=C LC_ALL=C /bin/cat /proc/sys/kernel/random/boot_id', 10_000, signal);
        const bootId = z.uuid().safeParse(kernel.stdout.trim());
        if (kernel.code !== 0 || !bootId.success) throw new AppError('无法固定安装开机身份', 409, 'RUNTIME_BINDING_CHANGED');
        const network = await this.workspaces.networkEnvironment(id);
        this.current(id, scope, live, signal);
        const script = 'set -eu\n' + runtimeInstallSetup(vm.distro, network) + ' >&2\n' +
          runtimeInstallCommand({ operation: 'prepare', tool, version, installId, runId, bootId: bootId.data, architecture, network });
        let confirmed = false;
        try {
          const result = await (this.options.runInstallTask || guestTask)(this.machines, id, script,
            signal, log, 1_200_000, undefined, undefined, { runId });
          this.current(id, scope, live, signal);
          let existing = false;
          try { existing = JSON.parse(result.stdout).result?.phase === 'ready'; } catch { /* Strict parse follows. */ }
          parseRuntimeInstall(result, { tool, version, architecture, phase: existing ? 'ready' : 'prepared',
            ...(existing ? {} : { installId }) });
          if (!existing) {
            const final = await this.machines.exec(id, runtimeInstallCommand({ operation: 'confirm',
              tool, version, installId, bootId: bootId.data, architecture }), 30_000, signal);
            parseRuntimeInstall(final, { tool, version, phase: 'ready', installId, architecture });
          }
          confirmed = true;
          for (const [key, value] of this.samples) if (key === id || key.startsWith(id + ':')) value.invalidated = true;
          log('运行时安装回执已确认；项目版本选择将通过项目账户验证。\n');
        } finally {
          if (!confirmed) {
            // A cancelled body cannot publish ready. This independent control
            // connection retires only its exact recorded stage after CG empty.
            if (!live || this.machines.live.get(id) !== live || this.machines.state(id) !== 'running')
              throw new AppError('安装清理归属未确认，请恢复实例后重试安装', 503, 'RUNTIME_INSTALL_CLEANUP_FAILED');
            let retired = false;
            for (let attempt = 0; attempt < 3 && !retired; attempt++) {
              try {
                const result = await this.machines.exec(id, runtimeInstallCommand({ operation: 'recover',
                  tool, version, installId, architecture }), 30_000);
                parseRuntimeInstallRecovery(result, { tool, version, architecture });
                retired = true;
              } catch { /* Retry the same receipt; never choose another stage. */ }
            }
            if (!retired) throw new AppError('运行时安装清理未确认，请重试安装核对原回执', 503, 'RUNTIME_INSTALL_CLEANUP_FAILED');
          }
        }
      }),
      {
        title: `安装 ${tool} ${version}`,
        vmId: id,
        projectId: this.workspaces.projects.current(id),
        action: `install:${tool}:${version}`,
      },
    );
  }
  /**
   * 入口 / Entry: RuntimeVersions.close.
   * 功能：在管理项目运行时探测、选择和安装中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` 供上层消费（`RuntimeVersions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `RuntimeVersions`; this entry produces `this.closing` for its caller. Module context: Owns runtime probing, selection and installation, serializing project version changes within original execution scopes.
   * 处理：通过 `this.unsubscribe`, `this.pending.values`, `this.jobs.list().filter`, `this.jobs.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.unsubscribe`, `this.pending.values`, `this.jobs.list().filter`, `this.jobs.list`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closing`.
   * 副作用 / Effects: `value.controller.abort`; 更新 / updates `this.closed`, `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.unsubscribe();
    const pending = [...this.pending.values()];
    const installing = this.jobs.list().filter(job => job.status === 'running');
    for (const value of pending) value.controller.abort();
    /**
     * 入口 / Entry: RuntimeVersions.close.callback@256.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.jobs.close`; `this.samples.clear`; `this.failures.clear`.
     * 拒绝 / Refusals: 条件 / conditions `result.status === 'rejected' && cleanupFailure(result.reason)`; `job.status === 'error' && cleanupFailure(new AppError('', 503, job.errorCode))`; 异常 / errors `result.reason`; `new AppError('运行时安装清理未确认，请恢复实例后重试', 503, job.errorCode)`.
     */
    this.closing = (async () => {
      const results = await Promise.allSettled([this.jobs.close(), ...pending.map(value => value.done)]);
      this.samples.clear(); this.failures.clear();
      for (const result of results) if (result.status === 'rejected' && cleanupFailure(result.reason)) throw result.reason;
      // Jobs records failures instead of rejecting close(). Preserve a cleanup
      // failure from an installation cancelled by this close as well.
      for (const job of installing) if (job.status === 'error' &&
          cleanupFailure(new AppError('', 503, job.errorCode)))
        throw new AppError('运行时安装清理未确认，请恢复实例后重试', 503, job.errorCode);
    })();
    return this.closing;
  }
}

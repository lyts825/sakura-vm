/**
 * 模块职责：管理常驻项目会话的捕获身份与退休回执，旧会话关闭不能影响新的客户机运行。
 * Module purpose: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
 */
import { AppError } from '../shared/errors.ts';
import {
  hostRuntime,
  captureResourceContext,
  type HostRuntime,
  type ResourceLease,
} from './host-runtime/index.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { vmLifetime, type VmIdentity } from './vm-lifetime.ts';
import { captureOperationCheck, withoutOperationContext } from './operation-context.ts';
import { pluginAuthority, withPluginCleanup } from './plugin-authority.ts';
import { withResourceContext } from './host-runtime/context.ts';

export type SessionReceipt = { runId: string; bootId: string; projectId: string; [key: string]: unknown };
type Options<R extends SessionReceipt> = {
  machines: Machines;
  vmId: string;
  kind: string;
  receipt: R;
  signal?: AbortSignal;
  live?: NonNullable<ReturnType<Machines['live']['get']>>;
  /**
   * 签名 / Signature: Options.cleanup.
   * 功能：为管理常驻项目会话的捕获身份与退休回执声明 cleanup 的输入与结果契约，所属容器为 Options。
   * Purpose: Declares the input/result contract for cleanup in Options. Module responsibility: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: receipt: R
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  cleanup(receipt: R): Promise<void>;
  governor?: Pick<HostRuntime, 'tryAcquire'>;
};
const sessions = new WeakMap<Machines, Map<string, unknown>>();
/**
 * 入口 / Entry: key.
 * 功能：从当前输入或状态计算 ``${vmId}:${receipt.projectId}:${receipt.runId}``，供调用方后续验证或使用。
 * Purpose: Computes ``${vmId}:${receipt.projectId}:${receipt.runId}`` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: vmId: string; receipt: SessionReceipt
 * 输出 / Returns: ``${vmId}:${receipt.projectId}:${receipt.runId}``.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const key = (vmId: string, receipt: SessionReceipt) => `${vmId}:${receipt.projectId}:${receipt.runId}`;
const incomplete = new Set(['inode', 'sessionId', 'paneId', 'panePid', 'paneStartTicks', 'run']);
/**
 * 入口 / Entry: same.
 * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `a === b || ((a === null || initialIntent) && incomplete.has(field))` / `( Object.keys(left).every( (name) => name === 'phase' || (name in right && same(left[name], right[name], name, initialIntent)…` 供上层消费（`project-session-lifetime.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `project-session-lifetime.ts`; this entry produces `a === b || ((a === null || initialIntent) && incomplete.has(field))` / `( Object.keys(left).every( (name) => name === 'phase' || (name in right && same(left[name], right[name], name, initialIntent)…` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
 * 处理：通过 `incomplete.has` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `incomplete.has`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `a === null || b === null`; `a && b && typeof a === 'object' && typeof b === 'object'`.
 * 输入 / Inputs: a: unknown; b: unknown; field: default=''; initialIntent: default=false
 * 输出 / Returns: boolean；结果来自 / values from `a === b || ((a === null || initialIntent) && incomplete.has(field))`; `( Object.keys(left).every( (name) => name === 'phase' || (name in right && same(left[name], right[name], name, initialIntent)…`; `a === b`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const same = (a: unknown, b: unknown, field = '', initialIntent = false): boolean => {
  // An initial intent may gain native identity, but an observed identity can never be erased.
  if (a === null || b === null) return a === b || ((a === null || initialIntent) && incomplete.has(field));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>,
      right = b as Record<string, unknown>;
    return (
      Object.keys(left).every(
        (name) => name === 'phase' || (name in right && same(left[name], right[name], name, initialIntent)),
      ) && Object.keys(right).every((name) => name === 'phase' || name in left)
    );
  }
  return a === b;
};

/** A running domain owns its slot until its original stop protocol confirms the whole session. */
export class ProjectSessionLifetime<R extends SessionReceipt> {
  readonly identity: VmIdentity;
  readonly signal: AbortSignal;
  private receipt: R;
  private readonly lifetime;
  private readonly live;
  private readonly controller = new AbortController();
  private lease!: ResourceLease;
  private activity!: ReturnType<ReturnType<typeof vmLifetime>['enter']>;
  private active = new Set<Promise<unknown>>();
  private closeTask?: Promise<void>;
  private closed = false;
  /**
   * 入口 / Entry: ProjectSessionLifetime.removeOwned.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ProjectSessionLifetime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private removeOwned = () => {};
  /**
   * 入口 / Entry: ProjectSessionLifetime.detach.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectSessionLifetime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private detach = () => {};
  /**
   * 签名 / Signature: ProjectSessionLifetime.cleanup.
   * 功能：为管理常驻项目会话的捕获身份与退休回执声明 cleanup 的输入与结果契约，所属容器为 ProjectSessionLifetime。
   * Purpose: Declares the input/result contract for cleanup in ProjectSessionLifetime. Module responsibility: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: receipt: R
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private cleanup: (receipt: R) => Promise<void>;
  private readonly instance = pluginAuthority();
  private readonly cleanupFailures = new Set<unknown>();
  /**
   * 入口 / Entry: ProjectSessionLifetime.confirmPluginCleanup.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectSessionLifetime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  /**
   * 签名 / Signature: ProjectSessionLifetime.confirmPluginCleanup.
   * 功能：为管理常驻项目会话的捕获身份与退休回执声明 confirmPluginCleanup 的输入与结果契约，所属容器为 ProjectSessionLifetime。
   * Purpose: Declares the input/result contract for confirmPluginCleanup in ProjectSessionLifetime. Module responsibility: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: void.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  private confirmPluginCleanup: (error: unknown) => void = () => {};
  /**
   * 入口 / Entry: ProjectSessionLifetime.constructor.
   * 功能：建立 ProjectSessionLifetime 的管理常驻项目会话的捕获身份与退休回执上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectSessionLifetime context for this module's responsibility: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: options: Options<R>
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `AbortSignal.any`; 更新 / updates `this.lifetime`, `this.live`, `this.identity`, `this.receipt`.
   * 拒绝 / Refusals: 条件 / conditions `!live || (options.live && options.live !== live) || options.machines.closing`; 异常 / errors `new AppError('实例暂不接收常驻会话', 409, 'VM_EXECUTION_DRAINING')`.
   */
  private constructor(private options: Options<R>) {
    const live = options.machines.live.get(options.vmId);
    if (!live || (options.live && options.live !== live) || options.machines.closing)
      throw new AppError('实例暂不接收常驻会话', 409, 'VM_EXECUTION_DRAINING');
    this.lifetime = vmLifetime(options.vmId, live);
    this.live = live;
    this.identity = this.lifetime.capture();
    this.receipt = structuredClone(options.receipt);
    this.cleanup = options.cleanup;
    this.signal = AbortSignal.any([
      this.controller.signal,
      this.lifetime.signal,
      ...(this.instance ? [this.instance.signal] : []),
    ]);
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.acquire.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `previous` / `owned` 供上层消费（`ProjectSessionLifetime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; this entry produces `previous` / `owned` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `captureOperationCheck()`, `captureOperationCheck`, `key`, `sessions.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck()`, `captureOperationCheck`, `key`, `sessions.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!registry`; `owned.instance`.
   * 输入 / Inputs: options: Options<R>
   * 输出 / Returns: Promise<ProjectSessionLifetime<R>>；结果来自 / values from `previous`; `owned`.
   * 副作用 / Effects: `sessions.set`; `AbortSignal.any`; `owned.lifetime.resources.defer`; `registry.set`; `owned.activity.signal.addEventListener`; 更新 / updates `registry`, `owned.lease`, `owned.activity`, `owned.removeOwned`.
   * 拒绝 / Refusals: 条件 / conditions `previous`; `previous.options.kind !== options.kind`; `options.live && options.live !== previous.live`; 异常 / errors `new AppError('常驻会话不属于此领域', 409, 'SESSION_ADMISSION_CONFLICT')`; `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   * 失败处理：catch 分支执行 `owned.activity?.release();`; `owned.lease.release();`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `owned.activity?.release();`; `owned.lease.release();`; these statements determine whether a failure is absorbed or rejected again.
   */
  static async acquire<R extends SessionReceipt>(options: Options<R>): Promise<ProjectSessionLifetime<R>> {
    await captureOperationCheck()();
    const sessionKey = key(options.vmId, options.receipt);
    let registry = sessions.get(options.machines);
    if (!registry) sessions.set(options.machines, (registry = new Map()));
    const previous = registry.get(sessionKey) as ProjectSessionLifetime<R> | undefined;
    if (previous) {
      if (previous.options.kind !== options.kind)
        throw new AppError('常驻会话不属于此领域', 409, 'SESSION_ADMISSION_CONFLICT');
      previous.assertReceipt(options.receipt);
      previous.assert();
      options.signal?.throwIfAborted();
      if (options.live && options.live !== previous.live)
        throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
      return previous;
    }
    const owned = new ProjectSessionLifetime(options);
    options.signal?.throwIfAborted();
    const lease = (options.governor || hostRuntime).tryAcquire({
      owner: `session:${options.receipt.runId}`,
      kind: 'execution.session',
      label: `${options.kind}:${options.receipt.projectId}`,
      identity: captureResourceContext({ ...owned.identity, projectId: options.receipt.projectId }),
      cost: { 'execution.session': 1 },
      partitions: [
        { key: `execution.session:vm:${options.vmId}`, limit: 32 },
        { key: `execution.session:project:${options.vmId}:${options.receipt.projectId}`, limit: 16 },
      ],
      signal: AbortSignal.any([owned.signal, ...(options.signal ? [options.signal] : [])]),
    });
    // 启动可能持有旧会话停止所需的领域锁；这里即时准入，不能持锁排队等待旧会话释放额度。
    if (!lease) throw new AppError('常驻会话已达到当前资源额度', 429, 'RESOURCE_CAPACITY');
    owned.lease = lease;
    try {
      owned.assert();
      owned.activity = owned.lifetime.enter(owned.identity, { persistent: true });
      if (registry.has(sessionKey))
        throw new AppError('同一常驻会话正在启动', 409, 'SESSION_ADMISSION_CONFLICT');
      owned.removeOwned = owned.lifetime.resources.defer(
        `session:${options.receipt.runId}`,
        () => owned.close(),
        0,
      );
      registry.set(sessionKey, owned);
      /**
       * 入口 / Entry: ProjectSessionLifetime.acquire.cancel.
       * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectSessionLifetime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
       * 处理：通过 `owned.close().catch`, `owned.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `owned.close().catch`, `owned.close`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `owned.close().catch`; `owned.close`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => {
        void owned.close().catch(() => {});
      };
      owned.activity.signal.addEventListener('abort', cancel, { once: true });
      if (owned.instance) {
        owned.confirmPluginCleanup = owned.instance.scope.retainCleanup(() => owned.close());
        owned.instance.signal.addEventListener('abort', cancel, { once: true });
      }
      /**
       * 入口 / Entry: ProjectSessionLifetime.acquire.owned.detach.
       * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectSessionLifetime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
       * 处理：通过 `owned.activity.signal.removeEventListener`, `owned.instance.signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `owned.activity.signal.removeEventListener`, `owned.instance.signal.removeEventListener`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      owned.detach = () => {
        owned.activity.signal.removeEventListener('abort', cancel);
        owned.instance?.signal.removeEventListener('abort', cancel);
      };
      return owned;
    } catch (error) {
      owned.activity?.release();
      owned.lease.release();
      throw error;
    }
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.assertReceipt.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectSessionLifetime`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `same` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `same`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: receipt: R; initialIntent: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!same(this.receipt, receipt, '', initialIntent)`; 异常 / errors `new AppError('常驻会话完整归属已改变', 503, 'SESSION_CLEANUP_PENDING')`.
   */
  assertReceipt(receipt: R, initialIntent = false) {
    if (!same(this.receipt, receipt, '', initialIntent))
      throw new AppError('常驻会话完整归属已改变', 503, 'SESSION_CLEANUP_PENDING');
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.pin.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.receipt`（`ProjectSessionLifetime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; the outcome is recorded in `this.receipt`. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `this.assertReceipt`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assertReceipt`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: receipt: R
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.receipt`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  pin(receipt: R) {
    this.assertReceipt(receipt);
    this.receipt = structuredClone(receipt);
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.assert.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectSessionLifetime`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectSessionLifetime`; the calls and state transitions below complete the operation. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `this.signal.throwIfAborted`, `this.lifetime.assert`, `this.options.machines.live.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.signal.throwIfAborted`, `this.lifetime.assert`, `this.options.machines.live.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.options.machines.live.get(this.options.vmId) !== this.live`; 异常 / errors `new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED')`.
   */
  private assert() {
    this.signal.throwIfAborted();
    this.lifetime.assert(this.identity);
    if (this.options.machines.live.get(this.options.vmId) !== this.live)
      throw new AppError('客户机运行身份已改变', 409, 'PROJECT_IDENTITY_HOST_CHANGED');
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.perform.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await operation` 供上层消费（`ProjectSessionLifetime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectSessionLifetime`; this entry produces `await operation` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `this.assert`, `AbortSignal.any`, `Promise.resolve().then`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.assert`, `AbortSignal.any`, `Promise.resolve().then`, `Promise.resolve`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: (signal: AbortSignal) => Promise<T>; signal: AbortSignal optional
   * 输出 / Returns: Promise<T>；结果来自 / values from `await operation`.
   * 副作用 / Effects: `AbortSignal.any`; `this.active.add`; `this.active.delete`.
   * 拒绝 / Refusals: 条件 / conditions `this.active.size`; 异常 / errors `new AppError('常驻会话正在进行另一项控制操作', 409, 'SESSION_CONTROL_BUSY')`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(operation);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(operation);`; these steps also apply to exceptional exits.
   */
  async perform<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assert();
    if (this.active.size) throw new AppError('常驻会话正在进行另一项控制操作', 409, 'SESSION_CONTROL_BUSY');
    const active = AbortSignal.any([this.signal, ...(signal ? [signal] : [])]);
    const operation = Promise.resolve().then(() => {
      active.throwIfAborted();
      return work(active);
    });
    this.active.add(operation);
    try {
      return await operation;
    } finally {
      this.active.delete(operation);
    }
  }
  /**
   * 入口 / Entry: ProjectSessionLifetime.close.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，结束、撤销或清理本次拥有的领域资源；本入口产生 `Promise.resolve()` / `this.closeTask` 供上层消费（`ProjectSessionLifetime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectSessionLifetime`; this entry produces `Promise.resolve()` / `this.closeTask` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `Promise.resolve`, `this.controller.abort`, `Promise.resolve().then().catch`, `Promise.resolve().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `this.controller.abort`, `Promise.resolve().then().catch`, `Promise.resolve().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `Promise.resolve()`; `this.closeTask`.
   * 副作用 / Effects: `this.controller.abort`; `this.instance.scope.observe`; 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.closeTask) {
      this.controller.abort();
      /**
       * 入口 / Entry: ProjectSessionLifetime.close.callback@202.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().catch）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().catch).
       * 输入 / Inputs: cause
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.cleanupFailures.add`; 更新 / updates `this.closeTask`.
       * 拒绝 / Refusals: 异常 / errors `error`.
       */
      /**
       * 入口 / Entry: ProjectSessionLifetime.close.callback@177.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.activity.release`; `this.lease.release`; `this.cleanupFailures.clear`; `registry.delete`; 更新 / updates `this.closed`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      this.closeTask = Promise.resolve()
        .then(async () => {
          await Promise.allSettled([...this.active]);
          // 原领域能力按捕获的完整回执核销；请求授权已撤销也不能阻止它清理已取得的资源。
          /**
           * 入口 / Entry: ProjectSessionLifetime.close.cleanup.
           * 功能：把本层请求转交 `withoutOperationContext`，沿用该实现的结果与失败路径。
           * Purpose: Delegates this request to `withoutOperationContext` and propagates the provider result or rejection.
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `withoutOperationContext(() => withResourceContext( { vmId: this.options.vmId, projectId: this.receipt.projectId, }, () => thi…`.
           * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          const cleanup = () =>
            withoutOperationContext(() =>
              withResourceContext(
                {
                  vmId: this.options.vmId,
                  projectId: this.receipt.projectId,
                },
                () => this.cleanup(structuredClone(this.receipt)),
              ),
            );
          await (this.instance ? withPluginCleanup(this.instance, cleanup) : cleanup());
          this.closed = true;
          this.detach();
          this.removeOwned();
          this.activity.release();
          this.lease.release();
          for (const error of this.cleanupFailures) this.confirmPluginCleanup(error);
          this.cleanupFailures.clear();
          const registry = sessions.get(this.options.machines),
            sessionKey = key(this.options.vmId, this.receipt);
          if (registry?.get(sessionKey) === this) registry.delete(sessionKey);
        })
        .catch((cause) => {
          const error =
            cause instanceof AppError && cause.status === 503
              ? cause
              : new AppError(
                  `常驻会话清理尚未确认：${cause instanceof Error ? cause.message : String(cause)}`,
                  503,
                  'SESSION_CLEANUP_PENDING',
                );
          this.lease.cleanupPending(error);
          this.activity.cleanupPending(error);
          this.cleanupFailures.add(error);
          this.closeTask = undefined;
          throw error;
        });
      this.instance?.scope.observe(this.closeTask);
    }
    return this.closeTask;
  }
  /** 领域提供刚核验的完整回执与原生停止协议，不能仅凭会话 ID 释放原运行。 */
  /**
   * 入口 / Entry: ProjectSessionLifetime.retire.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，结束、撤销或清理本次拥有的领域资源；本入口产生 `cleanup(receipt)` 供上层消费（`ProjectSessionLifetime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectSessionLifetime`; this entry produces `cleanup(receipt)` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `sessions.get().get`, `sessions.get`, `key`, `cleanup` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sessions.get().get`, `sessions.get`, `key`, `cleanup`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!owned`.
   * 输入 / Inputs: machines: Machines; vmId: string; receipt: R; cleanup: (receipt: R) => Promise<void>
   * 输出 / Returns: Promise<void>；结果来自 / values from `cleanup(receipt)`.
   * 副作用 / Effects: `owned.close`; 更新 / updates `owned.cleanup`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  static async retire<R extends SessionReceipt>(
    machines: Machines,
    vmId: string,
    receipt: R,
    cleanup: (receipt: R) => Promise<void>,
  ): Promise<void> {
    const owned = sessions.get(machines)?.get(key(vmId, receipt)) as ProjectSessionLifetime<R> | undefined;
    if (!owned) return cleanup(receipt);
    // 启动回执丢失时调用方可能只有旧意图；核对后交给原生清理的是本作用域已固定的完整回执。
    owned.assertReceipt(receipt, true);
    owned.cleanup = cleanup;
    await owned.close();
  }
  /** 领域重新装载后可以请求原所有者完成清理，连同它仍持有的准备子资源一起核销。 */
  /**
   * 入口 / Entry: ProjectSessionLifetime.retireOriginal.
   * 功能：在管理常驻项目会话的捕获身份与退休回执中，结束、撤销或清理本次拥有的领域资源；本入口产生 `fallback()` 供上层消费（`ProjectSessionLifetime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectSessionLifetime`; this entry produces `fallback()` for its caller. Module context: Owns persistent sessions and retirement receipts; closing an old session cannot affect a new guest runtime.
   * 处理：通过 `sessions.get().get`, `sessions.get`, `key`, `fallback` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sessions.get().get`, `sessions.get`, `key`, `fallback`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!owned`.
   * 输入 / Inputs: machines: Machines; vmId: string; receipt: R; fallback: () => Promise<void>
   * 输出 / Returns: Promise<void>；结果来自 / values from `fallback()`.
   * 副作用 / Effects: `owned.close`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  static async retireOriginal<R extends SessionReceipt>(
    machines: Machines,
    vmId: string,
    receipt: R,
    fallback: () => Promise<void>,
  ): Promise<void> {
    const owned = sessions.get(machines)?.get(key(vmId, receipt)) as ProjectSessionLifetime<R> | undefined;
    if (!owned) return fallback();
    owned.assertReceipt(receipt, true);
    await owned.close();
  }
}

/**
 * 模块职责：限定插件并发、等待期限与清理生命周期，保留失败清理并提供原作用域重试。
 * Module purpose: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
 */
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';

type Disposer = {
/**
 * 签名 / Signature: Disposer.work.
 * 功能：为限定插件并发、等待期限与清理生命周期声明 work 的输入与结果契约，所属容器为 Disposer。
 * Purpose: Declares the input/result contract for work in Disposer. Module responsibility: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: void | Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
work: () => void | Promise<void>; pending?: Promise<void>; done?: boolean };
const operationLimit = 128;

export class PluginScope {
  private controller = new AbortController();
  private disposers: Disposer[] = [];
  private active = new Set<Promise<unknown>>();
  private failures = new Map<string, unknown>();
  private recoveries = new Map<string, Promise<void>>();
  private closing?: Promise<void>;
  private resource?: ResourceLease;
  /**
   * 入口 / Entry: PluginScope.constructor.
   * 功能：建立 PluginScope 的限定插件并发、等待期限与清理生命周期上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the PluginScope context for this module's responsibility: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: owner: string optional
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `hostRuntime.register`; 更新 / updates `this.resource`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  constructor(owner?: string) {
    if (owner) this.resource = hostRuntime.register({ owner, kind: 'plugin-scope', label: '插件生命周期' });
  }
  /**
   * 入口 / Entry: PluginScope.signal.
   * 功能：向调用者提供 `this.controller.signal` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.controller.signal` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.controller.signal`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get signal() {
    return this.controller.signal;
  }
  /**
   * 入口 / Entry: PluginScope.add.
   * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginScope`; the calls and state transitions below complete the operation. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.signal.throwIfAborted`, `this.disposers.push` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.signal.throwIfAborted`, `this.disposers.push`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: disposer: () => void | Promise<void>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.disposers.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  add(disposer: () => void | Promise<void>) {
    this.signal.throwIfAborted();
    this.disposers.push({ work: disposer });
  }
  /** Retain receipts from already admitted work, even when cancellation preceded their arrival. */
  /**
   * 入口 / Entry: PluginScope.retainCleanup.
   * 功能：从当前输入或状态计算 `(confirmedError: unknown) => { for (const [id, error] of this.failures) if (error === confirmedError) this.failures.delete(id…`，供调用方后续验证或使用。
   * Purpose: Computes `(confirmedError: unknown) => { for (const [id, error] of this.failures) if (error === confirmedError) this.failures.delete(id…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: disposer: () => void | Promise<void>
   * 输出 / Returns: `(confirmedError: unknown) => { for (const [id, error] of this.failures) if (error === confirmedError) this.failures.delete(id…`.
   * 副作用 / Effects: `this.disposers.push`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  retainCleanup(disposer: () => void | Promise<void>) {
    this.disposers.push({ work: disposer });
    return (confirmedError: unknown) => {
      for (const [id, error] of this.failures) if (error === confirmedError) this.failures.delete(id);
    };
  }
  /**
   * 入口 / Entry: PluginScope.abort.
   * 功能：在限定插件并发、等待期限与清理生命周期中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PluginScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginScope`; the calls and state transitions below complete the operation. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.controller.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: reason: unknown optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  abort(reason?: unknown) {
    this.controller.abort(reason);
  }
  /**
   * 入口 / Entry: PluginScope.run.
   * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `pending` 供上层消费（`PluginScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginScope`; this entry produces `pending` for its caller. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.signal.throwIfAborted`, `Promise.resolve().then`, `Promise.resolve`, `this.observe` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.signal.throwIfAborted`, `Promise.resolve().then`, `Promise.resolve`, `this.observe`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T> | T
   * 输出 / Returns: Promise<T>；结果来自 / values from `pending`.
   * 副作用 / Effects: `this.observe`.
   * 拒绝 / Refusals: 条件 / conditions `this.active.size >= operationLimit`; 异常 / errors `new AppError('插件等待队列已满', 429, 'PLUGIN_QUEUE_FULL')`.
   */
  run<T>(work: () => Promise<T> | T): Promise<T> {
    this.signal.throwIfAborted();
    if (this.active.size >= operationLimit) throw new AppError('插件等待队列已满', 429, 'PLUGIN_QUEUE_FULL');
    const pending = Promise.resolve().then(() => {
      this.signal.throwIfAborted();
      return work();
    });
    this.observe(pending);
    return pending;
  }
  /**
   * 入口 / Entry: PluginScope.observe.
   * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`PluginScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginScope`; this entry produces `void` for its caller. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.active.has`, `this.active.add`, `pending.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.has`, `this.active.add`, `pending.then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.active.has(pending)`.
   * 输入 / Inputs: pending: Promise<unknown>
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.active.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  observe(pending: Promise<unknown>) {
    if (this.active.has(pending)) return;
    this.active.add(pending);
    void pending.then(
      () => this.active.delete(pending),
      (error) => {
        this.active.delete(pending);
        if (
          error instanceof AppError &&
          error.status === 503 &&
          /CLEANUP|UNCONFIRMED/.test(error.code || '')
        ) {
          if (![...this.failures.values()].includes(error)) this.failures.set(randomUUID(), error);
          this.resource?.cleanupPending(error);
        }
      },
    );
  }
  /**
   * 入口 / Entry: PluginScope.diagnostics.
   * 功能：从当前输入或状态计算 `{ resourceId: this.resource?.id, active: this.active.size, revoked: this.signal.aborted, cleanup: [...this.failures].map(([id…`，供调用方后续验证或使用。
   * Purpose: Computes `{ resourceId: this.resource?.id, active: this.active.size, revoked: this.signal.aborted, cleanup: [...this.failures].map(([id…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ resourceId: this.resource?.id, active: this.active.size, revoked: this.signal.aborted, cleanup: [...this.failures].map(([id…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  diagnostics() {
    return {
      resourceId: this.resource?.id,
      active: this.active.size,
      revoked: this.signal.aborted,
      cleanup: [...this.failures].map(([id, error]) => ({ id, error: String(error) })),
    };
  }
  /**
   * 入口 / Entry: PluginScope.cleanupPending.
   * 功能：在限定插件并发、等待期限与清理生命周期中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`PluginScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginScope`; the calls and state transitions below complete the operation. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.resource.cleanupPending` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.resource.cleanupPending`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: error: unknown
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  cleanupPending(error: unknown) {
    this.resource?.cleanupPending(error);
  }
  /** Trusted domain recovery must confirm physical cleanup before resolving its receipt. */
  /**
   * 入口 / Entry: PluginScope.recoverCleanup.
   * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `existing` 供上层消费（`PluginScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginScope`; this entry produces `existing` for its caller. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.failures.has`, `this.recoveries.get`, `Promise.resolve().then().then`, `Promise.resolve().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.failures.has`, `this.recoveries.get`, `Promise.resolve().then().then`, `Promise.resolve().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `existing`.
   * 输入 / Inputs: id: string; recover: () => Promise<void>
   * 输出 / Returns: `existing`.
   * 副作用 / Effects: `this.recoveries.set`; `this.active.add`; `this.active.delete`; `this.recoveries.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!this.failures.has(id)`; 异常 / errors `new AppError('清理回执不属于此插件', 404, 'PLUGIN_CLEANUP_UNKNOWN')`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(pending);`; `this.recoveries.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(pending);`; `this.recoveries.delete(id);`; these steps also apply to exceptional exits.
   */
  async recoverCleanup(id: string, recover: () => Promise<void>) {
    if (!this.failures.has(id)) throw new AppError('清理回执不属于此插件', 404, 'PLUGIN_CLEANUP_UNKNOWN');
    const existing = this.recoveries.get(id);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(recover)
      .then(() => {
        this.failures.delete(id);
      });
    this.recoveries.set(id, pending);
    this.active.add(pending);
    try {
      await pending;
    } finally {
      this.active.delete(pending);
      this.recoveries.delete(id);
    }
  }
  /**
   * 入口 / Entry: PluginScope.settled.
   * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`PluginScope`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `PluginScope`; the calls and state transitions below complete the operation. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `Promise.allSettled` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async settled() {
    while (this.active.size) await Promise.allSettled([...this.active]);
  }
  /**
   * 入口 / Entry: PluginScope.dispose.
   * 功能：在限定插件并发、等待期限与清理生命周期中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closing` / `closing` 供上层消费（`PluginScope`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `PluginScope`; this entry produces `this.closing` / `closing` for its caller. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
   * 处理：通过 `this.abort`, `inline`, `closing.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort`, `inline`, `closing.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closing`.
   * 输入 / Inputs: run: (dispose: () => void | Promise<void>) => Promise<void> default=async (dispose) => { await dispose(); }
   * 输出 / Returns: `this.closing`; `closing`.
   * 副作用 / Effects: `this.abort`; 更新 / updates `this.closing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  dispose(
    run: (dispose: () => void | Promise<void>) => Promise<void> = async (dispose) => {
      await dispose();
    },
  ) {
    this.abort();
    if (this.closing) return this.closing;
    /**
     * 入口 / Entry: PluginScope.dispose.callback@107.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.settled`; `errors.push`; `this.resource.release`; 更新 / updates `this.disposers`.
     * 拒绝 / Refusals: 条件 / conditions `errors.length`; 异常 / errors `error`.
     * 失败处理：catch 分支执行 `if (!errors.includes(error)) errors.push(error);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (!errors.includes(error)) errors.push(error);`; these statements determine whether a failure is absorbed or rejected again.
     */
    const closing = (async () => {
      this.resource?.beginCleanup?.();
      const errors: unknown[] = [];
      // Cancellation is not completion: callers may bound this wait, but retain this scope on timeout.
      await this.settled();
      for (const disposer of [...this.disposers].reverse()) {
        if (disposer.done) continue;
        try {
          /**
           * 入口 / Entry: PluginScope.dispose.callback@115.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（run）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (run).
           * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
           * 输出 / Returns: `disposer.pending`.
           * 副作用 / Effects: 更新 / updates `disposer.pending`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          await run(() => {
            if (!disposer.pending) {
              const pending = Promise.resolve().then(disposer.work);
              disposer.pending = pending;
              void pending.then(
                () => {
                  disposer.done = true;
                },
                () => {
                  disposer.pending = undefined;
                },
              );
            }
            return disposer.pending;
          });
        } catch (error) {
          if (!errors.includes(error)) errors.push(error);
        }
      }
      for (const error of this.failures.values()) if (!errors.includes(error)) errors.push(error);
      if (errors.length) {
        const error = new AggregateError(errors, '插件资源清理失败');
        this.resource?.cleanupPending(error);
        throw error;
      }
      this.disposers = [];
      this.resource?.release();
    })();
    this.closing = closing;
    void closing.catch(() => {
      if (this.closing === closing) this.closing = undefined;
    });
    return closing;
  }
}

/**
 * 入口 / Entry: withinDeadline.
 * 功能：在限定插件并发、等待期限与清理生命周期中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await Promise.race([ Promise.resolve(operation), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { onTime…` 供上层消费（`plugin-scope.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `plugin-scope.ts`; this entry produces `await Promise.race([ Promise.resolve(operation), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { onTime…` for its caller. Module context: Bounds plugin concurrency, waits and cleanup, retaining failed disposals for original-scope retry.
 * 处理：通过 `Promise.race`, `Promise.resolve`, `clearTimeout` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `Promise.race`, `Promise.resolve`, `clearTimeout`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `timer`.
 * 输入 / Inputs: operation: Promise<T> | T; milliseconds: number; label: string; onTimeout: () => void default=() => {}
 * 输出 / Returns: Promise<T>；结果来自 / values from `await Promise.race([ Promise.resolve(operation), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { onTime…`.
 * 副作用 / Effects: `clearTimeout`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `if (timer) clearTimeout(timer);`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `if (timer) clearTimeout(timer);`; these steps also apply to exceptional exits.
 */
export async function withinDeadline<T>(
  operation: Promise<T> | T,
  milliseconds: number,
  label: string,
  onTimeout: () => void = () => {},
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new Error(`${label}超过 ${milliseconds} 毫秒`));
        }, milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

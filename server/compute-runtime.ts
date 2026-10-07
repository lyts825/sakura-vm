/**
 * 模块职责：管理有期限的计算工作线程与宿主资源额度；退出未确认的线程保留清理状态。
 * Module purpose: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
 */
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { AppError } from '../shared/errors.ts';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';
import { withinDeadline } from './plugin-scope.ts';
import { hostRuntime, type HostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { runtimeTimings } from './runtime-timings.ts';

export type ComputeWork = { source: string | URL; options?: WorkerOptions };
type ComputeOptions = { owner: string; label: string; memoryBytes: number; signal?: AbortSignal;
  timeoutMs?: number; partition?: { key: string; limit: number } };
type Retiring = { worker: Worker; lease: ResourceLease; exit: Promise<void>; instance?: PluginInstance };

/** Trusted adapters choose fixed code; callers supply data only. Workers are created
 * on demand and retire after one task, so idle capacity returns to the host. */
export class ComputeRuntime {
  private readonly abort = new AbortController();
  private tasks = new Set<Promise<unknown>>();
  private retiring = new Set<Retiring>();
  /**
   * 入口 / Entry: ComputeRuntime.constructor.
   * 功能：建立 ComputeRuntime 的管理有期限的计算工作线程与宿主资源额度上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ComputeRuntime context for this module's responsibility: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: registry: HostRuntime default=hostRuntime; spawn: default=(source: string | URL, options?: WorkerOptions) => new …
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private readonly registry: HostRuntime = hostRuntime,
    private readonly spawn = (source: string | URL, options?: WorkerOptions) => new Worker(source, options)) {}

  /**
   * 入口 / Entry: ComputeRuntime.run.
   * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING'))` / `task` 供上层消费（`ComputeRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; this entry produces `Promise.reject(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING'))` / `task` for its caller. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
   * 处理：通过 `pluginAuthority`, `instance.check`, `AbortSignal.any`, `Promise.reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `instance.check`, `AbortSignal.any`, `Promise.reject`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `instance`; `this.abort.signal.aborted`.
   * 输入 / Inputs: options: ComputeOptions; prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>
   * 输出 / Returns: Promise<T>；结果来自 / values from `Promise.reject(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING'))`; `task`.
   * 副作用 / Effects: `AbortSignal.any`; `this.execute`; `instance.scope.observe`; `this.tasks.add`; 更新 / updates `options`, `prepare`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  run<T>(options: ComputeOptions, prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>): Promise<T> {
    const instance = pluginAuthority();
    instance?.check('compute', true);
    if (instance) {
      options = { ...options, owner: instance.owner,
        signal: options.signal ? AbortSignal.any([options.signal, instance.signal]) : instance.signal };
      const original = prepare;
      /**
       * 入口 / Entry: ComputeRuntime.run.prepare.
       * 功能：把本层请求转交 `withPluginAuthority`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `withPluginAuthority` and propagates the provider result or rejection.
       * 输入 / Inputs: signal
       * 输出 / Returns: `withPluginAuthority(instance, () => original(signal), () => instance.check('compute', true))`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      prepare = signal => withPluginAuthority(instance, () => original(signal), () => instance.check('compute', true));
    }
    if (this.abort.signal.aborted) return Promise.reject(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING'));
    const task = this.execute<T>(options, prepare);
    instance?.scope.observe(task);
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }

  /**
   * 入口 / Entry: ComputeRuntime.execute.
   * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`ComputeRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; this entry produces `result` for its caller. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
   * 处理：通过 `AbortSignal.any`, `runtimeTimings.measure`, `prepare`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `AbortSignal.any`, `runtimeTimings.measure`, `prepare`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: options: ComputeOptions; prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>
   * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
   * 副作用 / Effects: `AbortSignal.any`; `this.spawn`; `lease.release`; `runtimeTimings.start`; 更新 / updates `worker`.
   * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000`; 异常 / errors `new AppError('计算执行期限无效', 400, 'RESOURCE_INVALID')`; `error`.
   * 失败处理：catch 分支执行 `lease.release();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `lease.release();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async execute<T>(options: ComputeOptions, prepare: (signal: AbortSignal) => ComputeWork | Promise<ComputeWork>): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new AppError('计算执行期限无效', 400, 'RESOURCE_INVALID');
    const signal = options.signal ? AbortSignal.any([this.abort.signal, options.signal]) : this.abort.signal;
    const lease = await runtimeTimings.measure('compute', 'queue', () => this.registry.acquire({ owner: options.owner, kind: 'compute-worker', label: options.label,
      cost: { 'compute.worker': 1, 'compute.memory': options.memoryBytes }, signal,
      partitions: options.partition ? [options.partition] : undefined }));
    let worker: Worker;
    try {
      // Reserve memory before loading/copying any input, including while queued.
      const work = await prepare(signal);
      signal.throwIfAborted();
      worker = this.spawn(work.source, work.options);
    } catch (error) { lease.release(); throw error; }
    const endExecution = runtimeTimings.start('compute', 'execution');
    let endCleanup: (
    /**
     * 中文功能：结束当前 compute 清理阶段的耗时采样，由 runtimeTimings.start 在进入清理时提供。
     * English: Ends the current compute-cleanup timing sample, supplied by runtimeTimings.start when cleanup begins.
     * 所属 / Owner: ComputeRuntime.execute.endCleanup.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void) | undefined;
    /**
     * 入口 / Entry: ComputeRuntime.execute.callback@60.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
     * 输入 / Inputs: resolve; reject
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.retiring.add`; `setTimeout`; `signal.addEventListener`; `aborted`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const result = await new Promise<T>((resolve, reject) => {
      let complete = false, outcome: { result?: T; error?: unknown } | undefined;
      let ended!:
      /**
       * 中文功能：工作线程真实退出时结算 retiring.exit 的本地完成通道。
       * English: Local completion channel settling retiring.exit when the worker actually exits.
       * 所属 / Owner: ComputeRuntime.execute.result.ended.
       * 输入 / Inputs: 无显式参数 / no explicit parameters.
       * 结果 / Result: `void`.
       */
      () => void;
      const retiring = { worker, lease, instance: pluginAuthority(), exit: new Promise<void>((done) => { ended = done; }) };
      this.retiring.add(retiring);
      /**
       * 入口 / Entry: ComputeRuntime.execute.cleanListeners.
       * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ComputeRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; the calls and state transitions below complete the operation. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
       * 处理：通过 `clearTimeout`, `signal.removeEventListener` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `clearTimeout`, `signal.removeEventListener`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `clearTimeout`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cleanListeners = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); };
      /**
       * 入口 / Entry: ComputeRuntime.execute.settle.
       * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ComputeRuntime`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; this entry produces `void` for its caller. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
       * 处理：通过 `cleanListeners`, `resolve`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `cleanListeners`, `resolve`, `reject`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `complete`; `outcome && !('error' in outcome)`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: 更新 / updates `complete`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const settle = () => {
        if (complete) return;
        complete = true; cleanListeners();
        if (outcome && !('error' in outcome)) resolve(outcome.result as T);
        else reject(outcome?.error ?? new AppError('计算工作线程提前退出', 502, 'COMPUTE_EXIT'));
      };
      /**
       * 入口 / Entry: ComputeRuntime.execute.stop.
       * 功能：在管理有期限的计算工作线程与宿主资源额度中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`ComputeRuntime`）。
       * Purpose: Ends, revokes or cleans resources owned by this domain action in `ComputeRuntime`; this entry produces `void` for its caller. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
       * 处理：通过 `endExecution`, `runtimeTimings.start`, `cleanListeners`, `worker.terminate().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `endExecution`, `runtimeTimings.start`, `cleanListeners`, `worker.terminate().catch`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `outcome`.
       * 输入 / Inputs: next: NonNullable<typeof outcome>
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `runtimeTimings.start`; 更新 / updates `endCleanup`, `outcome`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const stop = (next: NonNullable<typeof outcome>) => {
        if (outcome) return;
        endExecution(); endCleanup = runtimeTimings.start('compute', 'cleanup');
        outcome = next; cleanListeners();
        // The exit event is the physical release receipt. A rejected terminate
        // keeps ownership registered and is retried by close(), never guessed.
        /**
         * 入口 / Entry: ComputeRuntime.execute.callback@78.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（worker.terminate().catch）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (worker.terminate().catch).
         * 输入 / Inputs: error
         * 输出 / Returns: `void`.
         * 副作用 / Effects: `settle`; 更新 / updates `outcome`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        void worker.terminate().catch((error) => {
          if (!this.retiring.has(retiring)) return;
          const failure = new AppError(`计算工作线程清理尚未确认：${String(error)}`, 503, 'COMPUTE_CLEANUP_PENDING');
          lease.cleanupPending(failure); outcome = { error: failure }; settle();
        });
      };
      /**
       * 入口 / Entry: ComputeRuntime.execute.aborted.
       * 功能：把本层请求转交 `stop`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `stop` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `stop({ error: signal.reason })`.
       * 副作用 / Effects: `stop`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const aborted = () => stop({ error: signal.reason });
      const timer = setTimeout(() => stop({ error: new AppError('计算执行超时', 408, 'COMPUTE_TIMEOUT') }), timeoutMs);
      worker.once('message', (message: { ok?: boolean; result?: T; error?: string; status?: number; code?: string } | null) => {
        if (message?.ok === true) stop({ result: message.result });
        else stop({ error: new AppError(message?.error || '计算返回无效结果',
          Number.isInteger(message?.status) && message!.status! >= 400 && message!.status! <= 599 ? message!.status! : 409,
          message?.code || 'COMPUTE_FAILED') });
      });
      worker.once('error', (error) => stop({ error }));
      /**
       * 入口 / Entry: ComputeRuntime.execute.callback@93.
       * 功能：响应登记事件，按下述条件处理当前连接或资源的数据（worker.once / exit）。
       * Purpose: Handles the registered event and processes current connection/resource data under the conditions below (worker.once / exit).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `lease.release`; `this.retiring.delete`; `settle`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      worker.once('exit', () => {
        endExecution(); endCleanup?.();
        cleanListeners(); lease.release(); this.retiring.delete(retiring); ended(); settle();
      });
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    });
    signal.throwIfAborted();
    return result;
  }

  /**
   * 入口 / Entry: ComputeRuntime.beginDrain.
   * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ComputeRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; the calls and state transitions below complete the operation. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
   * 处理：通过 `this.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.abort.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.abort.abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beginDrain() { this.abort.abort(new AppError('计算服务正在关闭', 503, 'RESOURCE_DRAINING')); }
  /**
   * 入口 / Entry: ComputeRuntime.recover.
   * 功能：在管理有期限的计算工作线程与宿主资源额度中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ComputeRuntime`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ComputeRuntime`; the calls and state transitions below complete the operation. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
   * 处理：通过 `inline.filter`, `withinDeadline`, `Promise.resolve().then`, `Promise.resolve` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.filter`, `withinDeadline`, `Promise.resolve().then`, `Promise.resolve`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: instance: PluginInstance
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async recover(instance: PluginInstance) {
    const receipts = [...this.retiring].filter(entry => entry.instance?.identity === instance.identity &&
      entry.instance.generation === instance.generation);
    for (const { worker, exit } of receipts)
      await withinDeadline(Promise.resolve(worker.terminate()).then(() => exit), 5000, '原计算线程清理');
  }
  /**
   * 入口 / Entry: ComputeRuntime.close.
   * 功能：在管理有期限的计算工作线程与宿主资源额度中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`ComputeRuntime`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ComputeRuntime`; the calls and state transitions below complete the operation. Module context: Owns deadline-bound compute workers and host budgets; workers without confirmed exit retain pending cleanup ownership.
   * 处理：通过 `this.beginDrain`, `Promise.allSettled`, `inline.map`, `results.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.beginDrain`, `Promise.allSettled`, `inline.map`, `results.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `results.some((result) => result.status === 'rejected') || this.retiring.size`; 异常 / errors `new AppError('计算工作线程清理尚未确认', 503, 'COMPUTE_CLEANUP_PENDING')`.
   */
  async close() {
    this.beginDrain();
    await Promise.allSettled([...this.tasks]);
    const results = await Promise.allSettled([...this.retiring].map(async ({ worker, exit }) => {
      await worker.terminate(); await exit;
    }));
    if (results.some((result) => result.status === 'rejected') || this.retiring.size)
      throw new AppError('计算工作线程清理尚未确认', 503, 'COMPUTE_CLEANUP_PENDING');
  }
}

export const computeRuntime = new ComputeRuntime();

/**
 * 模块职责：管理任务执行、日志、结果和取消，检测任务等待循环并保留待恢复资源。
 * Module purpose: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
 */
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { writeStore } from './local-store.ts';
import { hostRuntime, withResourceContext } from './host-runtime/index.ts';
import { withNewResourceContext } from './host-runtime/context.ts';
import { withoutAuditParent } from './audit.ts';
import { captureOperationCheck, withoutOperationContext, operationReceiptId } from './operation-context.ts';
import { pluginAuthority, withPluginAuthority } from './plugin-authority.ts';
import { runtimeTimings } from './runtime-timings.ts';

export type { JobMeta, JobView, JobUpdate } from '../shared/contracts/jobs.ts';
import type { JobMeta, JobView, JobUpdate } from '../shared/contracts/jobs.ts';
/**
 * 签名 / Signature: Work.Work.
 * 功能：为管理任务执行、日志、结果和取消声明 Work 的输入与结果契约，所属容器为 Work。
 * Purpose: Declares the input/result contract for Work in Work. Module responsibility: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
 * 输入 / Inputs: log: (text: string) => void; signal: AbortSignal; update: JobUpdate; result: (value: unknown) => Promise<void>
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
type Work = (
  log: (text: string) => void,
  signal: AbortSignal,
  update: JobUpdate,
  result: (value: unknown) => Promise<void>,
) => Promise<void>;
const cleanupFailureCodes = new Set([
  'GUEST_TASK_CLEANUP_FAILED', 'SERVICE_CLEANUP_FAILED',
  'PROJECT_MAIN_CLEANUP_FAILED', 'PROJECT_SSH_CLEANUP_FAILED',
  'PROJECT_IDENTITY_CLEANUP_FAILED',
  'PROJECT_IDENTITY_NETWORK_CLEANUP_FAILED',
  'PROJECT_REPOSITORY_CLEANUP_FAILED',
  'RUNTIME_INSTALL_CLEANUP_FAILED',
  'BROWSER_IDE_CLEANUP_FAILED',
  'NOTEBOOK_CLEANUP_FAILED', 'NOTEBOOK_PREPARE_CLEANUP_FAILED',
  'DESKTOP_CLEANUP_FAILED', 'LINUX_CLIPBOARD_CLEANUP_FAILED',
  'HOST_PROCESS_CLEANUP_PENDING', 'STORAGE_CLEANUP_PENDING',
  'VM_CLEANUP_PENDING', 'EXECUTION_CLEANUP_PENDING',
  'PLUGIN_CLEANUP_PENDING',
  'SESSION_CLEANUP_PENDING',
  'COMPUTE_CLEANUP_PENDING',
]);
type JobResource = Awaited<ReturnType<typeof hostRuntime.acquire>>;
type JobContext = { id: string; lease: JobResource; signal: AbortSignal; open: boolean;
  children: Map<string, Promise<void>>; tail: Promise<void>; cleanupFailure?: Error };
const context = new AsyncLocalStorage<JobContext>();
const delegatedQueueLimit = 64;
// Bound synchronous start() calls before their asynchronous governor admissions.
// These are registration ceilings; the host runtime remains the only execution budget.
const pendingJobLimit = 272, ownerPendingLimit = 80, pendingControlReserve = 16, ownerControlReserve = 2;
let pendingJobs = 0;
const pendingOwners = new Map<string, number>();
const dependencies = new Map<string, Map<string, number>>();
/**
 * 入口 / Entry: dependsOn.
 * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `() => { const count = links.get(target) || 0; if (count > 1) links.set(target, count - 1); else links.delete(target); if (!li…` 供上层消费（`jobs.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `jobs.ts`; this entry produces `() => { const count = links.get(target) || 0; if (count > 1) links.set(target, count - 1); else links.delete(target); if (!li…` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
 * 处理：通过 `reaches`, `dependencies.get`, `dependencies.set`, `links.set` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `reaches`, `dependencies.get`, `dependencies.set`, `links.set`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: source: string; target: string
 * 输出 / Returns: () => void；结果来自 / values from `() => { const count = links.get(target) || 0; if (count > 1) links.set(target, count - 1); else links.delete(target); if (!li…`.
 * 副作用 / Effects: `dependencies.set`; `links.set`.
 * 拒绝 / Refusals: 条件 / conditions `reaches(target)`; 异常 / errors `new AppError('任务之间存在循环等待', 409, 'JOB_DEPENDENCY_CYCLE')`.
 */
function dependsOn(source: string, target: string): () => void {
  /**
   * 入口 / Entry: dependsOn.reaches.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `true` / `false` 供上层消费（`jobs.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `jobs.ts`; this entry produces `true` / `false` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `seen.has`, `seen.add`, `inline.some`, `dependencies.get().keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `seen.has`, `seen.add`, `inline.some`, `dependencies.get().keys`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `id === source`; `seen.has(id)`.
   * 输入 / Inputs: id: string; seen: default=new Set<string>()
   * 输出 / Returns: boolean；结果来自 / values from `true`; `false`; `[...(dependencies.get(id)?.keys() || [])].some((next) => reaches(next, seen))`.
   * 副作用 / Effects: `seen.add`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const reaches = (id: string, seen = new Set<string>()): boolean => {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return [...(dependencies.get(id)?.keys() || [])].some((next) => reaches(next, seen));
  };
  if (reaches(target)) throw new AppError('任务之间存在循环等待', 409, 'JOB_DEPENDENCY_CYCLE');
  const links = dependencies.get(source) || new Map<string, number>(); dependencies.set(source, links);
  links.set(target, (links.get(target) || 0) + 1);
  return () => {
    const count = links.get(target) || 0;
    if (count > 1) links.set(target, count - 1); else links.delete(target);
    if (!links.size) dependencies.delete(source);
  };
}
/**
 * 入口 / Entry: waitFor.
 * 功能：从当前输入或状态计算 `new Promise<void>((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reas…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<void>((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reas…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: promise: Promise<void>; signal: AbortSignal
 * 输出 / Returns: `new Promise<void>((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reas…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
function waitFor(promise: Promise<void>, signal: AbortSignal) {
  /**
   * 入口 / Entry: waitFor.callback@71.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（current continuation）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (current continuation).
   * 输入 / Inputs: resolve; reject
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `signal.addEventListener`; `abort`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return new Promise<void>((resolve, reject) => {
    /**
     * 入口 / Entry: waitFor.abort.
     * 功能：在管理任务执行、日志、结果和取消中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`jobs.ts`）。
     * Purpose: Ends, revokes or cleans resources owned by this domain action in `jobs.ts`; the calls and state transitions below complete the operation. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
     * 处理：通过 `signal.removeEventListener`, `reject` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `signal.removeEventListener`, `reject`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(() => { signal.removeEventListener('abort', abort); resolve(); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export class Jobs {
  /** Schedule independent background work without borrowing the registering job's slot or credentials. */
  /**
   * 入口 / Entry: Jobs.detached.
   * 功能：把本层请求转交 `withoutOperationContext`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `withoutOperationContext` and propagates the provider result or rejection.
   * 输入 / Inputs: work: () => T
   * 输出 / Returns: T；结果来自 / values from `withoutOperationContext(() => withoutAuditParent(() => context.exit(() => withNewResourceContext({}, work))))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  static detached<T>(work: () => T): T {
    return withoutOperationContext(() => withoutAuditParent(() => context.exit(() => withNewResourceContext({}, work))));
  }
  /**
   * 签名 / Signature: Jobs.instrument.
   * 功能：为管理任务执行、日志、结果和取消声明 instrument 的输入与结果契约，所属容器为 Jobs。
   * Purpose: Declares the input/result contract for instrument in Jobs. Module responsibility: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 输入 / Inputs: view: JobView; work: () => Promise<void>
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  static instrument?: (view: JobView, work:
  /**
   * 中文功能：将 Jobs.instrument.work 所属工作交给原调用上下文，按声明返回业务结果或异步拒绝。
   * English: Supplies work to the original context owned by Jobs.instrument.work, returning the declared business result or asynchronous rejection.
   * 所属 / Owner: Jobs.instrument.work.
   * 输入 / Inputs: 无显式参数 / no explicit parameters.
   * 结果 / Result: `Promise<void>`.
   */
  () => Promise<void>) => Promise<void>;
  private closed = false;
  private closeTask?: Promise<void>;
  private items = new Map<string, { view: JobView; abort: AbortController; done: Promise<void> }>();
  private history: JobView[] = [];
  private queue = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private file?: string;
  private persisted?: string;
  private results = new Map<string, string>();
  private cleanups = new Map<string, { view: JobView; lease?: JobResource }>();
  persistenceError?: string;
  private pluginLifetime = pluginAuthority();
  /**
   * 入口 / Entry: Jobs.constructor.
   * 功能：建立 Jobs 的管理任务执行、日志、结果和取消上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Jobs context for this module's responsibility: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: scope: string optional; directory: default=join(DATA, 'jobs')
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `lifetime.signal.addEventListener`; `lifetime.scope.add`; `this.registerCleanup`; `this.persist`; 更新 / updates `this.file`, `this.history`, `this.persisted`, `this.persistenceError`.
   * 拒绝 / Refusals: 条件 / conditions `!Array.isArray(values) || values.some( (v) => !v || typeof v.id !== 'string' || typeof v.key !== 'string' || typeof v.log !==…`; 异常 / errors `new Error('任务历史格式无效')`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.persistenceError = '任务历史读取失败';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.persistenceError = '任务历史读取失败';`; these statements determine whether a failure is absorbed or rejected again.
   */
  constructor(
    private scope?: string,
    directory = join(DATA, 'jobs'),
  ) {
    if (this.pluginLifetime) {
      const lifetime = this.pluginLifetime;
      lifetime.check('jobs', true);
      lifetime.contribute('jobs', scope || 'volatile');
      /**
       * 入口 / Entry: Jobs.constructor.cancel.
       * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Jobs`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; the calls and state transitions below complete the operation. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
       * 处理：通过 `this.items.values`, `item.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.items.values`, `item.abort.abort`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `item.abort.abort`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => { for (const item of this.items.values()) item.abort.abort(lifetime.signal.reason); };
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      lifetime.scope.add(async () => {
        await this.close();
        if (this.cleanups.size) throw new AppError('插件任务仍有资源等待恢复', 503, 'PLUGIN_CLEANUP_PENDING');
        lifetime.signal.removeEventListener('abort', cancel);
      });
    }
    if (!scope) return;
    this.file = join(directory, `${scope}.json`);
    try {
      const values = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        !Array.isArray(values) ||
        values.some(
          (v) =>
            !v ||
            typeof v.id !== 'string' ||
            typeof v.key !== 'string' ||
            typeof v.log !== 'string' ||
            !Number.isFinite(Date.parse(v.startedAt)) ||
            !['running', 'done', 'error', 'cancelled', 'interrupted'].includes(v.status),
        )
      )
        throw new Error('任务历史格式无效');
      this.history = values.slice(-200).map((view: JobView) =>
        view.status === 'running'
          ? {
              ...view,
              status: 'interrupted',
              admission: view.admission === 'cleanup-pending' ? 'cleanup-pending' : undefined,
              resourceWait: undefined,
              ...(view.execution
                ? { execution: { ...view.execution, outcome: 'interrupted' as const } }
                : {}),
              finishedAt: new Date().toISOString(),
              error: '服务已重启，任务中断，请检查结果后重试',
            }
          : view,
      );
      this.persisted = JSON.stringify(values);
      for (const view of this.history) if (view.admission === 'cleanup-pending')
        this.registerCleanup(view, new Error(view.error || '任务资源清理尚未确认'));
      this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.persistenceError = '任务历史读取失败';
    }
  }
  /**
   * 入口 / Entry: Jobs.persist.
   * 功能：在管理任务执行、日志、结果和取消中，校验并提交领域状态变更；本入口产生 `void` 供上层消费（`Jobs`）。
   * Purpose: Validates and commits a domain state change in `Jobs`; this entry produces `void` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `setTimeout`, `this.timer.unref` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `setTimeout`, `this.timer.unref`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.file || this.timer`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `setTimeout`; 更新 / updates `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private persist() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 250);
    this.timer.unref();
  }
  /**
   * 入口 / Entry: Jobs.flush.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; this entry produces `void` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `clearTimeout`, `this.queue.catch().then().catch`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `this.queue.catch().then().catch`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.file`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearTimeout`; 更新 / updates `this.timer`, `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file) return;
    const file = this.file,
      data = JSON.stringify(this.history);
    /**
     * 入口 / Entry: Jobs.flush.callback@169.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.queue.catch().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.queue.catch().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.persisted`, `this.persistenceError`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (data === this.persisted && !this.persistenceError) return;
        await writeStore(file, JSON.parse(data));
        this.persisted = data;
        this.persistenceError = undefined;
      })
      .catch(() => {
        this.persistenceError = '任务历史保存失败，请检查磁盘空间和权限';
      });
    await this.queue;
  }
  /**
   * 入口 / Entry: Jobs.list.
   * 功能：把本层请求转交 `inline.reverse`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `inline.reverse` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `[...this.history].reverse()`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  list() {
    return [...this.history].reverse();
  }
  /**
   * 入口 / Entry: Jobs.view.
   * 功能：在管理任务执行、日志、结果和取消中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.items.get(key)?.view || this.history.findLast((v) => v.key === key) || null` 供上层消费（`Jobs`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Jobs`; this entry produces `this.items.get(key)?.view || this.history.findLast((v) => v.key === key) || null` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.items.get`, `this.history.findLast` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.items.get`, `this.history.findLast`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string
   * 输出 / Returns: `this.items.get(key)?.view || this.history.findLast((v) => v.key === key) || null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(key: string) {
    return this.items.get(key)?.view || this.history.findLast((v) => v.key === key) || null;
  }
  /**
   * 入口 / Entry: Jobs.get.
   * 功能：把本层请求转交 `this.history.find`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.history.find` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.history.find((v) => v.id === id)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  get(id: string) {
    return this.history.find((v) => v.id === id);
  }
  /**
   * 入口 / Entry: Jobs.registerCleanup.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; this entry produces `void` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.cleanups.has`, `this.cleanups.set`, `hostRuntime.register`, `inline.slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.cleanups.has`, `this.cleanups.set`, `hostRuntime.register`, `inline.slice`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!view.id || this.cleanups.has(view.id)`.
   * 输入 / Inputs: view: JobView; error: Error
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.cleanups.set`; `hostRuntime.register`; 更新 / updates `pending.lease`, `view.cleanupLeaseId`, `view.log`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `view.log = (view.log + `\n清理资源登记失败：${String(registrationError)}\n`).slice(-32768);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `view.log = (view.log + `\n清理资源登记失败：${String(registrationError)}\n`).slice(-32768);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private registerCleanup(view: JobView, error: Error) {
    if (!view.id || this.cleanups.has(view.id)) return;
    const pending: { view: JobView; lease?: JobResource } = { view };
    this.cleanups.set(view.id, pending);
    try {
      const lease = hostRuntime.register({ owner: view.owner || `jobs:${this.scope || 'anonymous'}`,
        kind: 'job-cleanup', label: (view.title || view.key || view.id).slice(0, 200), lane: 'control',
        identity: { operationId: view.id, jobId: view.id, vmId: view.vmId, projectId: view.projectId } });
      lease.cleanupPending(error); pending.lease = lease; view.cleanupLeaseId = lease.id;
    } catch (registrationError) {
      view.log = (view.log + `\n清理资源登记失败：${String(registrationError)}\n`).slice(-32768);
    }
  }
  /** Domain recovery calls this only after it has independently confirmed cleanup.
   * It resolves this Jobs instance's diagnostic marker, never an external resource lease. */
  /**
   * 入口 / Entry: Jobs.resolveCleanup.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `pending.view.admission`, `pending.view.cleanupResolvedAt`（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; the outcome is recorded in `pending.view.admission`, `pending.view.cleanupResolvedAt`. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.cleanups.get`, `pending.lease.release`, `this.cleanups.delete`, `this.flush` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.cleanups.get`, `pending.lease.release`, `this.cleanups.delete`, `this.flush`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `pending.lease.release`; `this.cleanups.delete`; 更新 / updates `pending.view.admission`, `pending.view.cleanupResolvedAt`.
   * 拒绝 / Refusals: 条件 / conditions `!pending`; 异常 / errors `new AppError('当前任务服务没有这项待清理记录', 404, 'JOB_CLEANUP_NOT_FOUND')`.
   */
  async resolveCleanup(id: string) {
    const pending = this.cleanups.get(id);
    if (!pending) throw new AppError('当前任务服务没有这项待清理记录', 404, 'JOB_CLEANUP_NOT_FOUND');
    pending.lease?.release(); this.cleanups.delete(id);
    pending.view.admission = undefined; pending.view.cleanupResolvedAt = new Date().toISOString();
    await this.flush();
  }
  /**
   * 入口 / Entry: Jobs.clearCompletedLogs.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ removedLogs: removed.length, removedBytes }` 供上层消费（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; this entry produces `{ removedLogs: removed.length, removedBytes }` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.get`, `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!view || view.status === 'running' || !view.log || createHash('sha256').update(view.log).digest('hex…`; `item.view.log === '' && item.view.logPruned?.at === at`.
   * 输入 / Inputs: entries: { id: string; signature: string }[]; at: string
   * 输出 / Returns: `{ removedLogs: removed.length, removedBytes }`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`; `removed.push`; `this.persist`; 更新 / updates `removedBytes`, `view.log`, `view.logPruned`, `item.view.log`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.persistenceError`; 异常 / errors `new AppError('任务服务正在关闭', 503)`; `new AppError('任务日志清理保存失败', 500)`.
   */
  async clearCompletedLogs(entries: { id: string; signature: string }[], at: string) {
    if (this.closed) throw new AppError('任务服务正在关闭', 503);
    const removed: { view: JobView; log: string; previous: JobView['logPruned'] }[] = [];
    let removedBytes = 0;
    for (const entry of entries) {
      const view = this.get(entry.id);
      if (
        !view ||
        view.status === 'running' ||
        view.admission === 'cleanup-pending' ||
        (view.cleanupLeaseId && !view.cleanupResolvedAt) ||
        !view.log ||
        createHash('sha256').update(view.log).digest('hex') !== entry.signature
      )
        continue;
      removed.push({ view, log: view.log, previous: view.logPruned });
      const bytes = Buffer.byteLength(view.log);
      removedBytes += bytes;
      view.log = '';
      view.logPruned = { at, bytes };
    }
    await this.flush();
    if (this.persistenceError) {
      for (const item of removed)
        if (item.view.log === '' && item.view.logPruned?.at === at) {
          item.view.log = item.log;
          item.view.logPruned = item.previous;
        }
      this.persist();
      throw new AppError('任务日志清理保存失败', 500);
    }
    return { removedLogs: removed.length, removedBytes };
  }
  /**
   * 入口 / Entry: Jobs.result.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `JSON.parse(data)` 供上层消费（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; this entry produces `JSON.parse(data)` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.get`, `inline.test`, `readFile`, `join` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.get`, `inline.test`, `readFile`, `join`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `JSON.parse(data)`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 拒绝 / Refusals: 条件 / conditions `!job?.result || !/^[a-f0-9-]{36}$/.test(id)`; `data === undefined || Buffer.byteLength(data) !== job.result.bytes || createHash('sha256').update(data).digest('hex') !== job…`; 异常 / errors `new AppError('任务没有保存结果', 404)`; `new AppError('任务结果校验失败', 409)`.
   */
  async result(id: string) {
    const job = this.get(id);
    if (!job?.result || !/^[a-f0-9-]{36}$/.test(id)) throw new AppError('任务没有保存结果', 404);
    const data = this.file
      ? await readFile(join(this.file + '.results', id + '.json'), 'utf8')
      : this.results.get(id);
    if (
      data === undefined ||
      Buffer.byteLength(data) !== job.result.bytes ||
      createHash('sha256').update(data).digest('hex') !== job.result.sha256
    )
      throw new AppError('任务结果校验失败', 409);
    return JSON.parse(data);
  }
  /**
   * 入口 / Entry: Jobs.start.
   * 功能：登记带身份和日志的任务，按宿主资源、父任务及兄弟顺序运行并保存终态。
   * Purpose: Registers identified/logged jobs, schedules them under host/parent/sibling constraints and persists terminal state.
   * 设计：注册前捕获原授权，排队后重查；委派子任务借用父槽位避免互等，清理未确认保留原任务资源和恢复记录。
   * Design: Authority is captured then rechecked after queuing; delegated jobs borrow parent slots to avoid deadlock, retaining unresolved cleanup ownership.
   * 输入 / Inputs: key: string; work: Work; meta: JobMeta default={}
   * 输出 / Returns: JobView；结果来自 / values from `withPluginAuthority(this.pluginLifetime, () => this.start(key, work, meta))`; `view`.
   * 副作用 / Effects: `pendingOwners.set`; `parent.signal.addEventListener`; `this.history.push`; `this.history.splice`; `this.items.delete`; 更新 / updates `meta`, `parent.tail`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.items.get(key)?.view.status === 'running'`; `pendingJobs >= pendingJobLimit - (control ? 0 : pendingControlReserve) || (pendingOwners.get(owner) || 0) >= ownerPendingLimi…`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('另一项操作仍在进行', 409)`.
   */
  start(key: string, work: Work, meta: JobMeta = {}): JobView {
    if (this.pluginLifetime && pluginAuthority() !== this.pluginLifetime)
      return withPluginAuthority(this.pluginLifetime, () => this.start(key, work, meta));
    this.pluginLifetime?.check('jobs', true);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.items.get(key)?.view.status === 'running') throw new AppError('另一项操作仍在进行', 409);
    const inherited = context.getStore(), parent = inherited?.open ? inherited : undefined;
    const owner = this.pluginLifetime?.owner || meta.owner || `jobs:${this.scope || 'anonymous'}`;
    meta = { ...meta, owner };
    const control = meta.lane === 'control';
    const check = captureOperationCheck();
    if (pendingJobs >= pendingJobLimit - (control ? 0 : pendingControlReserve) ||
        (pendingOwners.get(owner) || 0) >= ownerPendingLimit - (control ? 0 : ownerControlReserve))
      throw new AppError('任务等待队列已满，请稍后重试', 429, 'JOB_QUEUE_FULL');
    if (parent && parent.children.size >= delegatedQueueLimit)
      throw new AppError('嵌套任务等待队列已满', 503, 'JOB_QUEUE_FULL');
    const queuedAt = new Date().toISOString();
    const view: JobView = {
      ...meta,
      correlationId: operationReceiptId(),
      id: randomUUID(),
      key,
      scope: this.scope,
      status: 'running',
      admission: 'queued',
      queuedAt,
      delegatedFrom: parent?.id,
      resourceWait: { resource: 'jobs', reason: parent ? '等待同一父任务的其他子任务完成' : '等待全局任务执行预算', since: queuedAt },
      phase: '等待执行资源',
      log: '',
      startedAt: queuedAt,
    };
    const abort = new AbortController();
    pendingJobs++; pendingOwners.set(owner, (pendingOwners.get(owner) || 0) + 1);
    /**
     * 入口 / Entry: Jobs.start.cancelWithParent.
     * 功能：把本层请求转交 `abort.abort`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `abort.abort` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `abort.abort(parent?.signal.reason)`.
     * 副作用 / Effects: `abort.abort`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cancelWithParent = () => abort.abort(parent?.signal.reason);
    parent?.signal.addEventListener('abort', cancelWithParent, { once: true });
    if (parent?.signal.aborted) cancelWithParent();
    this.history.push(view);
    while (this.history.length > 200) {
      const index = this.history.findIndex((v) => v.status !== 'running');
      if (index < 0) break;
      const [removed] = this.history.splice(index, 1);
      if (removed.key && this.items.get(removed.key)?.view === removed) this.items.delete(removed.key);
      this.results.delete(removed.id!);
      if (this.file && removed.result && /^[a-f0-9-]{36}$/.test(removed.id || ''))
        void rm(join(this.file + '.results', removed.id! + '.json'), { force: true }).catch(() => {});
    }
    this.persist();
    let lease: JobResource | undefined;
    // Capture the sibling predecessor before publishing this child's completion.
    const predecessor = parent?.tail;
    /**
     * 入口 / Entry: Jobs.start.callback@400.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().catch().finally）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().catch().finally).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `pendingOwners.set`; `pendingOwners.delete`; `lease.release`; 更新 / updates `view.admission`, `view.resourceWait`, `view.finishedAt`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: Jobs.start.callback@380.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then().catch）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then().catch).
     * 输入 / Inputs: cause: unknown
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.registerCleanup`; 更新 / updates `view.status`, `view.error`, `view.errorCode`, `view.phase`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: Jobs.start.callback@307.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（Promise.resolve().then）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (Promise.resolve().then).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `abort.signal.throwIfAborted`; `hostRuntime.acquire`; `this.persist`; `AbortSignal.any`; 更新 / updates `lease`, `view.admission`, `view.executionStartedAt`, `view.resourceLeaseId`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const done = Promise.resolve()
      .then(async () => {
        await this.flush();
        abort.signal.throwIfAborted();
        if (parent) {
          await waitFor(predecessor!, abort.signal);
          abort.signal.throwIfAborted();
          lease = parent.lease;
        } else {
          lease = await hostRuntime.acquire({ owner,
            kind: 'job', label: (meta.title || key).slice(0, 200), lane: meta.lane || 'interactive', cost: { jobs: 1 },
            identity: { operationId: view.id, jobId: view.id, vmId: meta.vmId, projectId: meta.projectId },
            signal: abort.signal, ...(meta.admissionTimeoutMs === undefined ? {} : { timeoutMs: meta.admissionTimeoutMs }) });
        }
        if (!control || this.pluginLifetime) await check();
        this.pluginLifetime?.check('jobs', true);
        abort.signal.throwIfAborted();
        view.admission = 'running'; view.executionStartedAt = new Date().toISOString();
        view.resourceLeaseId = lease.id; view.resourceWait = undefined; view.phase = '准备中';
        // History is observational; domain owners persist their own recoverable intents.
        this.persist();
        abort.signal.throwIfAborted();
        const childrenAbort = new AbortController();
        const own: JobContext = { id: view.id!, lease, signal: AbortSignal.any([abort.signal, childrenAbort.signal]),
          open: true, children: new Map(), tail: Promise.resolve() };
        /**
         * 入口 / Entry: Jobs.start.execute.
         * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Jobs`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; the calls and state transitions below complete the operation. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
         * 处理：通过 `work`, `abort.signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `work`, `abort.signal.throwIfAborted`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `abort.signal.throwIfAborted`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const execute = async () => {
          /**
           * 入口 / Entry: Jobs.start.callback@345.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（work）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (work).
           * 输入 / Inputs: value
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `writeStore`; `this.results.set`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `view.result`.
           * 拒绝 / Refusals: 条件 / conditions `bytes > 8 * 1024 * 1024`; 异常 / errors `new AppError('任务结果超过 8 MiB，请缩小操作范围')`.
           */
          /**
           * 入口 / Entry: Jobs.start.callback@333.
           * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（work）。
           * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (work).
           * 输入 / Inputs: text
           * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
           * 副作用 / Effects: `this.persist`; 更新 / updates `view.log`, `view.phase`.
           * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
           */
          await work(
            (text) => {
              view.log = (view.log + text).slice(-32768);
              const line = text.trim().split('\n').at(-1);
              if (line) view.phase = line.slice(0, 120);
              this.persist();
            },
            abort.signal,
            (phase, progress) => {
              view.phase = phase;
              view.progress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
              this.persist();
            },
            async (value) => {
              const data = JSON.stringify(value, null, 2),
                bytes = Buffer.byteLength(data);
              if (bytes > 8 * 1024 * 1024) throw new AppError('任务结果超过 8 MiB，请缩小操作范围');
              if (this.file) {
                const path = join(this.file + '.results', view.id! + '.json');
                await writeStore(path, JSON.parse(data));
              } else this.results.set(view.id!, data);
              view.result = { bytes, sha256: createHash('sha256').update(data).digest('hex') };
              this.persist();
            },
          );
          abort.signal.throwIfAborted();
        };
        /**
         * 入口 / Entry: Jobs.start.callback@360.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（context.run）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (context.run).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
         * 副作用 / Effects: `childrenAbort.abort`; `abort.signal.throwIfAborted`; 更新 / updates `workError`, `own.open`.
         * 拒绝 / Refusals: 条件 / conditions `own.cleanupFailure && !(workError instanceof AppError && cleanupFailureCodes.has(workError.code || ''))`; `workError !== undefined`; 异常 / errors `own.cleanupFailure`; `workError`.
         * 收尾：退出 try 区域时始终执行 `own.open = false;`; `await Promise.all([...own.children.values()]);`；这些步骤也适用于异常退出。
         * Finalization: Leaving the try region always executes `own.open = false;`; `await Promise.all([...own.children.values()]);`; these steps also apply to exceptional exits.
         * 失败处理：catch 分支执行 `workError = error;`; `childrenAbort.abort(error);`，是否吞掉错误或重新拒绝由这些语句决定。
         * Failure handling: Catch paths execute `workError = error;`; `childrenAbort.abort(error);`; these statements determine whether a failure is absorbed or rejected again.
         */
        await withResourceContext({ owner,
          operationId: view.id, jobId: view.id, vmId: meta.vmId, projectId: meta.projectId }, () => context.run(own,
          /**
           * 中文功能：执行带计时的 job，失败取消子任务，关闭新子任务准入后等待全部原子任务，最后保留清理失败或原工作异常。
           * English: Runs a timed job, cancels children on failure, closes new-child admission and awaits existing children before retaining cleanup or original-work errors.
           * 所属 / Owner: Jobs.start.done.finally.catch.
           * 输入 / Inputs: 无显式参数 / no explicit parameters.
           */
          async () => {
          let workError: unknown;
          try {
            /**
             * 入口 / Entry: Jobs.start.timed.
             * 功能：把本层请求转交 `runtimeTimings.measure`，沿用该实现的结果与失败路径。
             * Purpose: Delegates this request to `runtimeTimings.measure` and propagates the provider result or rejection.
             * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
             * 输出 / Returns: `runtimeTimings.measure('job', 'execution', execute)`.
             * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            const timed = () => runtimeTimings.measure('job', 'execution', execute);
            if (Jobs.instrument) await Jobs.instrument(view, timed);
            else await timed();
          } catch (error) { workError = error; childrenAbort.abort(error); }
          finally {
            own.open = false;
            await Promise.all([...own.children.values()]);
          }
          if (own.cleanupFailure && !(workError instanceof AppError && cleanupFailureCodes.has(workError.code || '')))
            throw own.cleanupFailure;
          if (workError !== undefined) throw workError;
          abort.signal.throwIfAborted();
        }));
        view.status = 'done';
        view.phase = '已完成';
        view.progress = 100;
      })
      .catch((cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const cleanupFailed = error instanceof AppError && cleanupFailureCodes.has(error.code || '');
        const cancelled = abort.signal.aborted && !cleanupFailed;
        view.status = cancelled ? 'cancelled' : 'error';
        view.error = cancelled ? '操作已取消' : error.message;
        view.errorCode = !cancelled && error instanceof AppError ? error.code : undefined;
        view.phase = view.error;
        if (cleanupFailed) {
          view.admission = 'cleanup-pending';
          if (parent) parent.cleanupFailure ||= error;
          this.registerCleanup(view, error);
        }
        if (view.execution)
          view.execution.outcome = cleanupFailed ? 'failed' : cancelled
            ? 'cancelled'
            : view.execution.outcome && view.execution.outcome !== 'success'
              ? view.execution.outcome
              : 'failed';
      })
      .finally(async () => {
        pendingJobs--;
        const remaining = (pendingOwners.get(owner) || 1) - 1;
        if (remaining) pendingOwners.set(owner, remaining); else pendingOwners.delete(owner);
        parent?.signal.removeEventListener('abort', cancelWithParent);
        // The job callback (and all delegated cleanup) has settled. Unconfirmed
        // external resources retain their own host leases, not this execution slot.
        if (lease && !parent) await lease.release();
        if (view.admission !== 'cleanup-pending') view.admission = undefined;
        view.resourceWait = undefined;
        view.finishedAt = new Date().toISOString();
        await this.flush();
      });
    if (parent) {
      const detachParent = dependsOn(parent.id, view.id!);
      for (const [siblingId, sibling] of parent.children) {
        const detachSibling = dependsOn(view.id!, siblingId);
        void sibling.then(detachSibling, detachSibling);
      }
      parent.children.set(view.id!, done);
      // A cancelled queued child settles promptly, but must not let later siblings
      // overtake the still-running predecessor.
      parent.tail = Promise.all([predecessor, done]).then(() => {});
      void done.then(() => { detachParent(); parent.children.delete(view.id!); },
        () => { detachParent(); parent.children.delete(view.id!); });
    }
    this.items.set(key, { view, abort, done });
    return view;
  }
  /**
   * 入口 / Entry: Jobs.track.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; this entry produces `result` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.start`, `external.addEventListener`, `cancel`, `this.items.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.start`, `external.addEventListener`, `cancel`, `this.items.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `external?.aborted`.
   * 输入 / Inputs: key: string; work: (log: (s: string) => void, signal: AbortSignal, update: JobUpdate) => Promise<T>; meta: JobMeta default={}; external: AbortSignal optional
   * 输出 / Returns: Promise<T>；结果来自 / values from `result`.
   * 副作用 / Effects: `this.start`; `external.addEventListener`.
   * 拒绝 / Refusals: 条件 / conditions `view.status !== 'done'`; 异常 / errors `new AppError(view.error || '任务失败', view.status === 'cancelled' ? 409 : cleanupFailureCodes.has(view.errorCode || '') ? 503 : …`.
   * 收尾：退出 try 区域时始终执行 `external?.removeEventListener('abort', cancel);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `external?.removeEventListener('abort', cancel);`; these steps also apply to exceptional exits.
   */
  async track<T>(
    key: string,
    work: (log: (s: string) => void, signal: AbortSignal, update: JobUpdate) => Promise<T>,
    meta: JobMeta = {},
    external?: AbortSignal,
  ): Promise<T> {
    let result!: T;
    let failure: unknown;
    const view = this.start(
      key,
      async (log, signal, update) => {
        try { result = await work(log, signal, update); }
        catch (error) { failure = error; throw error; }
      },
      meta,
    );
    /**
     * 入口 / Entry: Jobs.track.cancel.
     * 功能：把本层请求转交 `this.cancel`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.cancel` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.cancel(key, external?.reason)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const cancel = () => this.cancel(key, external?.reason);
    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) cancel();
    try {
      await this.items.get(key)!.done;
      if (view.status !== 'done')
        throw new AppError(view.error || '任务失败', view.status === 'cancelled' ? 409 :
          cleanupFailureCodes.has(view.errorCode || '') ? 503 :
            failure instanceof AppError ? failure.status : 400, view.errorCode);
      return result;
    } finally {
      external?.removeEventListener('abort', cancel);
    }
  }
  /**
   * 入口 / Entry: Jobs.cancel.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `item.view.phase`, `item.view.admission`（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; the outcome is recorded in `item.view.phase`, `item.view.admission`. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.items.get`, `inline.find`, `this.items.values`, `item.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.items.get`, `inline.find`, `this.items.values`, `item.abort.abort`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `item?.view.status === 'running'`.
   * 输入 / Inputs: key: string; reason: unknown optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `item.abort.abort`; `this.persist`; 更新 / updates `item.view.phase`, `item.view.admission`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  cancel(key: string, reason?: unknown) {
    const item = this.items.get(key) || [...this.items.values()].find((v) => v.view.id === key);
    if (item?.view.status === 'running') {
      item.view.phase = '正在取消并清理…';
      item.view.admission = 'cancelling';
      item.abort.abort(reason);
      this.persist();
    }
  }
  /**
   * 入口 / Entry: Jobs.wait.
   * 功能：在管理任务执行、日志、结果和取消中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Jobs`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Jobs`; the calls and state transitions below complete the operation. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `this.items.get`, `context.getStore`, `dependsOn`, `detach` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.items.get`, `context.getStore`, `dependsOn`, `detach`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: key: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 收尾：退出 try 区域时始终执行 `detach?.();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `detach?.();`; these steps also apply to exceptional exits.
   */
  async wait(key: string) {
    const item = this.items.get(key), caller = context.getStore();
    const detach = caller?.open && item?.view.status === 'running' ? dependsOn(caller.id, item.view.id!) : undefined;
    try { await item?.done; } finally { detach?.(); }
  }
  /**
   * 入口 / Entry: Jobs.close.
   * 功能：在管理任务执行、日志、结果和取消中，结束、撤销或清理本次拥有的领域资源；本入口产生 `Promise.reject(error)` / `this.closeTask` 供上层消费（`Jobs`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Jobs`; this entry produces `Promise.reject(error)` / `this.closeTask` for its caller. Module context: Owns job execution, logs, results and cancellation, detecting wait cycles and retaining pending recovery resources.
   * 处理：通过 `context.getStore`, `this.items.values`, `detach.push`, `dependsOn` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `context.getStore`, `this.items.values`, `detach.push`, `dependsOn`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `caller?.open`; `item.view.status === 'running'`; `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `Promise.reject(error)`; `this.closeTask`; `this.closeTask ||= (async () => { try { this.closed = true; for (const [key, item] of this.items) if (item.view.status === 'r…`.
   * 副作用 / Effects: `detach.push`; 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `for (const remove of detach) remove();`; `return Promise.reject(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `for (const remove of detach) remove();`; `return Promise.reject(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  close(): Promise<void> {
    const caller = context.getStore(), detach: (
    /**
     * 中文功能：登记 Jobs.close.detach 的资源退役能力，按返回类型允许同步完成或异步等待。
     * English: Registers resource-retirement capability for Jobs.close.detach, allowing synchronous completion or asynchronous waiting according to its result type.
     * 所属 / Owner: Jobs.close.detach.
     * 输入 / Inputs: 无显式参数 / no explicit parameters.
     * 结果 / Result: `void`.
     */
    () => void)[] = [];
    try {
      if (caller?.open) for (const item of this.items.values())
        if (item.view.status === 'running') detach.push(dependsOn(caller.id, item.view.id!));
    } catch (error) { for (const remove of detach) remove(); return Promise.reject(error); }
    if (this.closeTask) { for (const remove of detach) remove(); return this.closeTask; }
    return this.closeTask ||= (async () => {
      try {
        this.closed = true;
        for (const [key, item] of this.items) if (item.view.status === 'running') this.cancel(key);
        await Promise.all([...this.items.values()].map((v) => v.done));
        await this.flush();
      } finally { for (const remove of detach) remove(); }
    })();
  }
}

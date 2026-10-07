/**
 * 模块职责：调度受管周期任务，限制重复注册并在排空时停止新的调度执行。
 * Module purpose: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { AppError } from '../shared/errors.ts';
import { Jobs } from './jobs.ts';
import { hostRuntime, type ResourceLease } from './host-runtime/index.ts';
import { pluginAuthority, withPluginBackground } from './plugin-authority.ts';
import type { PluginInstance } from './plugin-instance.ts';

export type ScheduleDefinition = {
  id?: string;
  owner: string;
  label: string;
  intervalMs: number;
  immediate?: boolean;
  overlap?: 'skip' | 'coalesce';
  /** On a late wakeup, skip expired ticks or run at most one catch-up. */
  catchUp?: 'skip' | 'once';
  timeoutMs?: number;
  backoff?: { initialMs: number; maxMs: number; factor?: number };
  /**
   * 签名 / Signature: ScheduleDefinition.run.
   * 功能：为调度受管周期任务声明 run 的输入与结果契约，所属容器为 ScheduleDefinition。
   * Purpose: Declares the input/result contract for run in ScheduleDefinition. Module responsibility: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 输入 / Inputs: context: { signal: AbortSignal; scheduledAt: string }
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  run(context: { signal: AbortSignal; scheduledAt: string }): Promise<void>;
};
export type ScheduleView = {
  id: string; owner: string; label: string; intervalMs: number;
  overlap: 'skip' | 'coalesce'; catchUp: 'skip' | 'once';
  state: 'scheduled' | 'queued' | 'running' | 'cancelling' | 'backoff' | 'cleanup-pending' | 'closed';
  nextAt?: string; lastStartedAt?: string; lastFinishedAt?: string;
  lastDurationMs?: number; lastError?: string; timedOutAt?: string;
  jobId?: string; cleanupLeaseId?: string;
  runs: number; failures: number; skipped: number; coalesced: number;
};
export type ScheduleHandle = { id: string;
/**
 * 签名 / Signature: ScheduleHandle.trigger.
 * 功能：为调度受管周期任务声明 trigger 的输入与结果契约，所属容器为 ScheduleHandle。
 * Purpose: Declares the input/result contract for trigger in ScheduleHandle. Module responsibility: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: boolean.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
trigger(): boolean;
/**
 * 签名 / Signature: ScheduleHandle.snapshot.
 * 功能：为调度受管周期任务声明 snapshot 的输入与结果契约，所属容器为 ScheduleHandle。
 * Purpose: Declares the input/result contract for snapshot in ScheduleHandle. Module responsibility: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: ScheduleView.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
snapshot(): ScheduleView;
/**
 * 签名 / Signature: ScheduleHandle.close.
 * 功能：为调度受管周期任务声明 close 的输入与结果契约，所属容器为 ScheduleHandle。
 * Purpose: Declares the input/result contract for close in ScheduleHandle. Module responsibility: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Promise<void>.
 * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
 * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
 */
close(): Promise<void>;
  /**
   * 签名 / Signature: ScheduleHandle.resolveCleanup.
   * 功能：为调度受管周期任务声明 resolveCleanup 的输入与结果契约，所属容器为 ScheduleHandle。
   * Purpose: Declares the input/result contract for resolveCleanup in ScheduleHandle. Module responsibility: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 输入 / Inputs: jobId: string
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  resolveCleanup(jobId: string): Promise<void> };
type Entry = { definition: ScheduleDefinition; view: ScheduleView; jobs: JobsV1; lease: ResourceLease; nextAt: number;
  lifetime?: PluginInstance;
  notBefore: number; queued: boolean; closed: boolean; abort?: AbortController;
  pending?: Promise<void>; closeTask?: Promise<void>; cleanupFailure?: unknown };

const maximumDelay = 2_147_483_647;
/**
 * 入口 / Entry: duration.
 * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`scheduler.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `scheduler.ts`; the calls and state transitions below complete the operation. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
 * 输入 / Inputs: value: number; label: string
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isSafeInteger(value) || value < 1 || value > maximumDelay`; 异常 / errors `new RangeError(`Invalid ${label}`)`.
 */
function duration(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumDelay) throw new RangeError(`Invalid ${label}`);
}

/** One timer owns periodic wakeups. Jobs provides global admission and nested budget delegation. */
export class Scheduler {
  private entries = new Map<string, Entry>();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private closeTask?: Promise<void>;

  /**
   * 入口 / Entry: Scheduler.register.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ id, trigger: () => this.trigger(entry), snapshot: () => this.describe(entry), close: () => this.closeEntry(entry), resolveC…` 供上层消费（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; this entry produces `{ id, trigger: () => this.trigger(entry), snapshot: () => this.describe(entry), close: () => this.closeEntry(entry), resolveC…` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `pluginAuthority`, `lifetime.check`, `duration`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pluginAuthority`, `lifetime.check`, `duration`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `lifetime`; `definition.timeoutMs !== undefined`.
   * 输入 / Inputs: definition: ScheduleDefinition
   * 输出 / Returns: ScheduleHandle；结果来自 / values from `{ id, trigger: () => this.trigger(entry), snapshot: () => this.describe(entry), close: () => this.closeEntry(entry), resolveC…`.
   * 副作用 / Effects: `hostRuntime.register`; `this.entries.set`; `lifetime.signal.addEventListener`; `lifetime.scope.add`; 更新 / updates `definition`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!definition.owner || !definition.label || definition.owner.length > 200 || definition.label.length > 200`; `definition.overlap !== undefined && !['skip', 'coalesce'].includes(definition.overlap)`; 异常 / errors `new AppError('周期调度正在关闭', 503, 'SCHEDULER_CLOSED')`; `new TypeError('Schedule owner and label are required and must be at most 200 characters')`.
   */
  register(definition: ScheduleDefinition): ScheduleHandle {
    const lifetime = pluginAuthority();
    lifetime?.check('schedule', true);
    if (lifetime) definition = { ...definition, owner: lifetime.owner };
    if (this.closed) throw new AppError('周期调度正在关闭', 503, 'SCHEDULER_CLOSED');
    duration(definition.intervalMs, 'schedule interval');
    if (definition.timeoutMs !== undefined) duration(definition.timeoutMs, 'schedule timeout');
    if (!definition.owner || !definition.label || definition.owner.length > 200 || definition.label.length > 200)
      throw new TypeError('Schedule owner and label are required and must be at most 200 characters');
    if (definition.overlap !== undefined && !['skip', 'coalesce'].includes(definition.overlap)) throw new TypeError('Invalid overlap policy');
    if (definition.catchUp !== undefined && !['skip', 'once'].includes(definition.catchUp)) throw new TypeError('Invalid catch-up policy');
    if (definition.backoff) {
      duration(definition.backoff.initialMs, 'initial backoff'); duration(definition.backoff.maxMs, 'maximum backoff');
      if (definition.backoff.initialMs > definition.backoff.maxMs || !Number.isFinite(definition.backoff.factor ?? 2) ||
          (definition.backoff.factor ?? 2) < 1) throw new RangeError('Invalid schedule backoff');
    }
    const id = definition.id || randomUUID();
    lifetime?.contribute('schedule', definition.label);
    if (this.entries.has(id)) throw new AppError('周期任务标识已存在', 409, 'SCHEDULE_EXISTS');
    if (this.entries.size >= 1024 || [...this.entries.values()].filter((entry) => entry.definition.owner === definition.owner).length >= 64)
      throw new AppError('周期任务登记已达到上限', 429, 'SCHEDULE_LIMIT');
    const entry: Entry = { lifetime, definition: { ...definition, backoff: definition.backoff && { ...definition.backoff } },
      view: { id, owner: definition.owner, label: definition.label, intervalMs: definition.intervalMs,
        overlap: definition.overlap || 'skip', catchUp: definition.catchUp || 'once', state: 'scheduled',
        runs: 0, failures: 0, skipped: 0, coalesced: 0 },
      jobs: new Jobs(), lease: hostRuntime.register({ owner: definition.owner, kind: 'schedule', label: definition.label, lane: 'background' }),
      nextAt: Date.now() + (definition.immediate ? 0 : definition.intervalMs),
      notBefore: 0, queued: false, closed: false };
    this.entries.set(id, entry); this.arm();
    if (lifetime) {
      /**
       * 入口 / Entry: Scheduler.register.cancel.
       * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`Scheduler`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; the calls and state transitions below complete the operation. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
       * 处理：通过 `this.closeEntry().catch`, `this.closeEntry` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.closeEntry().catch`, `this.closeEntry`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `this.closeEntry().catch`; `this.closeEntry`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => { void this.closeEntry(entry).catch(() => {}); };
      lifetime.signal.addEventListener('abort', cancel, { once: true });
      lifetime.scope.add(async () => { await this.closeEntry(entry); lifetime.signal.removeEventListener('abort', cancel); });
    }
    return { id,
    /**
     * 入口 / Entry: Scheduler.register.trigger.
     * 功能：把本层请求转交 `this.trigger`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.trigger` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.trigger(entry)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    trigger: () => this.trigger(entry),
    /**
     * 入口 / Entry: Scheduler.register.snapshot.
     * 功能：把本层请求转交 `this.describe`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.describe` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.describe(entry)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    snapshot: () => this.describe(entry),
    /**
     * 入口 / Entry: Scheduler.register.close.
     * 功能：把本层请求转交 `this.closeEntry`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `this.closeEntry` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.closeEntry(entry)`.
     * 副作用 / Effects: `this.closeEntry`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    close: () => this.closeEntry(entry),
      /**
       * 入口 / Entry: Scheduler.register.resolveCleanup.
       * 功能：把本层请求转交 `entry.jobs.resolveCleanup`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `entry.jobs.resolveCleanup` and propagates the provider result or rejection.
       * 输入 / Inputs: jobId
       * 输出 / Returns: `entry.jobs.resolveCleanup(jobId)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      resolveCleanup: (jobId) => entry.jobs.resolveCleanup(jobId) };
  }

  /**
   * 入口 / Entry: Scheduler.describe.
   * 功能：从当前输入或状态计算 `{ ...entry.view, state, jobId: job?.id, cleanupLeaseId: admission === 'cleanup-pending' ? job?.cleanupLeaseId : undefined, ne…`，供调用方后续验证或使用。
   * Purpose: Computes `{ ...entry.view, state, jobId: job?.id, cleanupLeaseId: admission === 'cleanup-pending' ? job?.cleanupLeaseId : undefined, ne…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: entry: Entry
   * 输出 / Returns: ScheduleView；结果来自 / values from `{ ...entry.view, state, jobId: job?.id, cleanupLeaseId: admission === 'cleanup-pending' ? job?.cleanupLeaseId : undefined, ne…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private describe(entry: Entry): ScheduleView {
    const job = entry.jobs.view('run'), admission = job?.admission;
    const state = entry.cleanupFailure ? 'cleanup-pending' : entry.pending
      ? entry.abort?.signal.aborted ? 'cancelling' : admission === 'queued' ? 'queued' : 'running'
      : entry.closed ? 'closed' : entry.notBefore > Date.now() ? 'backoff' : 'scheduled';
    return { ...entry.view, state, jobId: job?.id, cleanupLeaseId: admission === 'cleanup-pending' ? job?.cleanupLeaseId : undefined,
      nextAt: entry.closed ? undefined : new Date(Math.max(entry.nextAt, entry.notBefore)).toISOString() };
  }
  /**
   * 入口 / Entry: Scheduler.snapshot.
   * 功能：在调度受管周期任务中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `[...this.entries.values()].map((entry) => this.describe(entry))` 供上层消费（`Scheduler`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `Scheduler`; this entry produces `[...this.entries.values()].map((entry) => this.describe(entry))` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `inline.map`, `this.entries.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.map`, `this.entries.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: ScheduleView[]；结果来自 / values from `[...this.entries.values()].map((entry) => this.describe(entry))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  snapshot(): ScheduleView[] { return [...this.entries.values()].map((entry) => this.describe(entry)); }

  /**
   * 入口 / Entry: Scheduler.arm.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; this entry produces `void` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `clearTimeout`, `this.entries.values`, `setTimeout`, `this.timer.unref` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `this.entries.values`, `setTimeout`, `this.timer.unref`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || !this.entries.size`; `!entry.closed && !entry.cleanupFailure`; `!Number.isFinite(next)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `clearTimeout`; `setTimeout`; 更新 / updates `this.timer`, `next`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private arm() {
    clearTimeout(this.timer); this.timer = undefined;
    if (this.closed || !this.entries.size) return;
    let next = Infinity;
    for (const entry of this.entries.values()) if (!entry.closed && !entry.cleanupFailure) next = Math.min(next, Math.max(entry.nextAt, entry.notBefore));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, Math.min(maximumDelay, Math.max(1, next - Date.now())));
    this.timer.unref();
  }
  /**
   * 入口 / Entry: Scheduler.wake.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; this entry produces `void` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `this.entries.values`, `this.overlapping`, `this.launch`, `this.arm` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.entries.values`, `this.overlapping`, `this.launch`, `this.arm`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `entry.closed || entry.cleanupFailure || Math.max(entry.nextAt, entry.notBefore) > now`; `missed && entry.view.catchUp === 'skip' && !entry.queued`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `entry.nextAt`, `entry.view.skipped`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private wake() {
    if (this.closed) return;
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.closed || entry.cleanupFailure || Math.max(entry.nextAt, entry.notBefore) > now) continue;
      const scheduledAt = entry.nextAt;
      const missed = Math.floor(Math.max(0, now - scheduledAt) / entry.definition.intervalMs);
      entry.nextAt = scheduledAt + (missed + 1) * entry.definition.intervalMs;
      if (missed && entry.view.catchUp === 'skip' && !entry.queued) { entry.view.skipped += missed + 1; continue; }
      if (entry.pending) this.overlapping(entry, missed + 1);
      else { entry.view.skipped += missed; this.launch(entry, scheduledAt); }
    }
    this.arm();
  }
  /**
   * 入口 / Entry: Scheduler.overlapping.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `entry.queued`, `entry.view.coalesced`, `entry.view.skipped`（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; the outcome is recorded in `entry.queued`, `entry.view.coalesced`, `entry.view.skipped`. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 分支 / Branches: `entry.view.overlap === 'coalesce'`.
   * 输入 / Inputs: entry: Entry; count: default=1
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `entry.queued`, `entry.view.coalesced`, `entry.view.skipped`.
   */
  private overlapping(entry: Entry, count = 1) {
    if (entry.view.overlap === 'coalesce') { entry.queued = true; entry.view.coalesced += count; }
    else entry.view.skipped += count;
  }
  /**
   * 入口 / Entry: Scheduler.trigger.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `entry.view.overlap === 'coalesce'` 供上层消费（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; this entry produces `false` / `entry.view.overlap === 'coalesce'` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `this.overlapping`, `this.arm`, `this.launch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.overlapping`, `this.arm`, `this.launch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || entry.closed || entry.cleanupFailure`; `entry.pending`; `entry.notBefore > Date.now()`.
   * 输入 / Inputs: entry: Entry
   * 输出 / Returns: `false`; `entry.view.overlap === 'coalesce'`; `true`.
   * 副作用 / Effects: 更新 / updates `entry.queued`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private trigger(entry: Entry) {
    if (this.closed || entry.closed || entry.cleanupFailure) return false;
    if (entry.pending) { this.overlapping(entry); return entry.view.overlap === 'coalesce'; }
    if (entry.notBefore > Date.now()) { entry.queued = true; this.arm(); return true; }
    this.launch(entry, Date.now()); this.arm(); return true;
  }
  /**
   * 入口 / Entry: Scheduler.launch.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; this entry produces `void` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `this.closeEntry().catch`, `this.closeEntry`, `inline.then().catch().finally`, `inline.then().catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.closeEntry().catch`, `this.closeEntry`, `inline.then().catch().finally`, `inline.then().catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.lifetime?.phase === 'activating'`; `entry.lifetime?.signal.aborted`.
   * 输入 / Inputs: entry: Entry; scheduledAt: number
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.closeEntry().catch`; `this.closeEntry`; 更新 / updates `entry.nextAt`, `entry.queued`, `entry.abort`, `entry.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private launch(entry: Entry, scheduledAt: number) {
    if (entry.lifetime?.phase === 'activating') { entry.nextAt = Date.now() + 50; return; }
    if (entry.lifetime?.signal.aborted) { void this.closeEntry(entry).catch(() => {}); return; }
    entry.queued = false;
    const abort = new AbortController(); entry.abort = abort;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    /**
     * 入口 / Entry: Scheduler.launch.callback@140.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（entry.jobs.track / run）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (entry.jobs.track / run).
     * 输入 / Inputs: _log; signal
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `setTimeout`; `clearTimeout`; 更新 / updates `entry.view.lastStartedAt`, `entry.view.timedOutAt`, `timeout`, `entry.view.lastDurationMs`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     * 收尾：退出 try 区域时始终执行 `clearTimeout(timeout);`; `entry.view.lastDurationMs = performance.now() - began;`；这些步骤也适用于异常退出。
     * Finalization: Leaving the try region always executes `clearTimeout(timeout);`; `entry.view.lastDurationMs = performance.now() - began;`; these steps also apply to exceptional exits.
     */
    /**
     * 入口 / Entry: Scheduler.launch.launch.
     * 功能：把本层请求转交 `Jobs.detached`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `Jobs.detached` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `Jobs.detached(() => entry.jobs.track('run', async (_log, signal) => { entry.view.runs++; entry.view.lastStartedAt = new Date(…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const launch = () => Jobs.detached(() => entry.jobs.track('run', async (_log, signal) => {
      entry.view.runs++; entry.view.lastStartedAt = new Date().toISOString(); entry.view.timedOutAt = undefined;
      const began = performance.now();
      if (entry.definition.timeoutMs !== undefined) timeout = setTimeout(() => {
        entry.view.timedOutAt = new Date().toISOString();
        abort.abort(new AppError('周期任务执行超时，正在等待清理', 503, 'SCHEDULE_TIMEOUT'));
      }, entry.definition.timeoutMs);
      try { await entry.definition.run({ signal, scheduledAt: new Date(scheduledAt).toISOString() }); }
      finally { clearTimeout(timeout); entry.view.lastDurationMs = performance.now() - began; }
    }, { owner: entry.definition.owner, title: entry.definition.label, lane: 'background' }, abort.signal));
    /**
     * 入口 / Entry: Scheduler.launch.callback@166.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.then().catch().finally）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.then().catch().finally).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `clearTimeout`; 更新 / updates `entry.view.lastFinishedAt`, `entry.pending`, `entry.abort`, `entry.nextAt`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    /**
     * 入口 / Entry: Scheduler.launch.callback@152.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline.then().catch）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline.then().catch).
     * 输入 / Inputs: error: unknown
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 更新 / updates `entry.cleanupFailure`, `entry.view.lastError`, `entry.notBefore`, `entry.nextAt`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const pending = (entry.lifetime ? withPluginBackground(entry.lifetime, launch) : launch())
      .then(() => { entry.view.failures = 0; entry.view.lastError = undefined; entry.notBefore = 0; })
      .catch((error: unknown) => {
        if (entry.jobs.view('run')?.admission === 'cleanup-pending') {
          entry.cleanupFailure = error; entry.lease.cleanupPending(error);
        } else if (entry.closed) return;
        entry.view.failures++;
        entry.view.lastError = entry.view.timedOutAt && entry.jobs.view('run')?.admission !== 'cleanup-pending'
          ? '周期任务执行超时，清理已完成' : error instanceof Error ? error.message : String(error);
        const backoff = entry.definition.backoff;
        if (backoff) {
          const wait = Math.min(backoff.maxMs, backoff.initialMs * (backoff.factor ?? 2) ** Math.min(1024, entry.view.failures - 1));
          entry.notBefore = Date.now() + wait;
          entry.nextAt = Math.max(entry.nextAt, entry.notBefore);
        }
      })
      .finally(() => {
        clearTimeout(timeout); entry.view.lastFinishedAt = new Date().toISOString();
        entry.pending = undefined; entry.abort = undefined;
        if (entry.queued && !entry.closed) entry.nextAt = Math.max(Date.now(), entry.notBefore);
        this.arm();
      });
    entry.pending = pending;
  }
  /**
   * 入口 / Entry: Scheduler.closeEntry.
   * 功能：在调度受管周期任务中，结束、撤销或清理本次拥有的领域资源；本入口产生 `entry.closeTask` / `entry.closeTask = (async () => { entry.closed = true; entry.queued = false; entry.abort?.abort(new AppError('周期任务正在关闭', 503, …` 供上层消费（`Scheduler`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Scheduler`; this entry produces `entry.closeTask` / `entry.closeTask = (async () => { entry.closed = true; entry.queued = false; entry.abort?.abort(new AppError('周期任务正在关闭', 503, …` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.closeTask`.
   * 输入 / Inputs: entry: Entry
   * 输出 / Returns: Promise<void>；结果来自 / values from `entry.closeTask`; `entry.closeTask = (async () => { entry.closed = true; entry.queued = false; entry.abort?.abort(new AppError('周期任务正在关闭', 503, …`.
   * 副作用 / Effects: 更新 / updates `entry.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private closeEntry(entry: Entry): Promise<void> {
    if (entry.closeTask) return entry.closeTask;
    /**
     * 入口 / Entry: Scheduler.closeEntry.callback@185.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline().catch）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline().catch).
     * 输入 / Inputs: error
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `entry.cleanupFailure`, `entry.closeTask`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     */
    /**
     * 入口 / Entry: Scheduler.closeEntry.callback@176.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `entry.abort.abort`; `entry.jobs.close`; `entry.lease.release`; `this.entries.delete`; 更新 / updates `entry.closed`, `entry.queued`, `entry.cleanupFailure`.
     * 拒绝 / Refusals: 条件 / conditions `pending`; 异常 / errors `new AppError(pending.error || '周期任务资源清理尚未确认', 503, pending.errorCode || 'SCHEDULE_CLEANUP_PENDING')`.
     */
    return entry.closeTask = (async () => {
      entry.closed = true; entry.queued = false;
      entry.abort?.abort(new AppError('周期任务正在关闭', 503, 'SCHEDULE_CLOSED'));
      this.arm();
      await entry.pending; await entry.jobs.close();
      const pending = entry.jobs.list().find((job) => job.admission === 'cleanup-pending');
      if (pending) throw new AppError(pending.error || '周期任务资源清理尚未确认', 503, pending.errorCode || 'SCHEDULE_CLEANUP_PENDING');
      entry.cleanupFailure = undefined; entry.lease.release();
      this.entries.delete(entry.view.id); this.arm();
    })().catch((error) => {
      entry.cleanupFailure = error; entry.lease.cleanupPending(error); entry.closeTask = undefined; throw error;
    });
  }
  /**
   * 入口 / Entry: Scheduler.beginDrain.
   * 功能：在调度受管周期任务中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.closed`, `this.timer`, `entry.closed`（`Scheduler`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Scheduler`; the outcome is recorded in `this.closed`, `this.timer`, `entry.closed`. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `clearTimeout`, `this.entries.values`, `entry.abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearTimeout`, `this.entries.values`, `entry.abort.abort`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearTimeout`; `entry.abort.abort`; 更新 / updates `this.closed`, `this.timer`, `entry.closed`, `entry.queued`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  beginDrain() {
    this.closed = true; clearTimeout(this.timer); this.timer = undefined;
    for (const entry of this.entries.values()) {
      entry.closed = true; entry.queued = false;
      entry.abort?.abort(new AppError('周期任务正在关闭', 503, 'SCHEDULE_CLOSED'));
    }
  }
  /**
   * 入口 / Entry: Scheduler.close.
   * 功能：在调度受管周期任务中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.closeTask` / `this.closeTask = (async () => { this.beginDrain(); const results = await Promise.allSettled([...this.entries.values()].map((e…` 供上层消费（`Scheduler`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Scheduler`; this entry produces `this.closeTask` / `this.closeTask = (async () => { this.beginDrain(); const results = await Promise.allSettled([...this.entries.values()].map((e…` for its caller. Module context: Schedules managed periodic work, rejecting duplicate registrations and stopping new ticks during draining.
   * 处理：通过 `inline().catch`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline().catch`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closeTask`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: Promise<void>；结果来自 / values from `this.closeTask`; `this.closeTask = (async () => { this.beginDrain(); const results = await Promise.allSettled([...this.entries.values()].map((e…`.
   * 副作用 / Effects: 更新 / updates `this.closeTask`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    /**
     * 入口 / Entry: Scheduler.close.callback@198.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `errors.length === 1`; `errors.length`; 异常 / errors `errors[0]`; `new AggregateError(errors, '周期任务清理未完成')`.
     */
    return this.closeTask = (async () => {
      this.beginDrain();
      const results = await Promise.allSettled([...this.entries.values()].map((entry) => this.closeEntry(entry)));
      const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, '周期任务清理未完成');
    })().catch((error) => { this.closeTask = undefined; throw error; });
  }
}

export const scheduler = new Scheduler();

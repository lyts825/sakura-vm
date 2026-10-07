/**
 * 模块职责：规划并清理日志保留内容，策略读取失败时停用自动清理以保护原日志。
 * Module purpose: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
 */
import type { JobsV1 } from './service-contracts/v1.ts';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

import type { JobView } from '../shared/contracts/jobs.ts';
import { readStore, writeStore } from './local-store.ts';
import type { LogRetentionPolicy, LogRetentionSummary, LogRetentionView } from '../shared/log-retention.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

export const logRetentionPolicy = z
  .object({
    enabled: z.boolean(),
    days: z.number().int().min(1).max(3650),
    maxMiB: z.number().int().min(1).max(1024),
  })
  .strict();
export const logRetentionRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), policy: logRetentionPolicy }).strict(),
  z
    .object({
      action: z.literal('save'),
      policy: logRetentionPolicy,
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ enabled: false, days: 30, maxMiB: 64 })`，供调用方后续验证或使用。
 * Purpose: Computes `({ enabled: false, days: 30, maxMiB: 64 })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: LogRetentionPolicy；结果来自 / values from `({ enabled: false, days: 30, maxMiB: 64 })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): LogRetentionPolicy => ({ enabled: false, days: 30, maxMiB: 64 });
const stateSchema = z
  .object({
    version: z.literal(1),
    policy: logRetentionPolicy,
    lastRun: z
      .object({
        at: z.iso.datetime(),
        removedLogs: z.number().int().nonnegative(),
        removedBytes: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .strict();

// Only completed job log bodies are eligible. Results and audit evidence are separate stores.
/**
 * 入口 / Entry: planLogRetention.
 * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ summary, removals, token }` 供上层消费（`log-retention.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `log-retention.ts`; this entry produces `{ summary, removals, token }` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
 * 处理：通过 `stores.forEach`, `candidates.sort`, `removals.push`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `stores.forEach`, `candidates.sort`, `removals.push`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `policy.enabled`; `!expired && bytes <= policy.maxMiB * 1024 ** 2`; `expired`.
 * 输入 / Inputs: stores: JobsV1[]; policy: LogRetentionPolicy; now: default=Date.now()
 * 输出 / Returns: `{ summary, removals, token }`.
 * 副作用 / Effects: `removals.push`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `bytes`, `summary.removeLogs`, `summary.removeBytes`, `summary.remainingBytes`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function planLogRetention(stores: JobsV1[], policy: LogRetentionPolicy, now = Date.now()) {
  const summary: LogRetentionSummary = {
    stores: stores.length,
    completedLogs: 0,
    completedBytes: 0,
    protectedLogs: 0,
    protectedBytes: 0,
    removeLogs: 0,
    removeBytes: 0,
    expiredLogs: 0,
    capacityLogs: 0,
    remainingBytes: 0,
  };
  const candidates: {
    store: JobsV1;
    job: JobView;
    bytes: number;
    at: number;
    storeIndex: number;
    signature: string;
  }[] = [];
  /**
   * 入口 / Entry: planLogRetention.callback@70.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（stores.forEach）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (stores.forEach).
   * 输入 / Inputs: store; storeIndex
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `candidates.push`; `createHash().update().digest`; `createHash().update`; `createHash`; 更新 / updates `summary.protectedBytes`, `summary.completedBytes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  stores.forEach((store, storeIndex) => {
    for (const job of store.list()) {
      const bytes = Buffer.byteLength(job.log);
      if (!bytes) continue;
      const at = Date.parse(job.finishedAt || job.startedAt);
      if (job.status === 'running' || !job.id || !Number.isFinite(at) || at > now) {
        summary.protectedLogs++;
        summary.protectedBytes += bytes;
        continue;
      }
      summary.completedLogs++;
      summary.completedBytes += bytes;
      candidates.push({
        store,
        job,
        bytes,
        at,
        storeIndex,
        signature: createHash('sha256').update(job.log).digest('hex'),
      });
    }
  });
  candidates.sort((a, b) => a.at - b.at || a.storeIndex - b.storeIndex || a.job.id!.localeCompare(b.job.id!));
  const removals: typeof candidates = [];
  let bytes = summary.completedBytes;
  if (policy.enabled)
    for (const item of candidates) {
      const expired = item.at <= now - policy.days * 86400000;
      if (!expired && bytes <= policy.maxMiB * 1024 ** 2) break;
      removals.push(item);
      bytes -= item.bytes;
      if (expired) summary.expiredLogs++;
      else summary.capacityLogs++;
    }
  summary.removeLogs = removals.length;
  summary.removeBytes = summary.completedBytes - bytes;
  summary.remainingBytes = bytes;
  // Hash completed evidence and policy, never return log text or hashes of individual messages.
  const token = createHash('sha256')
    .update(
      JSON.stringify({
        policy,
        candidates: candidates.map(({ storeIndex, job, signature, at }) => [
          storeIndex,
          job.id,
          at,
          signature,
        ]),
        remove: removals.map(({ storeIndex, job }) => [storeIndex, job.id]),
      }),
    )
    .digest('hex');
  return { summary, removals, token };
}

export class LogRetention {
  private state: z.infer<typeof stateSchema> = { version: 1, policy: defaults() };
  private warning?: string;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ScheduleHandle;
  private closed = false;
  private scheduled = false;
  /**
   * 入口 / Entry: LogRetention.constructor.
   * 功能：建立 LogRetention 的规划并清理日志保留内容上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the LogRetention context for this module's responsibility: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: stores: () => JobsV1[]; file: default=join(DATA, 'log-retention.json'); blocked: default=() => false; now: default=Date.now; activity: default=(_delta: number) => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private stores: () => JobsV1[],
    private file = join(DATA, 'log-retention.json'),
    private blocked = () => false,
    private now = Date.now,
    private activity = (_delta: number) => {},
  ) {}
  /**
   * 入口 / Entry: LogRetention.init.
   * 功能：在规划并清理日志保留内容中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.warning`, `this.timer`（`LogRetention`）。
   * Purpose: Initializes and verifies current domain state in `LogRetention`; the outcome is recorded in `this.state`, `this.warning`, `this.timer`. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `stateSchema.parse`, `readStore`, `scheduler.register` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `scheduler.register`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `schedule`.
   * 输入 / Inputs: schedule: default=true
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.warning`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `this.warning = '日志策略读取失败，自动清理已停用；请检查并重新保存策略。';`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.warning = '日志策略读取失败，自动清理已停用；请检查并重新保存策略。';`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init(schedule = true) {
    try {
      this.state = stateSchema.parse(await readStore(this.file, () => this.state));
    } catch {
      this.warning = '日志策略读取失败，自动清理已停用；请检查并重新保存策略。';
    }
    if (schedule) {
      this.timer = scheduler.register({ owner: 'core:log-retention', label: '日志保留清理', intervalMs: 60000,
        overlap: 'skip', backoff: { initialMs: 60000, maxMs: 600000 },
        /**
         * 入口 / Entry: LogRetention.init.run.
         * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`LogRetention`）。
         * Purpose: Executes the domain-specific processing steps and returns their outcome in `LogRetention`; this entry produces `void` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
         * 处理：通过 `this.blocked`, `this.sweep().finally`, `this.sweep` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `this.blocked`, `this.sweep().finally`, `this.sweep`; the branches below determine continuation, return or refusal.
         * 分支 / Branches: `this.scheduled || this.closed || this.blocked() || !this.state.policy.enabled`.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `void`.
         * 副作用 / Effects: 更新 / updates `this.scheduled`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: async () => {
        if (this.scheduled || this.closed || this.blocked() || !this.state.policy.enabled) return;
        this.scheduled = true;
        await this.sweep().finally(() => {
            this.scheduled = false;
          });
      } });
    }
  }
  /**
   * 入口 / Entry: LogRetention.serialized.
   * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('日志保留服务正在关闭', 503))` / `pending` 供上层消费（`LogRetention`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LogRetention`; this entry produces `Promise.reject(new AppError('日志保留服务正在关闭', 503))` / `pending` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `Promise.reject`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `Promise.reject(new AppError('日志保留服务正在关闭', 503))`; `pending`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new AppError('日志保留服务正在关闭', 503));
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        this.activity(1);
        try {
          return await work();
        } finally {
          this.activity(-1);
        }
      });
    this.queue = pending;
    return pending;
  }
  /**
   * 入口 / Entry: LogRetention.view.
   * 功能：在规划并清理日志保留内容中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: { ...this.state.policy }, summary: planLogRetention(this.stores(), this.state.policy, this.now()).summary, lastRun:…` 供上层消费（`LogRetention`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `LogRetention`; this entry produces `{ policy: { ...this.state.policy }, summary: planLogRetention(this.stores(), this.state.policy, this.now()).summary, lastRun:…` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `planLogRetention`, `this.stores`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `planLogRetention`, `this.stores`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: LogRetentionView；结果来自 / values from `{ policy: { ...this.state.policy }, summary: planLogRetention(this.stores(), this.state.policy, this.now()).summary, lastRun:…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): LogRetentionView {
    return {
      policy: { ...this.state.policy },
      summary: planLogRetention(this.stores(), this.state.policy, this.now()).summary,
      lastRun: this.state.lastRun && { ...this.state.lastRun },
      warning: this.warning,
    };
  }
  /**
   * 入口 / Entry: LogRetention.preview.
   * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...plan.summary, token: this.previewToken(plan.token) }` 供上层消费（`LogRetention`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LogRetention`; this entry produces `{ ...plan.summary, token: this.previewToken(plan.token) }` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `logRetentionPolicy.parse`, `planLogRetention`, `this.stores`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `logRetentionPolicy.parse`, `planLogRetention`, `this.stores`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `{ ...plan.summary, token: this.previewToken(plan.token) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  preview(input: unknown) {
    const policy = logRetentionPolicy.parse(input);
    const plan = planLogRetention(this.stores(), policy, this.now());
    return { ...plan.summary, token: this.previewToken(plan.token) };
  }
  /**
   * 入口 / Entry: LogRetention.previewToken.
   * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256') .update(JSON.stringify([this.state.policy, plan])) .digest('hex')` 供上层消费（`LogRetention`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LogRetention`; this entry produces `createHash('sha256') .update(JSON.stringify([this.state.policy, plan])) .digest('hex')` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: plan: string
   * 输出 / Returns: `createHash('sha256') .update(JSON.stringify([this.state.policy, plan])) .digest('hex')`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private previewToken(plan: string) {
    return createHash('sha256')
      .update(JSON.stringify([this.state.policy, plan]))
      .digest('hex');
  }
  /**
   * 入口 / Entry: LogRetention.save.
   * 功能：在规划并清理日志保留内容中，校验并提交领域状态变更；本入口产生 `this.serialized(async () => { if (this.blocked()) throw new AppError('数据目录迁移维护中，日志清理已暂停', 409); const plan = planLogRetention…` 供上层消费（`LogRetention`）。
   * Purpose: Validates and commits a domain state change in `LogRetention`; this entry produces `this.serialized(async () => { if (this.blocked()) throw new AppError('数据目录迁移维护中，日志清理已暂停', 409); const plan = planLogRetention…` for its caller. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `logRetentionPolicy.parse`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `logRetentionPolicy.parse`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; token: string
   * 输出 / Returns: `this.serialized(async () => { if (this.blocked()) throw new AppError('数据目录迁移维护中，日志清理已暂停', 409); const plan = planLogRetention…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  save(input: unknown, token: string) {
    const policy = logRetentionPolicy.parse(input);
    /**
     * 入口 / Entry: LogRetention.save.callback@191.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`, `this.warning`.
     * 拒绝 / Refusals: 条件 / conditions `this.blocked()`; `this.previewToken(plan.token) !== token`; 异常 / errors `new AppError('数据目录迁移维护中，日志清理已暂停', 409)`; `new AppError('任务日志或策略已变化，请重新预览后保存', 409)`.
     */
    return this.serialized(async () => {
      if (this.blocked()) throw new AppError('数据目录迁移维护中，日志清理已暂停', 409);
      const plan = planLogRetention(this.stores(), policy, this.now());
      if (this.previewToken(plan.token) !== token)
        throw new AppError('任务日志或策略已变化，请重新预览后保存', 409);
      const next = { ...this.state, policy };
      // A failed policy write must never enable automatic deletion.
      await writeStore(this.file, next);
      this.state = next;
      this.warning = undefined;
      if (policy.enabled) await this.apply(plan);
      return this.view();
    });
  }
  /**
   * 入口 / Entry: LogRetention.sweep.
   * 功能：把本层请求转交 `this.serialized`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serialized` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.serialized(async () => { if (!this.state.policy.enabled || this.blocked()) return this.view(); await this.apply(planLogR…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sweep() {
    return this.serialized(async () => {
      if (!this.state.policy.enabled || this.blocked()) return this.view();
      await this.apply(planLogRetention(this.stores(), this.state.policy, this.now()));
      return this.view();
    });
  }
  /**
   * 入口 / Entry: LogRetention.apply.
   * 功能：在规划并清理日志保留内容中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.state`, `this.warning`（`LogRetention`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `LogRetention`; the outcome is recorded in `this.state`, `this.warning`. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `this.now`, `plan.removals.map`, `plan.removals.filter`, `store.clearCompletedLogs` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `plan.removals.map`, `plan.removals.filter`, `store.clearCompletedLogs`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: plan: ReturnType<typeof planLogRetention>
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `store.clearCompletedLogs`; `writeStore`; 更新 / updates `removedLogs`, `removedBytes`, `this.state`, `this.warning`.
   * 拒绝 / Refusals: 异常 / errors `new AppError(this.warning, 500)`.
   * 失败处理：catch 分支执行 `this.warning = '日志清理未全部完成，请检查任务历史的磁盘空间和权限；已完成部分不会恢复，稍后可重试。';`; `throw new AppError(this.warning, 500);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.warning = '日志清理未全部完成，请检查任务历史的磁盘空间和权限；已完成部分不会恢复，稍后可重试。';`; `throw new AppError(this.warning, 500);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async apply(plan: ReturnType<typeof planLogRetention>) {
    const at = new Date(this.now()).toISOString();
    let removedLogs = 0,
      removedBytes = 0;
    try {
      for (const store of new Set(plan.removals.map((item) => item.store))) {
        const items = plan.removals.filter((item) => item.store === store);
        const result = await store.clearCompletedLogs(
          items.map((item) => ({ id: item.job.id!, signature: item.signature })),
          at,
        );
        removedLogs += result.removedLogs;
        removedBytes += result.removedBytes;
      }
      const next = { ...this.state, lastRun: { at, removedLogs, removedBytes } };
      await writeStore(this.file, next);
      this.state = next;
      this.warning = undefined;
    } catch {
      this.warning = '日志清理未全部完成，请检查任务历史的磁盘空间和权限；已完成部分不会恢复，稍后可重试。';
      throw new AppError(this.warning, 500);
    }
  }
  /**
   * 入口 / Entry: LogRetention.close.
   * 功能：在规划并清理日志保留内容中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`LogRetention`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `LogRetention`; the outcome is recorded in `this.closed`. Module context: Plans and removes expired logs; unreadable policies disable automatic sweeping to preserve evidence.
   * 处理：通过 `this.timer.close`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.queue.catch(() => {});
  }
}

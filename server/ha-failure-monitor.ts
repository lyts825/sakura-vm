/**
 * 模块职责：采样 HA 可用状态并推进失效观察，保留停止与探测失败的可诊断结果。
 * Module purpose: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
 */
import { scheduler } from './scheduler.ts';
import { pluginAuthority } from './plugin-authority.ts';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { z } from 'zod';
import { DATA } from './paths.ts';
import { type VMStatus } from '../shared/contracts/vm.ts';
import { readStore, writeStore } from './local-store.ts';
import { haFailoverOptions } from './ha-failover.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const INTERVAL_MS = 15_000;
const monitorSchema = z.object({
  armed: z.boolean(),
  consecutiveFailures: z.number().int().min(0),
  observedState: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
  observedAt: z.string(),
  policyVersion: z.string().optional(),
  lastHealthyAt: z.string().optional(),
  suspectedAt: z.string().optional(),
});
export type HaMonitorStatus = z.infer<typeof monitorSchema>;
type Policy = { enabled: boolean; options: unknown; updatedAt?: string };
type MachineStates = Pick<Machines, 'state' | 'on' | 'off'>;

/**
 * 入口 / Entry: advanceHaMonitor.
 * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；本入口产生 `previous` / `{ armed: false, consecutiveFailures: 0, observedState: source, observedAt: at, policyVersion: policy.updatedAt, lastHealthyAt…` 供上层消费（`ha-failure-monitor.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-failure-monitor.ts`; this entry produces `previous` / `{ armed: false, consecutiveFailures: 0, observedState: source, observedAt: at, policyVersion: policy.updatedAt, lastHealthyAt…` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
 * 处理：通过 `haFailoverOptions.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `haFailoverOptions.parse`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `previous?.policyVersion !== policy.updatedAt`; `previous && !countFailure && previous.observedState === source`; `!policy.enabled || !options.targetHostId || source === 'stopping' || source === 'paused'`.
 * 输入 / Inputs: previous: HaMonitorStatus | undefined; source: VMStatus; policy: Policy; at: string; countFailure: boolean
 * 输出 / Returns: HaMonitorStatus；结果来自 / values from `previous`; `{ armed: false, consecutiveFailures: 0, observedState: source, observedAt: at, policyVersion: policy.updatedAt, lastHealthyAt…`; `{ armed: true, consecutiveFailures: 0, observedState: source, observedAt: at, policyVersion: policy.updatedAt, lastHealthyAt:…`.
 * 副作用 / Effects: 更新 / updates `previous`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function advanceHaMonitor(
  previous: HaMonitorStatus | undefined,
  source: VMStatus,
  policy: Policy,
  at: string,
  countFailure: boolean,
): HaMonitorStatus {
  const options = haFailoverOptions.parse(policy.options);
  if (previous?.policyVersion !== policy.updatedAt) previous = undefined;
  if (previous && !countFailure && previous.observedState === source) return previous;
  const base: HaMonitorStatus = previous || {
    armed: false,
    consecutiveFailures: 0,
    observedState: source,
    observedAt: at,
    policyVersion: policy.updatedAt,
  };
  if (!policy.enabled || !options.targetHostId || source === 'stopping' || source === 'paused')
    return {
      armed: false,
      consecutiveFailures: 0,
      observedState: source,
      observedAt: at,
      policyVersion: policy.updatedAt,
      lastHealthyAt: base.lastHealthyAt,
    };
  if (source === 'running')
    return {
      armed: true,
      consecutiveFailures: 0,
      observedState: source,
      observedAt: at,
      policyVersion: policy.updatedAt,
      lastHealthyAt: at,
    };
  if (source === 'starting') return { ...base, observedState: source, observedAt: at };
  const failures =
    base.armed && countFailure
      ? Math.min(options.failureThreshold, base.consecutiveFailures + 1)
      : base.consecutiveFailures;
  return {
    ...base,
    consecutiveFailures: failures,
    observedState: source,
    observedAt: at,
    suspectedAt: failures >= options.failureThreshold ? base.suspectedAt || at : undefined,
  };
}

export class HaFailureMonitor {
  private statuses: Record<string, HaMonitorStatus> = {};
  private timer?: ReturnType<typeof scheduler.register>;
  private work = Promise.resolve();
  private closed = false;
  private initialized = false;
  private readonly instance = pluginAuthority();

  /**
   * 入口 / Entry: HaFailureMonitor.constructor.
   * 功能：建立 HaFailureMonitor 的采样 HA 可用状态并推进失效观察上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaFailureMonitor context for this module's responsibility: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: MachineStates; policies: () => Promise<Record<string, Policy>>; file: default=join(DATA, 'ha-failure-monitor.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: MachineStates,
    private policies: () => Promise<Record<string, Policy>>,
    private file = join(DATA, 'ha-failure-monitor.json'),
  ) {}

  /**
   * 入口 / Entry: HaFailureMonitor.enqueue.
   * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.work` 供上层消费（`HaFailureMonitor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaFailureMonitor`; this entry produces `this.work` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `this.work.catch().then`, `this.work.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.work.catch().then`, `this.work.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: task: () => Promise<void>
   * 输出 / Returns: `this.work`.
   * 副作用 / Effects: 更新 / updates `this.work`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private enqueue(task: () => Promise<void>) {
    this.work = this.work.catch(() => {}).then(task);
    return this.work;
  }

  /**
   * 入口 / Entry: HaFailureMonitor.change.
   * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaFailureMonitor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaFailureMonitor`; this entry produces `void` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `observed.set`, `this.machines.state`, `this.enqueue().catch`, `this.enqueue` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `observed.set`, `this.machines.state`, `this.enqueue().catch`, `this.enqueue`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.instance?.signal.aborted`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `observed.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 ，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute ; these statements determine whether a failure is absorbed or rejected again.
   */
  private change = () => {
    if (this.closed || this.instance?.signal.aborted) return;
    const observed = new Map<string, VMStatus>();
    for (const id of Object.keys(this.statuses)) {
      try {
        observed.set(id, this.machines.state(id));
      } catch {
        /* Deleted instance. */
      }
    }
    void this.enqueue(() => this.scan(false, observed)).catch((error) => {
      if (!this.closed && !this.instance?.signal.aborted) console.error('HA 状态观察失败：', error);
    });
  };

  /**
   * 入口 / Entry: HaFailureMonitor.stopRequested.
   * 功能：在采样 HA 可用状态并推进失效观察中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HaFailureMonitor`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HaFailureMonitor`; this entry produces `void` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `this.enqueue().catch`, `this.enqueue` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enqueue().catch`, `this.enqueue`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!status || this.closed`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.statuses[id]`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private stopRequested = (id: string) => {
    const status = this.statuses[id];
    if (!status || this.closed) return;
    this.statuses[id] = {
      ...status,
      armed: false,
      consecutiveFailures: 0,
      observedState: 'stopping',
      observedAt: new Date().toISOString(),
      suspectedAt: undefined,
    };
    void this.enqueue(() => writeStore(this.file, this.statuses)).catch((error) => {
      if (!this.closed && !this.instance?.signal.aborted) console.error('HA 停机观察失败：', error);
    });
  };

  /**
   * 入口 / Entry: HaFailureMonitor.init.
   * 功能：在采样 HA 可用状态并推进失效观察中，初始化并核对当前领域状态；处理结果记录到 `this.statuses[id]`, `this.initialized`, `this.timer`（`HaFailureMonitor`）。
   * Purpose: Initializes and verifies current domain state in `HaFailureMonitor`; the outcome is recorded in `this.statuses[id]`, `this.initialized`, `this.timer`. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `readStore`, `monitorSchema.safeParse`, `this.scan`, `this.machines.on` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `monitorSchema.safeParse`, `this.scan`, `this.machines.on`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `stored && typeof stored === 'object' && !Array.isArray(stored)`; `parsed.success`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.statuses[id]`, `this.initialized`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    const stored = await readStore(this.file, () => ({}));
    if (stored && typeof stored === 'object' && !Array.isArray(stored))
      for (const [id, raw] of Object.entries(stored)) {
        const parsed = monitorSchema.safeParse(raw);
        if (parsed.success) this.statuses[id] = parsed.data;
      }
    await this.scan(false);
    this.initialized = true;
    this.machines.on('change', this.change);
    this.machines.on('stop-requested', this.stopRequested);
    this.timer = scheduler.register({
      owner: 'core:ha-failure-monitor',
      label: 'HA 故障采样',
      intervalMs: INTERVAL_MS,
      overlap: 'skip',
      /**
       * 入口 / Entry: HaFailureMonitor.init.run.
       * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaFailureMonitor`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaFailureMonitor`; the calls and state transitions below complete the operation. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
       * 处理：通过 `this.sample` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.sample`; the branches below determine continuation, return or refusal.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: async () => {
        await this.sample();
      },
    });
  }

  /**
   * 入口 / Entry: HaFailureMonitor.scan.
   * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaFailureMonitor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaFailureMonitor`; this entry produces `void` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `this.policies`, `observed.get`, `this.machines.state`, `haFailoverOptions.safeParse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.policies`, `observed.get`, `this.machines.state`, `haFailoverOptions.safeParse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!(id in policies)`; `!options.success`.
   * 输入 / Inputs: countFailure: boolean; observed: Map<string, VMStatus> optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `observed.get`; `writeStore`; 更新 / updates `source`, `next[id]`, `this.statuses`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `delete next[id];`; `continue;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `delete next[id];`; `continue;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async scan(countFailure: boolean, observed?: Map<string, VMStatus>) {
    if (this.closed) return;
    const policies = await this.policies();
    const next = { ...this.statuses };
    const at = new Date().toISOString();
    for (const id of Object.keys(next)) if (!(id in policies)) delete next[id];
    for (const [id, policy] of Object.entries(policies)) {
      let source = observed?.get(id);
      try {
        source ||= this.machines.state(id);
      } catch {
        delete next[id];
        continue;
      }
      const options = haFailoverOptions.safeParse(policy.options);
      if (!options.success) {
        delete next[id];
        continue;
      }
      next[id] = advanceHaMonitor(next[id], source, policy, at, countFailure);
    }
    if (JSON.stringify(next) !== JSON.stringify(this.statuses)) {
      await writeStore(this.file, next);
      this.statuses = next;
    }
  }

  /**
   * 入口 / Entry: HaFailureMonitor.sample.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.enqueue(() => this.scan(true))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sample() {
    return this.enqueue(() => this.scan(true));
  }

  /**
   * 入口 / Entry: HaFailureMonitor.reconfigure.
   * 功能：在采样 HA 可用状态并推进失效观察中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaFailureMonitor`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaFailureMonitor`; the calls and state transitions below complete the operation. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `this.enqueue` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enqueue`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async reconfigure(id: string) {
    await this.enqueue(async () => {
      delete this.statuses[id];
      await this.scan(false);
    });
  }

  /**
   * 入口 / Entry: HaFailureMonitor.view.
   * 功能：从当前输入或状态计算 `status ? { ...status, suspected: !!status.suspectedAt, sampleIntervalSeconds: INTERVAL_MS / 1000 } : null`，供调用方后续验证或使用。
   * Purpose: Computes `status ? { ...status, suspected: !!status.suspectedAt, sampleIntervalSeconds: INTERVAL_MS / 1000 } : null` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `status ? { ...status, suspected: !!status.suspectedAt, sampleIntervalSeconds: INTERVAL_MS / 1000 } : null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  view(id: string) {
    const status = this.statuses[id];
    return status
      ? { ...status, suspected: !!status.suspectedAt, sampleIntervalSeconds: INTERVAL_MS / 1000 }
      : null;
  }

  /**
   * 入口 / Entry: HaFailureMonitor.close.
   * 功能：在采样 HA 可用状态并推进失效观察中，结束、撤销或清理本次拥有的领域资源；本入口产生 `void` 供上层消费（`HaFailureMonitor`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HaFailureMonitor`; this entry produces `void` for its caller. Module context: Samples availability and advances failure observations, retaining stop/probe errors for diagnosis.
   * 处理：通过 `this.timer.close`, `this.machines.off`, `this.work.catch`, `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`, `this.machines.off`, `this.work.catch`, `writeStore`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `!this.initialized`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.timer.close`; `writeStore`; 更新 / updates `this.closed`, `status.armed`, `status.consecutiveFailures`, `status.observedAt`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.timer?.close();
    this.machines.off('change', this.change);
    this.machines.off('stop-requested', this.stopRequested);
    await this.work.catch(() => {});
    if (!this.initialized) return;
    const at = new Date().toISOString();
    for (const status of Object.values(this.statuses)) {
      status.armed = false;
      status.consecutiveFailures = 0;
      delete status.suspectedAt;
      status.observedAt = at;
    }
    await writeStore(this.file, this.statuses);
  }
}

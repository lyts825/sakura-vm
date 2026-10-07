/**
 * 模块职责：采样客户机内存压力并计算回收决策，目标内存受策略和发行版最低要求限制。
 * Module purpose: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { distroInfo } from './images.ts';
import { readStore, writeStore } from './local-store.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const policySchema = z.object({
  enabled: z.boolean(),
  minMiB: z.number().int().min(256).max(8192),
}).strict();
type Policy = z.infer<typeof policySchema>;
const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('configure'), policy: policySchema }).strict(),
  z.object({ operation: z.literal('sample') }).strict(),
]);
export { requestSchema as memoryReclaimRequest };
type Sample = { totalMiB: number; availableMiB: number };
type Observation = { at: string; totalMiB: number; availableMiB: number;
  targetMiB: number; decision: 'shrink' | 'restore' | 'hold' | 'disabled';
  reason: string; error?: string };

/**
 * 入口 / Entry: parseGuestMemory.
 * 功能：在采样客户机内存压力并计算回收决策中，转换协议或持久数据表示并保持调用边界；本入口产生 `{ totalMiB, availableMiB }` 供上层消费（`memory-reclaim.ts`）。
 * Purpose: Converts protocol or durable data representations at the call boundary in `memory-reclaim.ts`; this entry produces `{ totalMiB, availableMiB }` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
 * 处理：通过 `inline.map`, `output.matchAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.map`, `output.matchAll`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: output: string
 * 输出 / Returns: Sample；结果来自 / values from `{ totalMiB, availableMiB }`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!Number.isFinite(totalMiB) || !Number.isFinite(availableMiB) || totalMiB < 128 || availableMiB < 0 || availableMiB > totalMiB`; 异常 / errors `new AppError('客户机内存压力数据无效', 502)`.
 */
export function parseGuestMemory(output: string): Sample {
  const values = Object.fromEntries([...output.matchAll(/^(MemTotal|MemAvailable):\s+(\d+) kB$/gm)]
    .map((entry) => [entry[1], Number(entry[2])]));
  const totalMiB = Math.floor(values.MemTotal / 1024);
  const availableMiB = Math.floor(values.MemAvailable / 1024);
  if (!Number.isFinite(totalMiB) || !Number.isFinite(availableMiB) || totalMiB < 128 ||
    availableMiB < 0 || availableMiB > totalMiB)
    throw new AppError('客户机内存压力数据无效', 502);
  return { totalMiB, availableMiB };
}

/**
 * 入口 / Entry: reclaimDecision.
 * 功能：在采样客户机内存压力并计算回收决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ targetMiB: minMiB, decision: 'restore' as const, reason: '当前目标低于策略或发行版最低内存要求' }` / `{ targetMiB: Math.min(maxMiB, currentMiB + 128), decision: 'restore' as const, reason: '客户机可用内存低于 20%，恢复 128 MiB' }` 供上层消费（`memory-reclaim.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `memory-reclaim.ts`; this entry produces `{ targetMiB: minMiB, decision: 'restore' as const, reason: '当前目标低于策略或发行版最低内存要求' }` / `{ targetMiB: Math.min(maxMiB, currentMiB + 128), decision: 'restore' as const, reason: '客户机可用内存低于 20%，恢复 128 MiB' }` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
 * 分支 / Branches: `currentMiB < minMiB`; `availablePercent <= 0.2 && currentMiB < maxMiB`; `availablePercent >= 0.55 && highSamples >= 3 && currentMiB > minMiB`.
 * 输入 / Inputs: currentMiB: number; maxMiB: number; minMiB: number; sample: Sample; highSamples: number
 * 输出 / Returns: `{ targetMiB: minMiB, decision: 'restore' as const, reason: '当前目标低于策略或发行版最低内存要求' }`; `{ targetMiB: Math.min(maxMiB, currentMiB + 128), decision: 'restore' as const, reason: '客户机可用内存低于 20%，恢复 128 MiB' }`; `{ targetMiB, decision: 'shrink' as const, reason: '客户机连续三次可用内存超过 55%，回收至多 64 MiB' }`；另有分支返回 / additional branch-specific returns.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function reclaimDecision(currentMiB: number, maxMiB: number, minMiB: number,
  sample: Sample, highSamples: number) {
  if (currentMiB < minMiB)
    return { targetMiB: minMiB, decision: 'restore' as const,
      reason: '当前目标低于策略或发行版最低内存要求' };
  const availablePercent = sample.availableMiB / sample.totalMiB;
  if (availablePercent <= 0.2 && currentMiB < maxMiB)
    return { targetMiB: Math.min(maxMiB, currentMiB + 128),
      decision: 'restore' as const, reason: '客户机可用内存低于 20%，恢复 128 MiB' };
  if (availablePercent >= 0.55 && highSamples >= 3 && currentMiB > minMiB) {
    const usedMiB = sample.totalMiB - sample.availableMiB;
    const safeFloor = usedMiB + Math.max(128, Math.ceil(currentMiB * 0.25));
    const targetMiB = Math.max(minMiB, safeFloor, currentMiB - 64);
    if (targetMiB < currentMiB)
      return { targetMiB, decision: 'shrink' as const,
        reason: '客户机连续三次可用内存超过 55%，回收至多 64 MiB' };
  }
  return { targetMiB: currentMiB, decision: 'hold' as const,
    reason: availablePercent >= 0.55 ? '等待连续三次高可用内存采样' : '内存压力处于保持区间' };
}

export class MemoryReclaim {
  private policies: Record<string, Policy> = {};
  private observations = new Map<string, Observation>();
  private highSamples = new Map<string, number>();
  private lastAdjustment = new Map<string, number>();
  private active = new Set<string>();
  private timer?: ScheduleHandle;
  private tick?: Promise<void>;
  private closed = false;
  private writes = Promise.resolve();
  /**
   * 入口 / Entry: MemoryReclaim.constructor.
   * 功能：建立 MemoryReclaim 的采样客户机内存压力并计算回收决策上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the MemoryReclaim context for this module's responsibility: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; reader: (id: string) => Promise<Sample> default=async (id) => { const result = await machines.exec(id, …; blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; clock: () => number default=() => Date.now()
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines,
    private reader: (id: string) => Promise<Sample> = async (id) => {
      const result = await machines.exec(id,
        "grep -E '^(MemTotal|MemAvailable):' /proc/meminfo", 10_000);
      if (result.code !== 0) throw new AppError(result.stderr || '客户机内存采样失败', 502);
      return parseGuestMemory(result.stdout);
    },
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private clock: () => number = () => Date.now(),
  ) {}
  /**
   * 入口 / Entry: MemoryReclaim.init.
   * 功能：在采样客户机内存压力并计算回收决策中，初始化并核对当前领域状态；处理结果记录到 `this.policies`, `this.timer`（`MemoryReclaim`）。
   * Purpose: Initializes and verifies current domain state in `MemoryReclaim`; the outcome is recorded in `this.policies`, `this.timer`. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `readStore`, `join`, `z.record().parse`, `z.record` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `join`, `z.record().parse`, `z.record`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.policies`, `this.timer`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    const saved = await readStore(join(DATA, 'memory-reclaim.json'), () => ({}));
    this.policies = z.record(z.uuid(), policySchema).parse(saved);
    this.timer = scheduler.register({ owner: 'core:memory-reclaim', label: '客户机内存回收采样', intervalMs: 15000,
      overlap: 'skip',
      /**
       * 入口 / Entry: MemoryReclaim.init.run.
       * 功能：在采样客户机内存压力并计算回收决策中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.tick`（`MemoryReclaim`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `MemoryReclaim`; the outcome is recorded in `this.tick`. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
       * 处理：通过 `this.sampleAll().finally`, `this.sampleAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `this.sampleAll().finally`, `this.sampleAll`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!this.tick && !this.closed`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 更新 / updates `this.tick`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: async () => {
      if (!this.tick && !this.closed) this.tick = this.sampleAll().finally(() => { this.tick = undefined; });
      await this.tick;
    } });
  }
  /**
   * 入口 / Entry: MemoryReclaim.view.
   * 功能：在采样客户机内存压力并计算回收决策中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: this.policies[id] || { enabled: false, minMiB: 256 }, effectiveMinMiB: Math.max(this.policies[id]?.minMiB || 256, d…` 供上层消费（`MemoryReclaim`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `MemoryReclaim`; this entry produces `{ policy: this.policies[id] || { enabled: false, minMiB: 256 }, effectiveMinMiB: Math.max(this.policies[id]?.minMiB || 256, d…` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `this.machines.get`, `this.machines.view`, `distroInfo`, `this.observations.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.view`, `distroInfo`, `this.observations.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ policy: this.policies[id] || { enabled: false, minMiB: 256 }, effectiveMinMiB: Math.max(this.policies[id]?.minMiB || 256, d…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id: string) {
    const vm = this.machines.get(id);
    const current = await this.machines.view(id);
    return { policy: this.policies[id] || { enabled: false, minMiB: 256 },
      effectiveMinMiB: Math.max(this.policies[id]?.minMiB || 256,
        distroInfo(vm.distro, vm.architecture).minimumMemory),
      currentTargetMiB: current.memoryTargetMiB || vm.memoryMiB,
      observation: this.observations.get(id) || null };
  }
  /**
   * 入口 / Entry: MemoryReclaim.action.
   * 功能：在采样客户机内存压力并计算回收决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view(id)` 供上层消费（`MemoryReclaim`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MemoryReclaim`; this entry produces `this.view(id)` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `requestSchema.parse`, `this.machines.requireUnlocked`, `this.blocked`, `this.sample` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `requestSchema.parse`, `this.machines.requireUnlocked`, `this.blocked`, `this.sample`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `input.operation === 'sample'`.
   * 输入 / Inputs: id: string; raw: unknown
   * 输出 / Returns: `this.view(id)`.
   * 副作用 / Effects: `requestSchema.parse`; `this.writes.catch().then`; `this.writes.catch`; `this.highSamples.delete`; 更新 / updates `this.writes`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; `input.policy.enabled && vm.hardware?.devices?.balloon === false`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async action(id: string, raw: unknown) {
    const input = requestSchema.parse(raw);
    if (this.closed) throw new AppError('服务正在关闭', 503);
    this.machines.requireUnlocked(id);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    if (input.operation === 'sample') {
      await this.sample(id);
      return this.view(id);
    }
    const vm = this.machines.get(id);
    if (input.policy.enabled && vm.hardware?.devices?.balloon === false)
      throw new AppError('此实例关闭了 Virtio 内存气球设备', 409);
    if (input.policy.minMiB > vm.memoryMiB)
      throw new AppError('最小目标不能超过实例配置内存', 409);
    this.mutation(1);
    try {
      const operation = this.writes.catch(() => {}).then(async () => {
        const next = { ...this.policies, [id]: input.policy };
        await writeStore(join(DATA, 'memory-reclaim.json'), next);
        this.policies = next;
      });
      this.writes = operation;
      await operation;
      this.highSamples.delete(id);
      return this.view(id);
    } finally { this.mutation(-1); }
  }
  /**
   * 入口 / Entry: MemoryReclaim.sample.
   * 功能：在采样客户机内存压力并计算回收决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MemoryReclaim`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MemoryReclaim`; this entry produces `void` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `this.active.has`, `this.active.add`, `this.machines.get`, `this.machines.state` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.has`, `this.active.add`, `this.machines.get`, `this.machines.state`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.active.has(id)`; `this.machines.state(id) !== 'running'`; `decision === 'shrink' || decision === 'restore'`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `void`.
   * 副作用 / Effects: `this.active.add`; `this.highSamples.delete`; `this.highSamples.set`; `this.machines.setMemoryTarget`; `this.lastAdjustment.set`; 更新 / updates `targetMiB`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 收尾：退出 try 区域时始终执行 `this.active.delete(id);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active.delete(id);`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `const prior = this.observations.get(id);`; `this.observations.set(id, { at: new Date().toISOString(), totalMiB: prior?.totalMiB || 0, availableMiB: prior?.availableMiB |…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const prior = this.observations.get(id);`; `this.observations.set(id, { at: new Date().toISOString(), totalMiB: prior?.totalMiB || 0, availableMiB: prior?.availableMiB |…`; these statements determine whether a failure is absorbed or rejected again.
   */
  async sample(id: string) {
    if (this.active.has(id)) return;
    this.active.add(id);
    try {
      const vm = this.machines.get(id);
      if (this.machines.state(id) !== 'running') {
        this.highSamples.delete(id);
        return;
      }
      const sample = await this.reader(id);
      const current = this.machines.live.get(id)?.memoryTargetMiB || vm.memoryMiB;
      const policy = this.policies[id];
      const minimum = Math.max(policy?.minMiB || 256,
        distroInfo(vm.distro, vm.architecture).minimumMemory);
      const high = sample.availableMiB / sample.totalMiB >= 0.55
        ? (this.highSamples.get(id) || 0) + 1 : 0;
      this.highSamples.set(id, high);
      const planned = reclaimDecision(current, vm.memoryMiB, minimum, sample, high);
      const enabled = !!policy?.enabled && !this.blocked() &&
        vm.hardware?.devices?.balloon !== false;
      const cooldown = current >= minimum &&
        this.clock() - (this.lastAdjustment.get(id) || 0) < 60_000;
      const decision = enabled && !cooldown ? planned.decision : 'disabled';
      const reason = !enabled ? '自动回收未启用或暂不可用' :
        cooldown ? '内存调整后冷却 60 秒' : planned.reason;
      let targetMiB = current;
      if (decision === 'shrink' || decision === 'restore') {
        const updated = await this.machines.setMemoryTarget(id, planned.targetMiB);
        targetMiB = updated.memoryTargetMiB || planned.targetMiB;
        this.lastAdjustment.set(id, this.clock());
        this.highSamples.set(id, 0);
      }
      this.observations.set(id, { at: new Date().toISOString(), ...sample,
        targetMiB, decision, reason });
    } catch (error) {
      const prior = this.observations.get(id);
      this.observations.set(id, { at: new Date().toISOString(), totalMiB: prior?.totalMiB || 0,
        availableMiB: prior?.availableMiB || 0, targetMiB: prior?.targetMiB || 0,
        decision: 'hold', reason: '采样或气球调整失败', error: String((error as Error).message || error) });
      throw error;
    } finally { this.active.delete(id); }
  }
  /**
   * 入口 / Entry: MemoryReclaim.sampleAll.
   * 功能：在采样客户机内存压力并计算回收决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`MemoryReclaim`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `MemoryReclaim`; this entry produces `void` for its caller. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `this.blocked`, `this.machines.records.has`, `this.sample().catch`, `this.sample` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.machines.records.has`, `this.sample().catch`, `this.sample`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.blocked()`; `this.closed`; `!this.policies[id].enabled || !this.machines.records.has(id)`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async sampleAll() {
    if (this.blocked()) return;
    for (const id of Object.keys(this.policies)) {
      if (this.closed) break;
      if (!this.policies[id].enabled || !this.machines.records.has(id)) continue;
      await this.sample(id).catch(() => {});
    }
  }
  /**
   * 入口 / Entry: MemoryReclaim.close.
   * 功能：在采样客户机内存压力并计算回收决策中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`MemoryReclaim`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `MemoryReclaim`; the outcome is recorded in `this.closed`. Module context: Samples guest memory pressure and calculates reclaim decisions within policy and distribution minimum limits.
   * 处理：通过 `this.timer.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.close`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.timer?.close();
    await this.tick;
    await this.writes;
  }
}

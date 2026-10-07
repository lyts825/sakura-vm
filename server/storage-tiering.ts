/**
 * 模块职责：保存热冷存储策略并迁移实例，要求明确且不同的存储池并协调后台调度。
 * Module purpose: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
 */
import { join } from 'node:path';
import { z } from 'zod';
import type { VmAccess as Machines } from './vm-access.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { type VMRecord } from '../shared/contracts/vm.ts';
import { readStore, writeStore } from './local-store.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

const poolId = z.string().regex(/^(default|[a-f0-9]{16})$/);
export const tieringPolicy = z
  .object({
    enabled: z.boolean(),
    hotPoolId: poolId,
    coldPoolId: poolId,
    idleHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365),
    intervalHours: z.number().int().min(1).max(24),
  })
  .strict()
  .refine((value) => value.hotPoolId !== value.coldPoolId, '热池与冷池必须不同');
export const tieringInput = z
  .object({
    mode: z.enum(['status', 'save', 'apply', 'rebalance']).default('status'),
    enabled: z.boolean().optional(),
    hotPoolId: poolId.optional(),
    coldPoolId: poolId.optional(),
    idleHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .optional(),
    intervalHours: z.number().int().min(1).max(24).optional(),
  })
  .strict();
type Policy = z.infer<typeof tieringPolicy>;
const historyEntry = z
  .object({
    vmId: z.uuid(),
    name: z.string(),
    from: poolId,
    to: poolId,
    at: z.iso.datetime(),
    status: z.enum(['moved', 'failed']),
    error: z.string().max(500).optional(),
  })
  .strict();
const storeSchema = z
  .object({
    version: z.literal(1),
    policy: tieringPolicy.optional(),
    lastRunAt: z.iso.datetime().optional(),
    history: z.array(historyEntry).max(100).default([]),
  })
  .strict();
type Store = z.infer<typeof storeSchema>;
type PoolView = Awaited<ReturnType<Machines['storagePools']['view']>>['pools'][number];

export class StorageTiering {
  private state?: Store;
  private loading?: Promise<Store>;
  private scheduled?: ScheduleHandle;
  private active?: Promise<unknown>;
  private controller?: AbortController;
  private closed = false;
  private lastError?: string;
  /**
   * 入口 / Entry: StorageTiering.constructor.
   * 功能：建立 StorageTiering 的保存热冷存储策略并迁移实例上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the StorageTiering context for this module's responsibility: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'storage-tiering.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private machines: Machines,
    private file = join(DATA, 'storage-tiering.json'),
  ) {}

  /**
   * 入口 / Entry: StorageTiering.load.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `(this.state ||= await this.loading)` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `(this.state ||= await this.loading)` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `readStore().then`, `readStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore().then`, `readStore`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.loading`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `(this.state ||= await this.loading)`.
   * 副作用 / Effects: 更新 / updates `this.loading`, `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async load() {
    if (!this.loading)
      this.loading = readStore(this.file, () => ({ version: 1 as const, history: [] })).then((value) =>
        storeSchema.parse(value),
      );
    return (this.state ||= await this.loading);
  }

  /**
   * 入口 / Entry: StorageTiering.init.
   * 功能：在保存热冷存储策略并迁移实例中，初始化并核对当前领域状态；完成下述调用及状态处理（`StorageTiering`）。
   * Purpose: Initializes and verifies current domain state in `StorageTiering`; the calls and state transitions below complete the operation. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.load`, `this.schedule`, `this.scheduled.trigger` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `this.schedule`, `this.scheduled.trigger`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `state.policy?.enabled && (!state.lastRunAt || Date.now() - Date.parse(state.lastRunAt) >= state.poli…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async init() {
    const state = await this.load();
    await this.schedule();
    if (
      state.policy?.enabled &&
      (!state.lastRunAt || Date.now() - Date.parse(state.lastRunAt) >= state.policy.intervalHours * 3_600_000)
    )
      this.scheduled?.trigger();
  }

  /**
   * 入口 / Entry: StorageTiering.schedule.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.scheduled`（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; the outcome is recorded in `this.scheduled`. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.scheduled.close`, `scheduler.register` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scheduled.close`, `scheduler.register`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!this.closed && policy?.enabled`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.scheduled.close`; `scheduler.register`; 更新 / updates `this.scheduled`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async schedule() {
    await this.scheduled?.close();
    this.scheduled = undefined;
    const policy = this.state?.policy;
    if (!this.closed && policy?.enabled) {
      this.scheduled = scheduler.register({
        owner: 'core:storage-tiering',
        label: 'Storage tier placement',
        intervalMs: policy.intervalHours * 3_600_000,
        overlap: 'skip',
        catchUp: 'once',
        /**
         * 入口 / Entry: StorageTiering.schedule.run.
         * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
         * 输入 / Inputs: { signal }
         * 输出 / Returns: `this.tick(signal)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        run: ({ signal }) => this.tick(signal),
      });
    }
  }

  /**
   * 入口 / Entry: StorageTiering.change.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `next` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `next` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `structuredClone`, `this.load`, `edit`, `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `structuredClone`, `this.load`, `edit`, `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: edit: (state: Store) => void
   * 输出 / Returns: `next`.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async change(edit: (state: Store) => void) {
    const next = structuredClone(await this.load());
    edit(next);
    await writeStore(this.file, next);
    this.state = next;
    return next;
  }

  /**
   * 入口 / Entry: StorageTiering.decide.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ vmId: vm.id, name: vm.name, currentPoolId, targetPoolId, lastUsedAt, ready: !reason, reason }` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `{ vmId: vm.id, name: vm.name, currentPoolId, targetPoolId, lastUsedAt, ready: !reason, reason }` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `pools.find`, `this.machines.live.has`, `this.machines.storagePools.hasPendingCleanup`, `source.vms.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `pools.find`, `this.machines.live.has`, `this.machines.storagePools.hasPendingCleanup`, `source.vms.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!policy`; `vm.sandbox || vm.rescueOf`; `this.machines.live.has(vm.id)`.
   * 输入 / Inputs: vm: VMRecord; policy: Policy | undefined; pools: PoolView[]; at: default=Date.now()
   * 输出 / Returns: `{ vmId: vm.id, name: vm.name, currentPoolId, targetPoolId, lastUsedAt, ready: !reason, reason }`.
   * 副作用 / Effects: 更新 / updates `reason`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private decide(vm: VMRecord, policy: Policy | undefined, pools: PoolView[], at = Date.now()) {
    const currentPoolId = vm.storagePoolId || 'default';
    const lastUsedAt = vm.lastUsedAt || vm.createdAt;
    const used = Date.parse(lastUsedAt);
    const targetPoolId =
      policy && Number.isFinite(used)
        ? at - used >= policy.idleHours * 3_600_000
          ? policy.coldPoolId
          : policy.hotPoolId
        : null;
    const target = pools.find((pool) => pool.id === targetPoolId);
    const source = pools.find((pool) => pool.id === currentPoolId);
    let reason = '';
    if (!policy) reason = '尚未保存热/冷池策略';
    else if (vm.sandbox || vm.rescueOf) reason = '临时沙箱或救援实例不参与分层';
    else if (this.machines.live.has(vm.id)) reason = '实例仍在运行';
    else if (this.machines.storagePools.hasPendingCleanup(vm.id)) reason = '此前迁移的旧副本尚待清理';
    else if (!targetPoolId) reason = '最近使用时间无效';
    else if (currentPoolId === targetPoolId) reason = '实例已位于目标池';
    else if (!target?.available) reason = '目标存储池不可用';
    else if (
      target.freeBytes !== null &&
      source &&
      target.freeBytes < (source.vms.find((item) => item.id === vm.id)?.diskBytes || 0) + 64 * 1024 ** 2
    )
      reason = '目标存储池可用容量不足';
    return { vmId: vm.id, name: vm.name, currentPoolId, targetPoolId, lastUsedAt, ready: !reason, reason };
  }

  /**
   * 入口 / Entry: StorageTiering.view.
   * 功能：在保存热冷存储策略并迁移实例中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: state.policy || null, lastRunAt: state.lastRunAt || null, lastError: this.lastError || null, history: state.history…` 供上层消费（`StorageTiering`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `StorageTiering`; this entry produces `{ policy: state.policy || null, lastRunAt: state.lastRunAt || null, lastError: this.lastError || null, history: state.history…` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.load`, `this.machines.storagePools.view`, `inline.map`, `this.machines.records.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `this.machines.storagePools.view`, `inline.map`, `this.machines.records.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string optional
   * 输出 / Returns: `{ policy: state.policy || null, lastRunAt: state.lastRunAt || null, lastError: this.lastError || null, history: state.history…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(id?: string) {
    const state = await this.load();
    const pools = (await this.machines.storagePools.view()).pools;
    const candidates = [...this.machines.records.values()].map((vm) => this.decide(vm, state.policy, pools));
    return {
      policy: state.policy || null,
      lastRunAt: state.lastRunAt || null,
      lastError: this.lastError || null,
      history: state.history.slice(-40).reverse(),
      current: id ? candidates.find((item) => item.vmId === id) || null : null,
      candidates,
      pools: pools.map((pool) => ({
        id: pool.id,
        name: pool.name,
        available: pool.available,
        freeBytes: pool.freeBytes,
      })),
      running: !!this.active,
    };
  }

  /**
   * 入口 / Entry: StorageTiering.apply.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...decision, moved: false }` / `{ ...decision, moved: moved.moved, cleanupPending: moved.cleanupPending }` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `{ ...decision, moved: false }` / `{ ...decision, moved: moved.moved, cleanupPending: moved.cleanupPending }` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.load`, `this.machines.storagePools.view`, `this.decide`, `this.machines.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `this.machines.storagePools.view`, `this.decide`, `this.machines.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `decision.currentPoolId === decision.targetPoolId`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `{ ...decision, moved: false }`; `{ ...decision, moved: moved.moved, cleanupPending: moved.cleanupPending }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!decision.targetPoolId`; `!decision.ready`; 异常 / errors `new AppError(decision.reason, 409)`.
   */
  private async apply(id: string, signal?: AbortSignal, log: (text: string) => void = () => {}) {
    const policy = (await this.load()).policy;
    const pools = (await this.machines.storagePools.view()).pools;
    const decision = this.decide(this.machines.get(id), policy, pools);
    if (!decision.targetPoolId) throw new AppError(decision.reason, 409);
    if (!decision.ready) {
      if (decision.currentPoolId === decision.targetPoolId) return { ...decision, moved: false };
      throw new AppError(decision.reason, 409);
    }
    const moved = await this.machines.moveStoragePool(id, decision.targetPoolId, signal, log);
    return { ...decision, moved: moved.moved, cleanupPending: moved.cleanupPending };
  }

  /**
   * 入口 / Entry: StorageTiering.rebalance.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ moved: entries.filter((item) => item.status === 'moved').length, failed: entries.filter((item) => item.status === 'failed')…` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `{ moved: entries.filter((item) => item.status === 'moved').length, failed: entries.filter((item) => item.status === 'failed')…` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.load`, `inline.candidates.filter`, `this.view`, `signal.throwIfAborted` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `inline.candidates.filter`, `this.view`, `signal.throwIfAborted`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `result.moved`.
   * 输入 / Inputs: signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `{ moved: entries.filter((item) => item.status === 'moved').length, failed: entries.filter((item) => item.status === 'failed')…`.
   * 副作用 / Effects: `entries.push`.
   * 拒绝 / Refusals: 条件 / conditions `!state.policy`; `signal?.aborted`; 异常 / errors `new AppError('请先保存热/冷池策略', 409)`; `error`.
   * 失败处理：catch 分支执行 `if (signal?.aborted) throw error;`; `const message = String((error as Error).message || error).slice(0, 500);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (signal?.aborted) throw error;`; `const message = String((error as Error).message || error).slice(0, 500);`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async rebalance(signal?: AbortSignal, log: (text: string) => void = () => {}) {
    const state = await this.load();
    if (!state.policy) throw new AppError('请先保存热/冷池策略', 409);
    const candidates = (await this.view()).candidates.filter((item) => item.ready);
    const entries: z.infer<typeof historyEntry>[] = [];
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      const from = candidate.currentPoolId,
        to = candidate.targetPoolId!;
      try {
        const result = await this.apply(candidate.vmId, signal, log);
        if (result.moved)
          entries.push({
            vmId: candidate.vmId,
            name: candidate.name,
            from,
            to,
            at: new Date().toISOString(),
            status: 'moved',
          });
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = String((error as Error).message || error).slice(0, 500);
        entries.push({
          vmId: candidate.vmId,
          name: candidate.name,
          from,
          to,
          at: new Date().toISOString(),
          status: 'failed',
          error: message,
        });
        log(`${candidate.name}：${message}\n`);
      }
    }
    await this.change((next) => {
      next.lastRunAt = new Date().toISOString();
      next.history = [...next.history, ...entries].slice(-100);
    });
    return {
      moved: entries.filter((item) => item.status === 'moved').length,
      failed: entries.filter((item) => item.status === 'failed').length,
      entries,
    };
  }

  /**
   * 入口 / Entry: StorageTiering.exclusive.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await operation` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `await operation` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `work`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>; controller: AbortController optional
   * 输出 / Returns: `await operation`.
   * 副作用 / Effects: 更新 / updates `this.active`, `this.controller`.
   * 拒绝 / Refusals: 条件 / conditions `this.active`; 异常 / errors `new AppError('分层迁移正在执行', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.active = undefined;`; `this.controller = undefined;`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.active = undefined;`; `this.controller = undefined;`; these steps also apply to exceptional exits.
   */
  private async exclusive<T>(work: () => Promise<T>, controller?: AbortController) {
    if (this.active) throw new AppError('分层迁移正在执行', 409);
    const operation = work();
    this.active = operation;
    this.controller = controller;
    try {
      return await operation;
    } finally {
      this.active = undefined;
      this.controller = undefined;
    }
  }

  /**
   * 入口 / Entry: StorageTiering.tick.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `void` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.load`, `this.exclusive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.load`, `this.exclusive`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.active || !(await this.load()).policy?.enabled`.
   * 输入 / Inputs: signal: AbortSignal optional
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.lastError`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.lastError = String((error as Error).message || error).slice(0, 500);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.lastError = String((error as Error).message || error).slice(0, 500);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async tick(signal?: AbortSignal) {
    if (this.closed || this.active || !(await this.load()).policy?.enabled) return;
    const controller = new AbortController();
    try {
      await this.exclusive(
        () => this.rebalance(signal ? AbortSignal.any([signal, controller.signal]) : controller.signal),
        controller,
      );
      this.lastError = undefined;
    } catch (error) {
      this.lastError = String((error as Error).message || error).slice(0, 500);
      throw error;
    }
  }

  /**
   * 入口 / Entry: StorageTiering.run.
   * 功能：在保存热冷存储策略并迁移实例中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...(await this.view(id)), ready: true, executed: false }` / `{ ...(await this.view(id)), ready: true, executed: true }` 供上层消费（`StorageTiering`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `StorageTiering`; this entry produces `{ ...(await this.view(id)), ready: true, executed: false }` / `{ ...(await this.view(id)), ready: true, executed: true }` for its caller. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.machines.get`, `tieringInput.parse`, `this.view`, `tieringPolicy.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `tieringInput.parse`, `this.view`, `tieringPolicy.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'check' || value.mode === 'status'`; `value.mode === 'apply'`.
   * 输入 / Inputs: id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional; log: (text: string) => void default=() => {}
   * 输出 / Returns: `{ ...(await this.view(id)), ready: true, executed: false }`; `{ ...(await this.view(id)), ready: true, executed: true }`; `{ ...(await this.view(id)), ready: true, executed: result.moved, applied: result }`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `value.mode === 'save'`; `this.active`; 异常 / errors `new AppError('分层迁移正在执行，请稍后修改策略', 409)`.
   */
  async run(
    id: string,
    input: unknown,
    action: 'check' | 'run',
    signal?: AbortSignal,
    log: (text: string) => void = () => {},
  ) {
    this.machines.get(id);
    const value = tieringInput.parse(input);
    if (action === 'check' || value.mode === 'status')
      return { ...(await this.view(id)), ready: true, executed: false };
    if (value.mode === 'save') {
      const policy = tieringPolicy.parse({
        enabled: value.enabled,
        hotPoolId: value.hotPoolId,
        coldPoolId: value.coldPoolId,
        idleHours: value.idleHours,
        intervalHours: value.intervalHours,
      });
      await this.machines.storagePools.ensure(policy.hotPoolId);
      await this.machines.storagePools.ensure(policy.coldPoolId);
      if (this.active) throw new AppError('分层迁移正在执行，请稍后修改策略', 409);
      await this.change((state) => {
        state.policy = policy;
      });
      await this.schedule();
      return { ...(await this.view(id)), ready: true, executed: true };
    }
    if (value.mode === 'apply') {
      /**
       * 入口 / Entry: StorageTiering.run.callback@287.
       * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
       * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `{ ...applied, ...(warning ? { warning } : {}) }`.
       * 副作用 / Effects: 更新 / updates `warning`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       * 失败处理：catch 分支执行 `warning = `迁移已完成，但记录分层历史失败：${String((error as Error).message || error)}`;`; `log(`${warning}\n`);`，是否吞掉错误或重新拒绝由这些语句决定。
       * Failure handling: Catch paths execute `warning = `迁移已完成，但记录分层历史失败：${String((error as Error).message || error)}`;`; `log(`${warning}\n`);`; these statements determine whether a failure is absorbed or rejected again.
       */
      const result = await this.exclusive(async () => {
        const applied = await this.apply(id, signal, log);
        let warning: string | undefined;
        if (applied.moved)
          try {
            /**
             * 入口 / Entry: StorageTiering.run.callback@292.
             * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
             * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
             * 输入 / Inputs: state
             * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
             * 副作用 / Effects: 更新 / updates `state.history`.
             * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
             */
            await this.change((state) => {
              state.history = [
                ...state.history,
                {
                  vmId: id,
                  name: applied.name,
                  from: applied.currentPoolId,
                  to: applied.targetPoolId!,
                  at: new Date().toISOString(),
                  status: 'moved' as const,
                },
              ].slice(-100);
            });
          } catch (error) {
            warning = `迁移已完成，但记录分层历史失败：${String((error as Error).message || error)}`;
            log(`${warning}\n`);
          }
        return { ...applied, ...(warning ? { warning } : {}) };
      });
      return { ...(await this.view(id)), ready: true, executed: result.moved, applied: result };
    }
    const result = await this.exclusive(() => this.rebalance(signal, log));
    return { ...(await this.view(id)), ready: result.failed === 0, executed: true, rebalance: result };
  }

  /**
   * 入口 / Entry: StorageTiering.close.
   * 功能：在保存热冷存储策略并迁移实例中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`StorageTiering`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `StorageTiering`; the outcome is recorded in `this.closed`. Module context: Stores hot/cold policies and migrates VMs between distinct explicit pools under background scheduling.
   * 处理：通过 `this.controller.abort`, `this.scheduled.close`, `this.active.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.controller.abort`, `this.scheduled.close`, `this.active.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.controller.abort`; `this.scheduled.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.controller?.abort();
    await this.scheduled?.close();
    await this.active?.catch(() => {});
  }
}

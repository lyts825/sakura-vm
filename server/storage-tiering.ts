import { join } from 'node:path';
import { z } from 'zod';
import type { Machines } from './machines.ts';
import { AppError, DATA, type VMRecord } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const poolId = z.string().regex(/^(default|[a-f0-9]{16})$/);
export const tieringPolicy = z.object({
  enabled: z.boolean(),
  hotPoolId: poolId,
  coldPoolId: poolId,
  idleHours: z.number().int().min(1).max(24 * 365),
  intervalHours: z.number().int().min(1).max(24),
}).strict().refine((value) => value.hotPoolId !== value.coldPoolId,
  '热池与冷池必须不同');
export const tieringInput = z.object({
  mode: z.enum(['status', 'save', 'apply', 'rebalance']).default('status'),
  enabled: z.boolean().optional(),
  hotPoolId: poolId.optional(),
  coldPoolId: poolId.optional(),
  idleHours: z.number().int().min(1).max(24 * 365).optional(),
  intervalHours: z.number().int().min(1).max(24).optional(),
}).strict();
type Policy = z.infer<typeof tieringPolicy>;
const historyEntry = z.object({
  vmId: z.uuid(), name: z.string(), from: poolId, to: poolId,
  at: z.iso.datetime(), status: z.enum(['moved', 'failed']),
  error: z.string().max(500).optional(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1), policy: tieringPolicy.optional(),
  lastRunAt: z.iso.datetime().optional(),
  history: z.array(historyEntry).max(100).default([]),
}).strict();
type Store = z.infer<typeof storeSchema>;
type PoolView = Awaited<ReturnType<Machines['storagePools']['view']>>['pools'][number];

export class StorageTiering {
  private state?: Store;
  private loading?: Promise<Store>;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<unknown>;
  private controller?: AbortController;
  private closed = false;
  private lastError?: string;
  constructor(private machines: Machines, private file = join(DATA, 'storage-tiering.json')) {}

  private async load() {
    if (!this.loading) this.loading = readStore(this.file,
      () => ({ version: 1 as const, history: [] }))
      .then((value) => storeSchema.parse(value));
    return (this.state ||= await this.loading);
  }

  async init() {
    const state = await this.load();
    this.schedule();
    if (state.policy?.enabled && (!state.lastRunAt ||
        Date.now() - Date.parse(state.lastRunAt) >= state.policy.intervalHours * 3_600_000))
      queueMicrotask(() => void this.tick().catch(() => {}));
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    const policy = this.state?.policy;
    if (!this.closed && policy?.enabled) {
      this.timer = setInterval(() => void this.tick().catch(() => {}),
        policy.intervalHours * 3_600_000);
      this.timer.unref();
    }
  }

  private async change(edit: (state: Store) => void) {
    const next = structuredClone(await this.load());
    edit(next);
    await writeStore(this.file, next);
    this.state = next;
    return next;
  }

  private decide(vm: VMRecord, policy: Policy | undefined, pools: PoolView[], at = Date.now()) {
    const currentPoolId = vm.storagePoolId || 'default';
    const lastUsedAt = vm.lastUsedAt || vm.createdAt;
    const used = Date.parse(lastUsedAt);
    const targetPoolId = policy && Number.isFinite(used)
      ? at - used >= policy.idleHours * 3_600_000 ? policy.coldPoolId : policy.hotPoolId
      : null;
    const target = pools.find((pool) => pool.id === targetPoolId);
    const source = pools.find((pool) => pool.id === currentPoolId);
    let reason = '';
    if (!policy) reason = '尚未保存热/冷池策略';
    else if (vm.sandbox || vm.rescueOf) reason = '临时沙箱或救援实例不参与分层';
    else if (this.machines.live.has(vm.id)) reason = '实例仍在运行';
    else if (this.machines.storagePools.hasPendingCleanup(vm.id))
      reason = '此前迁移的旧副本尚待清理';
    else if (!targetPoolId) reason = '最近使用时间无效';
    else if (currentPoolId === targetPoolId) reason = '实例已位于目标池';
    else if (!target?.available) reason = '目标存储池不可用';
    else if (target.freeBytes !== null && source &&
        target.freeBytes < (source.vms.find((item) => item.id === vm.id)?.diskBytes || 0) +
          64 * 1024 ** 2) reason = '目标存储池可用容量不足';
    return { vmId: vm.id, name: vm.name, currentPoolId, targetPoolId,
      lastUsedAt, ready: !reason, reason };
  }

  async view(id?: string) {
    const state = await this.load();
    const pools = (await this.machines.storagePools.view()).pools;
    const candidates = [...this.machines.records.values()]
      .map((vm) => this.decide(vm, state.policy, pools));
    return { policy: state.policy || null, lastRunAt: state.lastRunAt || null,
      lastError: this.lastError || null,
      history: state.history.slice(-40).reverse(),
      current: id ? candidates.find((item) => item.vmId === id) || null : null,
      candidates, pools: pools.map((pool) => ({ id: pool.id, name: pool.name,
        available: pool.available, freeBytes: pool.freeBytes })),
      running: !!this.active };
  }

  private async apply(id: string, signal?: AbortSignal, log: (text: string) => void = () => {}) {
    const policy = (await this.load()).policy;
    const pools = (await this.machines.storagePools.view()).pools;
    const decision = this.decide(this.machines.get(id), policy, pools);
    if (!decision.targetPoolId) throw new AppError(decision.reason, 409);
    if (!decision.ready) {
      if (decision.currentPoolId === decision.targetPoolId)
        return { ...decision, moved: false };
      throw new AppError(decision.reason, 409);
    }
    const moved = await this.machines.moveStoragePool(id, decision.targetPoolId, signal, log);
    return { ...decision, moved: moved.moved, cleanupPending: moved.cleanupPending };
  }

  private async rebalance(signal?: AbortSignal, log: (text: string) => void = () => {}) {
    const state = await this.load();
    if (!state.policy) throw new AppError('请先保存热/冷池策略', 409);
    const candidates = (await this.view()).candidates.filter((item) => item.ready);
    const entries: z.infer<typeof historyEntry>[] = [];
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      const from = candidate.currentPoolId, to = candidate.targetPoolId!;
      try {
        const result = await this.apply(candidate.vmId, signal, log);
        if (result.moved) entries.push({ vmId: candidate.vmId, name: candidate.name,
          from, to, at: new Date().toISOString(), status: 'moved' });
      } catch (error) {
        if (signal?.aborted) throw error;
        const message = String((error as Error).message || error).slice(0, 500);
        entries.push({ vmId: candidate.vmId, name: candidate.name, from, to,
          at: new Date().toISOString(), status: 'failed', error: message });
        log(`${candidate.name}：${message}\n`);
      }
    }
    await this.change((next) => {
      next.lastRunAt = new Date().toISOString();
      next.history = [...next.history, ...entries].slice(-100);
    });
    return { moved: entries.filter((item) => item.status === 'moved').length,
      failed: entries.filter((item) => item.status === 'failed').length, entries };
  }

  private async exclusive<T>(work: () => Promise<T>, controller?: AbortController) {
    if (this.active) throw new AppError('分层迁移正在执行', 409);
    const operation = work();
    this.active = operation;
    this.controller = controller;
    try { return await operation; }
    finally {
      this.active = undefined;
      this.controller = undefined;
    }
  }

  async tick() {
    if (this.closed || this.active || !(await this.load()).policy?.enabled) return;
    const controller = new AbortController();
    try {
      await this.exclusive(() => this.rebalance(controller.signal), controller);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = String((error as Error).message || error).slice(0, 500);
      throw error;
    }
  }

  async run(id: string, input: unknown, action: 'check' | 'run', signal?: AbortSignal,
    log: (text: string) => void = () => {}) {
    this.machines.get(id);
    const value = tieringInput.parse(input);
    if (action === 'check' || value.mode === 'status')
      return { ...(await this.view(id)), ready: true, executed: false };
    if (value.mode === 'save') {
      const policy = tieringPolicy.parse({ enabled: value.enabled,
        hotPoolId: value.hotPoolId, coldPoolId: value.coldPoolId,
        idleHours: value.idleHours, intervalHours: value.intervalHours });
      await this.machines.storagePools.ensure(policy.hotPoolId);
      await this.machines.storagePools.ensure(policy.coldPoolId);
      if (this.active) throw new AppError('分层迁移正在执行，请稍后修改策略', 409);
      await this.change((state) => { state.policy = policy; });
      this.schedule();
      return { ...(await this.view(id)), ready: true, executed: true };
    }
    if (value.mode === 'apply') {
      const result = await this.exclusive(async () => {
        const applied = await this.apply(id, signal, log);
        let warning: string | undefined;
        if (applied.moved) try {
          await this.change((state) => {
            state.history = [...state.history, { vmId: id, name: applied.name,
              from: applied.currentPoolId, to: applied.targetPoolId!,
              at: new Date().toISOString(), status: 'moved' as const }].slice(-100);
          });
        } catch (error) {
          warning = `迁移已完成，但记录分层历史失败：${String((error as Error).message || error)}`;
          log(`${warning}\n`);
        }
        return { ...applied, ...(warning ? { warning } : {}) };
      });
      return { ...(await this.view(id)), ready: true, executed: result.moved,
        applied: result };
    }
    const result = await this.exclusive(() => this.rebalance(signal, log));
    return { ...(await this.view(id)), ready: result.failed === 0,
      executed: true, rebalance: result };
  }

  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
    await this.active?.catch(() => {});
  }
}

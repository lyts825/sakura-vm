import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

export const haWitnessPlanSchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(), targetHostId: z.uuid(),
  transferId: z.uuid(), remoteVmId: z.uuid(), snapshotId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  snapshotAt: z.iso.datetime(), maxReplicaAgeMinutes: z.number().int().min(1).max(10080),
}).strict();
export type HaWitnessPlan = z.infer<typeof haWitnessPlanSchema>;
export const haWitnessHeartbeatSchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(),
  failureThreshold: z.number().int().min(2).max(10),
  // Omission refreshes liveness without withdrawing the last verified plan.
  plan: haWitnessPlanSchema.nullable().optional(),
}).strict();
export type HaWitnessHeartbeat = z.infer<typeof haWitnessHeartbeatSchema>;
export const haWitnessIdentitySchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(),
}).strict();
export type HaWitnessIdentity = z.infer<typeof haWitnessIdentitySchema>;

const entrySchema = z.object({
  phase: z.enum(['source', 'fencing', 'fenced', 'promoted']),
  plan: haWitnessPlanSchema.nullable(),
  lastHeartbeatAt: z.number().int().nonnegative(),
  fencedAt: z.number().int().nonnegative().optional(),
  promotedAt: z.number().int().nonnegative().optional(),
  error: z.string().max(500).optional(),
}).strict();
type Entry = z.infer<typeof entrySchema>;
const bindingSchema = haWitnessIdentitySchema.safeExtend({
  targetHostId: z.uuid(), failureThreshold: z.number().int().min(2).max(10),
});
const storeSchema = z.object({
  version: z.literal(2),
  bindings: z.record(z.uuid(), bindingSchema),
  entries: z.record(z.uuid(), entrySchema),
}).strict();
type Store = z.infer<typeof storeSchema>;
export type HaWitnessVm = HaWitnessIdentity & { targetHostId: string;
  failureThreshold: number };
export type HaWitnessActions = {
  /** Must return only after an out-of-band power controller confirms Off. */
  fence: (vm: HaWitnessVm) => Promise<void>;
  /** Target inspection must validate the exact imported snapshot identity. */
  targetStatus: (vm: HaWitnessVm, plan: HaWitnessPlan) =>
    Promise<'stopped' | 'starting' | 'running'>;
  activate: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  /** Application readiness and traffic routing are independent of VM boot. */
  applicationReady: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<boolean>;
  switchTraffic: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  trafficTarget: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<string>;
  retire: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
};

/** Durable authority with serialized state writes and independent external work per VM. */
export class HaWitness {
  private state: Store = { version: 2, bindings: {}, entries: {} };
  private work = Promise.resolve();
  private known = new Map<string, HaWitnessVm>();
  private vmWork = new Map<string, Promise<unknown>>();

  constructor(private file: string, vms: HaWitnessVm[],
    private actions: HaWitnessActions, private now = () => Date.now()) {
    for (const vm of vms) {
      bindingSchema.parse(this.binding(vm));
      if (this.known.has(vm.sourceVmId))
        throw new AppError('见证实例配置无效');
      this.known.set(vm.sourceVmId, vm);
    }
  }

  private binding(vm: HaWitnessVm) {
    return { sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId,
      targetHostId: vm.targetHostId, failureThreshold: vm.failureThreshold };
  }

  static async initialize(file: string, vms: HaWitnessVm[]) {
    if (new Set(vms.map((vm) => vm.sourceVmId)).size !== vms.length)
      throw new AppError('见证实例 ID 重复', 409);
    const entries = Object.fromEntries(vms.map((vm) => [vm.sourceVmId,
      { phase: 'source', plan: null, lastHeartbeatAt: 0 }]));
    const bindings = Object.fromEntries(vms.map((vm) => [vm.sourceVmId,
      bindingSchema.parse({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId,
        targetHostId: vm.targetHostId, failureThreshold: vm.failureThreshold })]));
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(file, JSON.stringify(storeSchema.parse({ version: 2, bindings, entries }),
        null, 2), { flag: 'wx', mode: 0o600, flush: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new AppError('见证状态文件已存在，不能重新初始化', 409);
      throw error;
    }
  }

  async init() {
    const loaded = await readStore(this.file, () => null);
    if (!loaded)
      throw new AppError('见证状态文件缺失；为避免双主启动，须人工核对后初始化',
        503, 'HA_WITNESS_STATE_MISSING');
    const state = storeSchema.safeParse(loaded);
    if (!state.success)
      throw new AppError('见证状态版本或内容无效；须人工核对来源与目标后恢复',
        503, 'HA_WITNESS_STATE_MISMATCH');
    const configured = [...this.known.keys()].sort();
    if (JSON.stringify(configured) !== JSON.stringify(Object.keys(state.data.bindings).sort()) ||
        JSON.stringify(configured) !== JSON.stringify(Object.keys(state.data.entries).sort()) ||
        configured.some((id) => {
          const saved = state.data.bindings[id], current = this.binding(this.known.get(id)!);
          return !saved || Object.keys(current).some((key) =>
            saved[key as keyof typeof saved] !== current[key as keyof typeof current]);
        }))
      throw new AppError('见证实例配置与持久登记不一致；须人工核对后恢复',
        503, 'HA_WITNESS_STATE_MISMATCH');
    this.state = state.data;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const current = this.work.catch(() => {}).then(task);
    this.work = current.then(() => {}, () => {});
    return current;
  }

  private runVm<T>(id: string, task: () => Promise<T>, skipBusy = false): Promise<T | undefined> {
    const previous = this.vmWork.get(id);
    if (previous && skipBusy) return Promise.resolve(undefined);
    const current = (previous || Promise.resolve()).catch(() => {}).then(task);
    this.vmWork.set(id, current);
    const finished = () => {
      if (this.vmWork.get(id) === current) this.vmWork.delete(id);
    };
    void current.then(finished, finished);
    return current;
  }

  private vm(raw: HaWitnessIdentity) {
    const identity = haWitnessIdentitySchema.parse(raw);
    const vm = this.known.get(identity.sourceVmId);
    if (!vm || vm.sourceHostId !== identity.sourceHostId)
      throw new AppError('未登记此来源实例', 404);
    return vm;
  }

  private entry(id: string): Entry {
    const entry = this.state.entries[id];
    if (!entry) throw new AppError('见证状态缺少已登记实例',
      503, 'HA_WITNESS_STATE_MISMATCH');
    return entry;
  }

  private async save(id: string, entry: Entry) {
    const next = storeSchema.parse({ ...this.state,
      entries: { ...this.state.entries, [id]: entrySchema.parse(entry) } });
    await writeStore(this.file, next);
    this.state = next;
  }

  heartbeat(raw: unknown) {
    return this.enqueue(async () => {
      const input = haWitnessHeartbeatSchema.parse(raw), vm = this.vm({
        sourceHostId: input.sourceHostId, sourceVmId: input.sourceVmId,
      });
      if (input.failureThreshold !== vm.failureThreshold)
        throw new AppError('见证节点与来源的故障阈值配置不一致', 409);
      const entry = this.entry(vm.sourceVmId);
      if (entry.phase !== 'source')
        throw new AppError('来源已进入隔离或接管流程，不能重新登记运行心跳',
          409, 'HA_WITNESS_FENCED');
      const candidate = input.plan === undefined ? entry.plan : input.plan;
      if (candidate && (candidate.sourceHostId !== vm.sourceHostId ||
          candidate.sourceVmId !== vm.sourceVmId ||
          candidate.targetHostId !== vm.targetHostId))
        throw new AppError('见证副本身份与预配置不一致', 409);
      const at = this.now();
      const plan = candidate && Date.parse(candidate.snapshotAt) <= at &&
        at - Date.parse(candidate.snapshotAt) <= candidate.maxReplicaAgeMinutes * 60_000
        ? candidate : null;
      await this.save(vm.sourceVmId, { phase: 'source', plan,
        lastHeartbeatAt: at });
      return { armed: !!plan, phase: 'source' as const };
    });
  }

  authorizeStart(raw: unknown) {
    return this.enqueue(async () => {
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      if (entry.phase !== 'source')
        throw new AppError('见证节点已隔离来源，不能启动', 409, 'HA_WITNESS_FENCED');
      return { allowed: true as const, phase: entry.phase };
    });
  }

  status(raw: unknown) {
    return this.enqueue(async () => {
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      return { phase: entry.phase, armed: !!entry.plan,
        targetHostId: vm.targetHostId, failureThreshold: vm.failureThreshold,
        lastHeartbeatAt: entry.lastHeartbeatAt,
        fencedAt: entry.fencedAt || null, promotedAt: entry.promotedAt || null,
        targetVmId: entry.plan?.remoteVmId || null, error: entry.error || null };
    });
  }

  /** Local, read-only deployment inspection; never exposed through the witness HTTP API. */
  deploymentState(raw: unknown) {
    return this.enqueue(async () => {
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      return { phase: entry.phase, plan: entry.plan ? { ...entry.plan } : null };
    });
  }

  /** Let a witness process finish fencing and durable writes before it exits. */
  async drain() {
    await Promise.allSettled([...this.vmWork.values()]);
    await this.work;
  }

  sample() {
    return Promise.all([...this.known.values()].map((vm) =>
      this.runVm(vm.sourceVmId, () => this.sampleVm(vm), true)));
  }

  private async sampleVm(vm: HaWitnessVm) {
    let entry = await this.enqueue(async () => {
      const current = this.entry(vm.sourceVmId);
      if (!current.plan || current.phase === 'promoted') return null;
      if (current.phase !== 'source') return current;
      if (this.now() - current.lastHeartbeatAt < vm.failureThreshold * 15_000)
        return null;
      // A stale snapshot is not a failover candidate. Keep the source eligible.
      if (this.now() - Date.parse(current.plan.snapshotAt) >
          current.plan.maxReplicaAgeMinutes * 60_000) {
        await this.save(vm.sourceVmId, { ...current, plan: null,
          error: '副本已超过配置的数据时效上限' });
        return null;
      }
      const fencing = { ...current, phase: 'fencing' as const, error: undefined };
      await this.save(vm.sourceVmId, fencing);
      return fencing;
    });
    if (!entry?.plan) return;
    const plan = entry.plan;
    try {
      if (entry.phase === 'fencing') {
        await this.actions.fence(vm);
        entry = await this.enqueue(async () => {
          const current = this.entry(vm.sourceVmId);
          if (current.phase !== 'fencing' || current.plan?.transferId !== plan.transferId)
            throw new AppError('隔离期间见证计划发生变化', 503);
          const fenced = { ...current, phase: 'fenced' as const,
            fencedAt: this.now(), error: undefined };
          await this.save(vm.sourceVmId, fenced);
          return fenced;
        });
      }
      if (entry.phase !== 'fenced') return;
      const target = await this.actions.targetStatus(vm, plan);
      if (target === 'stopped') await this.actions.activate(vm, plan);
      else if (target !== 'starting' && target !== 'running')
        throw new AppError(`目标副本处于 ${target}，不能接管`, 409);
      if (await this.actions.targetStatus(vm, plan) !== 'running') return;
      if (!await this.actions.applicationReady(vm, plan)) return;
      await this.actions.switchTraffic(vm, plan);
      if (await this.actions.trafficTarget(vm, plan) !== plan.remoteVmId)
        throw new AppError('流量入口没有确认目标实例', 409);
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.phase !== 'fenced' || current.plan?.transferId !== plan.transferId)
          throw new AppError('切流期间见证计划发生变化', 503);
        await this.save(vm.sourceVmId, { ...current, phase: 'promoted',
          promotedAt: this.now(), error: undefined });
      });
    } catch (error) {
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.phase === 'fencing' || current.phase === 'fenced')
          await this.save(vm.sourceVmId, { ...current,
            error: (error as Error).message.slice(0, 500) });
      });
    }
  }

  async rejoin(raw: unknown) {
    const input = haWitnessIdentitySchema.safeExtend({
      dataReconciled: z.literal(true),
    }).parse(raw);
    const vm = this.vm({ sourceHostId: input.sourceHostId,
      sourceVmId: input.sourceVmId });
    return this.runVm(vm.sourceVmId, async () => {
      const entry = await this.enqueue(async () => this.entry(vm.sourceVmId));
      if (entry.phase !== 'promoted' || !entry.plan)
        throw new AppError('见证节点没有已完成的目标接管', 409);
      // Retire is idempotent and refuses a running target. A lost response is retried.
      await this.actions.retire(vm, entry.plan);
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.phase !== 'promoted' ||
            current.plan?.transferId !== entry.plan?.transferId)
          throw new AppError('退出接管期间见证计划发生变化', 503);
        await this.save(vm.sourceVmId, { phase: 'source', plan: null,
          lastHeartbeatAt: 0 });
      });
      return { released: true as const, retiredRemoteVmId: entry.plan.remoteVmId };
    });
  }
}

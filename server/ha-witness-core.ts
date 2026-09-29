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

/** Serialized, durable authority for one source VM. Network failures never grant a start. */
export class HaWitness {
  private state: Store = { version: 2, bindings: {}, entries: {} };
  private work = Promise.resolve();
  private known = new Map<string, HaWitnessVm>();

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

  sample() {
    return this.enqueue(async () => {
      for (const vm of this.known.values()) {
        let entry = this.entry(vm.sourceVmId);
        if (!entry.plan || entry.phase === 'promoted') continue;
        if (entry.phase === 'source') {
          if (this.now() - entry.lastHeartbeatAt < vm.failureThreshold * 15_000)
            continue;
          // A stale snapshot is not a failover candidate. Keep the source eligible.
          if (this.now() - Date.parse(entry.plan.snapshotAt) >
              entry.plan.maxReplicaAgeMinutes * 60_000) {
            await this.save(vm.sourceVmId, { ...entry, plan: null,
              error: '副本已超过配置的数据时效上限' });
            continue;
          }
          entry = { ...entry, phase: 'fencing', error: undefined };
          await this.save(vm.sourceVmId, entry);
        }
        if (!entry.plan) continue;
        const plan = entry.plan;
        try {
          if (entry.phase === 'fencing') {
            await this.actions.fence(vm);
            entry = { ...entry, phase: 'fenced', fencedAt: this.now(), error: undefined };
            await this.save(vm.sourceVmId, entry);
          }
          if (entry.phase !== 'fenced') continue;
          const target = await this.actions.targetStatus(vm, plan);
          if (target === 'stopped') await this.actions.activate(vm, plan);
          else if (target !== 'starting' && target !== 'running')
            throw new AppError(`目标副本处于 ${target}，不能接管`, 409);
          if (await this.actions.targetStatus(vm, plan) !== 'running') continue;
          if (!await this.actions.applicationReady(vm, plan)) continue;
          await this.actions.switchTraffic(vm, plan);
          if (await this.actions.trafficTarget(vm, plan) !== plan.remoteVmId)
            throw new AppError('流量入口没有确认目标实例', 409);
          await this.save(vm.sourceVmId, { ...entry, phase: 'promoted',
            promotedAt: this.now(), error: undefined });
        } catch (error) {
          await this.save(vm.sourceVmId, { ...entry,
            error: (error as Error).message.slice(0, 500) });
        }
      }
    });
  }

  rejoin(raw: unknown) {
    return this.enqueue(async () => {
      const input = haWitnessIdentitySchema.safeExtend({
        dataReconciled: z.literal(true),
      }).parse(raw);
      const vm = this.vm({ sourceHostId: input.sourceHostId,
        sourceVmId: input.sourceVmId });
      const entry = this.entry(vm.sourceVmId);
      if (entry.phase !== 'promoted' || !entry.plan)
        throw new AppError('见证节点没有已完成的目标接管', 409);
      // Retire is idempotent and refuses a running target. A lost response is retried.
      await this.actions.retire(vm, entry.plan);
      await this.save(vm.sourceVmId, { phase: 'source', plan: null,
        lastHeartbeatAt: 0 });
      return { released: true as const, retiredRemoteVmId: entry.plan.remoteVmId };
    });
  }
}

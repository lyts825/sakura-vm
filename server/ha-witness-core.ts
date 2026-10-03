import { z } from 'zod';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

export const haWitnessReplicaIdentitySchema = z.object({
  sourceHostId: z.uuid(), sourceVmId: z.uuid(), targetHostId: z.uuid(),
  transferId: z.uuid(), remoteVmId: z.uuid(), snapshotId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HaWitnessReplicaIdentity = z.infer<typeof haWitnessReplicaIdentitySchema>;
export const haWitnessPlanSchema = haWitnessReplicaIdentitySchema.safeExtend({
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
const retirementSchema = haWitnessReplicaIdentitySchema.safeExtend({ retiredAt: z.iso.datetime() });
export const haWitnessReplicaInventorySchema = z.object({
  version: z.literal(1), hostId: z.uuid(), sourceHostId: z.uuid(), sourceVmId: z.uuid(),
  complete: z.literal(true),
  replicas: z.array(z.object({ identity: haWitnessReplicaIdentitySchema,
    status: z.enum(['stopped', 'starting', 'running', 'paused', 'stopping', 'error']),
    retirement: retirementSchema.nullable(),
  }).strict()).max(1024),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>(), transfers = new Set<string>();
  for (const replica of value.replicas) {
    const identity = replica.identity;
    if (identity.sourceHostId !== value.sourceHostId || identity.sourceVmId !== value.sourceVmId ||
        identity.targetHostId !== value.hostId || ids.has(identity.remoteVmId) ||
        transfers.has(identity.transferId) || (replica.retirement &&
          Object.entries(identity).some(([key, expected]) =>
            replica.retirement![key as keyof typeof identity] !== expected)))
      context.addIssue({ code: 'custom', message: '副本清单身份、退役回执或完整性不一致' });
    ids.add(identity.remoteVmId); transfers.add(identity.transferId);
  }
});
export type HaWitnessReplicaInventory = z.infer<typeof haWitnessReplicaInventorySchema>;

const entrySchema = z.object({
  phase: z.enum(['source', 'fencing', 'fenced', 'promoted']),
  plan: haWitnessPlanSchema.nullable(),
  lastHeartbeatAt: z.number().int().nonnegative(),
  fencedAt: z.number().int().nonnegative().optional(),
  promotedAt: z.number().int().nonnegative().optional(),
  retiredRemoteVmId: z.uuid().optional(),
  // Keep the complete retirement identity until source health and routing are
  // confirmed. A reboot or a lost routing response must not lose this work.
  failback: z.object({
    plan: z.union([haWitnessPlanSchema, haWitnessReplicaIdentitySchema]),
    phase: z.enum(['pending', 'completed']),
    requestedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  recoveryHold: z.object({ restoredAt: z.number().int().nonnegative(),
    backupSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  recoveryReceipt: z.object({ releasedAt: z.number().int().nonnegative(),
    replicas: z.array(retirementSchema).max(1024) }).strict().optional(),
  error: z.string().max(500).optional(),
}).strict();
type Entry = z.infer<typeof entrySchema>;
const bindingFieldsSchema = haWitnessIdentitySchema.safeExtend({
  targetHostId: z.uuid(), failureThreshold: z.number().int().min(2).max(10),
  sourceSystemUuid: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).optional(),
  failbackBinding: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
const bindingSchema = bindingFieldsSchema.refine((vm) => vm.sourceHostId !== vm.targetHostId,
  '来源宿主与目标宿主必须不同');
export const haWitnessStoreSchema = z.object({
  version: z.literal(4),
  bindings: z.record(z.uuid(), bindingSchema),
  entries: z.record(z.uuid(), entrySchema),
}).strict();
export const haWitnessLegacyStoreSchema = z.object({
  version: z.union([z.literal(2), z.literal(3)]),
  bindings: z.record(z.uuid(), bindingFieldsSchema.omit({ failbackBinding: true })
    .refine((vm) => vm.sourceHostId !== vm.targetHostId, '来源宿主与目标宿主必须不同')),
  entries: z.record(z.uuid(), entrySchema.omit({ failback: true,
    recoveryHold: true, recoveryReceipt: true })),
}).strict();
const storeSchema = haWitnessStoreSchema;
export type HaWitnessStore = z.infer<typeof haWitnessStoreSchema>;
type Store = HaWitnessStore;
export type HaWitnessVm = HaWitnessIdentity & { targetHostId: string;
  failureThreshold: number; sourceSystemUuid?: string; failbackBinding?: string };

export function haWitnessBinding(vm: HaWitnessVm) {
  return bindingSchema.parse({ sourceHostId: vm.sourceHostId,
    sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId,
    failureThreshold: vm.failureThreshold,
    ...(vm.sourceSystemUuid ? { sourceSystemUuid: vm.sourceSystemUuid.toLowerCase() } : {}),
    ...(vm.failbackBinding ? { failbackBinding: vm.failbackBinding } : {}) });
}
const binding = haWitnessBinding;

/** Validate authority without changing an unknown or interrupted phase. */
export function validateHaWitnessState(raw: unknown, vms: HaWitnessVm[], legacy = false) {
  const parsed = (legacy ? haWitnessLegacyStoreSchema : storeSchema).safeParse(raw);
  if (!parsed.success)
    throw new AppError('见证状态版本或内容无效；须人工核对来源与目标后恢复',
      503, 'HA_WITNESS_STATE_MISMATCH');
  const state = parsed.data;
  const known = new Map(vms.map((vm) => [vm.sourceVmId, vm]));
  const configured = [...known.keys()].sort();
  if (known.size !== vms.length ||
      JSON.stringify(configured) !== JSON.stringify(Object.keys(state.bindings).sort()) ||
      JSON.stringify(configured) !== JSON.stringify(Object.keys(state.entries).sort()) ||
      configured.some((id) => {
        const saved = state.bindings[id], current = binding(known.get(id)!);
        // Version 2 predates the hardware UUID binding. Only an explicit offline
        // migration may supply it, after authenticated Redfish verification.
        if (legacy) {
          delete current.failbackBinding;
          if (state.version === 2 && !saved.sourceSystemUuid) delete current.sourceSystemUuid;
        }
        return !saved || Object.keys(current).some((key) =>
          saved[key as keyof typeof saved] !== current[key as keyof typeof current]) ||
          Object.keys(saved).some((key) =>
            saved[key as keyof typeof saved] !== current[key as keyof typeof current]);
      }))
    throw new AppError('见证实例配置与持久登记不一致；须人工核对后恢复',
      503, 'HA_WITNESS_STATE_MISMATCH');
  for (const id of configured) {
    const vm = known.get(id)!, entry = state.entries[id] as Entry;
    const plans = [entry.plan, entry.failback?.plan,
      ...(entry.recoveryReceipt?.replicas || [])].filter(Boolean);
    const receipts = entry.recoveryReceipt?.replicas;
    if ((entry.phase !== 'source' && !entry.plan) ||
        plans.some((plan) => plan!.sourceHostId !== vm.sourceHostId ||
          plan!.sourceVmId !== vm.sourceVmId || plan!.targetHostId !== vm.targetHostId) ||
        (entry.retiredRemoteVmId && (entry.phase !== 'source' || entry.plan)) ||
        (entry.recoveryReceipt && (entry.phase !== 'source' || !!entry.plan)) ||
        (receipts && (new Set(receipts.map((item) => item.remoteVmId)).size !== receipts.length ||
          new Set(receipts.map((item) => item.transferId)).size !== receipts.length ||
          (entry.retiredRemoteVmId && !receipts.some((item) => item.remoteVmId === entry.retiredRemoteVmId)) ||
          (entry.failback && !receipts.some((item) => Object.keys(haWitnessReplicaIdentitySchema.shape)
            .every((key) => item[key as keyof HaWitnessReplicaIdentity] ===
              entry.failback!.plan[key as keyof HaWitnessReplicaIdentity]))))) ||
        (entry.failback && (entry.phase !== 'source' || !!entry.plan ||
          !vm.failbackBinding || entry.failback.plan.remoteVmId !== entry.retiredRemoteVmId ||
          (entry.failback.phase === 'pending' && entry.failback.completedAt !== undefined) ||
          (entry.failback.phase === 'completed' && entry.failback.completedAt === undefined))))
      throw new AppError('见证持久计划与实例登记不一致；须人工核对后恢复',
        503, 'HA_WITNESS_STATE_MISMATCH');
  }
  return state;
}
export type HaWitnessActions = {
  /** Must return only after an out-of-band power controller confirms Off. */
  fence: (vm: HaWitnessVm) => Promise<void>;
  /** Read-only recheck of both system identity and Off; a historical fence is insufficient. */
  confirmFence: (vm: HaWitnessVm) => Promise<void>;
  /** Target inspection must validate the exact imported snapshot identity. */
  targetStatus: (vm: HaWitnessVm, plan: HaWitnessPlan) =>
    Promise<'stopped' | 'starting' | 'running'>;
  activate: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  /** Application readiness and traffic routing are independent of VM boot. */
  applicationReady: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<boolean>;
  switchTraffic: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  trafficTarget: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<string>;
  retire: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<void>;
  sourceApplicationReady?: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<boolean>;
  restoreTraffic?: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<void>;
  inspectReplicas?: (vm: HaWitnessVm) => Promise<HaWitnessReplicaInventory>;
  recoveryTrafficTarget?: (vm: HaWitnessVm) => Promise<string>;
};

export async function syncHaWitnessDirectory(file: string) {
  if (process.platform !== 'linux') return;
  const directory = await open(dirname(file), 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}
const syncDirectory = syncHaWitnessDirectory;

export async function persistHaWitnessState(file: string, next: Store) {
  for (let attempt = 0; ; attempt++) {
    try { await writeStore(file, next); break; }
    catch (error) {
      // On Windows a concurrent read or security scanner can temporarily hold
      // a sharing lock against atomic replacement. Retry only these bounded
      // conflicts; never treat an unsuccessful write as an authority commit.
      if (process.platform !== 'win32' || attempt >= 5 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || ''))
        throw error;
      await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));
    }
  }
  await syncDirectory(file);
}
const persistState = persistHaWitnessState;

/** Durable authority with serialized state writes and independent external work per VM. */
export class HaWitness {
  private state: Store = { version: 4, bindings: {}, entries: {} };
  private work = Promise.resolve();
  private known = new Map<string, HaWitnessVm>();
  private vmWork = new Map<string, Promise<unknown>>();
  private storageUnavailable = false;

  constructor(private file: string, vms: HaWitnessVm[],
    private actions: HaWitnessActions, private now = () => Date.now()) {
    for (const vm of vms) {
      binding(vm);
      if (vm.failbackBinding && (!actions.sourceApplicationReady || !actions.restoreTraffic))
        throw new AppError('自动流量回切已登记，但回切接口不可用', 503);
      if (this.known.has(vm.sourceVmId))
        throw new AppError('见证实例配置无效');
      this.known.set(vm.sourceVmId, vm);
    }
  }

  static async initialize(file: string, vms: HaWitnessVm[]) {
    if (new Set(vms.map((vm) => vm.sourceVmId)).size !== vms.length)
      throw new AppError('见证实例 ID 重复', 409);
    const entries = Object.fromEntries(vms.map((vm) => [vm.sourceVmId,
      { phase: 'source', plan: null, lastHeartbeatAt: 0 }]));
    const bindings = Object.fromEntries(vms.map((vm) => [vm.sourceVmId, binding(vm)]));
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(file, JSON.stringify(storeSchema.parse({ version: 4, bindings, entries }),
        null, 2), { flag: 'wx', mode: 0o600, flush: true });
      await syncDirectory(file);
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
    this.state = validateHaWitnessState(loaded, [...this.known.values()]) as Store;
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
    try { await persistState(this.file, next); }
    catch (error) { this.storageUnavailable = true; throw error; }
    this.state = next;
  }

  private requireStorage() {
    if (this.storageUnavailable)
      throw new AppError('见证持久存储写入失败；须恢复存储并重启后核对状态',
        503, 'HA_WITNESS_STORAGE_UNAVAILABLE');
  }

  heartbeat(raw: unknown) {
    return this.enqueue(async () => {
      this.requireStorage();
      const input = haWitnessHeartbeatSchema.parse(raw), vm = this.vm({
        sourceHostId: input.sourceHostId, sourceVmId: input.sourceVmId,
      });
      if (input.failureThreshold !== vm.failureThreshold)
        throw new AppError('见证节点与来源的故障阈值配置不一致', 409);
      const entry = this.entry(vm.sourceVmId);
      if (entry.recoveryHold)
        throw new AppError('见证状态已恢复并保持封锁；须核对全部副本后受控退出',
          409, 'HA_WITNESS_RECOVERY_HOLD');
      if (entry.phase !== 'source')
        throw new AppError('来源已进入隔离或接管流程，不能重新登记运行心跳',
          409, 'HA_WITNESS_FENCED');
      const candidate = input.plan === undefined ? entry.plan : input.plan;
      if (candidate && entry.failback?.phase === 'pending')
        throw new AppError('来源流量回切尚未完成，不能布防新的接管计划', 409);
      if (candidate && (candidate.sourceHostId !== vm.sourceHostId ||
          candidate.sourceVmId !== vm.sourceVmId ||
          candidate.targetHostId !== vm.targetHostId))
        throw new AppError('见证副本身份与预配置不一致', 409);
      const at = this.now();
      const plan = candidate && Date.parse(candidate.snapshotAt) <= at &&
        at - Date.parse(candidate.snapshotAt) <= candidate.maxReplicaAgeMinutes * 60_000
        ? candidate : null;
      await this.save(vm.sourceVmId, { phase: 'source', plan,
        lastHeartbeatAt: at,
        ...(!plan && entry.retiredRemoteVmId ? { retiredRemoteVmId: entry.retiredRemoteVmId } : {}),
        ...(!plan && entry.failback ? { failback: entry.failback,
          ...(entry.error ? { error: entry.error } : {}) } : {}),
        ...(!plan && entry.recoveryReceipt ? { recoveryReceipt: entry.recoveryReceipt } : {}) });
      return { armed: !!plan, phase: 'source' as const,
        failback: !plan ? entry.failback?.phase || null : null };
    });
  }

  authorizeStart(raw: unknown) {
    return this.enqueue(async () => {
      this.requireStorage();
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      if (entry.phase !== 'source' || entry.recoveryHold)
        throw new AppError('见证节点已隔离来源，不能启动', 409, 'HA_WITNESS_FENCED');
      return { allowed: true as const, phase: entry.phase };
    });
  }

  status(raw: unknown) {
    return this.enqueue(async () => {
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      return { phase: entry.phase, armed: !!entry.plan && !entry.recoveryHold,
        targetHostId: vm.targetHostId, failureThreshold: vm.failureThreshold,
        lastHeartbeatAt: entry.lastHeartbeatAt,
        fencedAt: entry.fencedAt || null, promotedAt: entry.promotedAt || null,
        targetVmId: entry.plan?.remoteVmId || null, error: this.storageUnavailable
          ? '见证持久存储写入失败；须恢复存储并重启后核对状态'
          : entry.recoveryHold ? '见证状态处于恢复封锁；须核对全部历史副本后受控退出'
            : entry.error || null,
        failback: entry.failback ? { phase: entry.failback.phase,
          retiredVmId: entry.failback.plan.remoteVmId,
          requestedAt: entry.failback.requestedAt,
          completedAt: entry.failback.completedAt ?? null } : null,
        recoveryHeld: !!entry.recoveryHold,
        recoveredRetiredVmIds: entry.recoveryReceipt?.replicas.map((item) => item.remoteVmId) || [] };
    });
  }

  /** Local, read-only deployment inspection; never exposed through the witness HTTP API. */
  deploymentState(raw: unknown) {
    return this.enqueue(async () => {
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      return { phase: entry.phase, plan: entry.plan ? { ...entry.plan } : null,
        failback: entry.failback ? { ...entry.failback,
          plan: { ...entry.failback.plan } } : null,
        recoveryHeld: !!entry.recoveryHold };
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
    const transition = await this.enqueue(async () => {
      this.requireStorage();
      const entry = this.entry(vm.sourceVmId);
      return { held: !!entry.recoveryHold, returning: entry.failback?.phase === 'pending' };
    });
    if (transition.held) return;
    if (transition.returning) return this.sampleFailback(vm);
    let entry = await this.enqueue(async () => {
      this.requireStorage();
      const current = this.entry(vm.sourceVmId);
      if (!current.plan) return null;
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
      if (entry.phase !== 'fenced' && entry.phase !== 'promoted') return;
      await this.actions.confirmFence(vm);
      const target = await this.actions.targetStatus(vm, plan);
      if (target === 'stopped') await this.actions.activate(vm, plan);
      else if (target !== 'starting' && target !== 'running')
        throw new AppError(`目标副本处于 ${target}，不能接管`, 409);
      if (await this.actions.targetStatus(vm, plan) !== 'running')
        throw new AppError('目标副本仍在启动，保持来源隔离', 409);
      if (!await this.actions.applicationReady(vm, plan))
        throw new AppError('目标应用尚未通过健康检查，保持来源隔离', 409);
      await this.actions.confirmFence(vm);
      if (await this.actions.trafficTarget(vm, plan) !== plan.remoteVmId)
        await this.actions.switchTraffic(vm, plan);
      if (await this.actions.trafficTarget(vm, plan) !== plan.remoteVmId)
        throw new AppError('流量入口没有确认目标实例', 409);
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if ((current.phase !== 'fenced' && current.phase !== 'promoted') ||
            current.plan?.transferId !== plan.transferId)
          throw new AppError('切流期间见证计划发生变化', 503);
        if (current.phase === 'promoted' && !current.error) return;
        await this.save(vm.sourceVmId, { ...current, phase: 'promoted',
          promotedAt: current.promotedAt ?? this.now(), error: undefined });
      });
    } catch (error) {
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        const detail = (error instanceof Error ? error.message : '接管操作失败').slice(0, 500);
        if (current.error !== detail && (current.phase === 'fencing' ||
            current.phase === 'fenced' || current.phase === 'promoted'))
          await this.save(vm.sourceVmId, { ...current,
            error: detail });
      });
    }
  }

  private async sampleFailback(vm: HaWitnessVm) {
    const entry = await this.enqueue(async () => {
      this.requireStorage();
      return this.entry(vm.sourceVmId);
    });
    const returning = entry.failback;
    if (entry.phase !== 'source' || entry.recoveryHold || returning?.phase !== 'pending') return;
    try {
      if (!entry.lastHeartbeatAt ||
          this.now() - entry.lastHeartbeatAt >= vm.failureThreshold * 15_000)
        throw new AppError('等待来源恢复并续报存活心跳后回切流量', 409);
      // Reaffirm the complete retirement identity, including transfer/hash and
      // snapshot. A stopped target alone is insufficient to allow two writers.
      await this.actions.retire(vm, returning.plan);
      if (!await this.actions.sourceApplicationReady!(vm, returning.plan))
        throw new AppError('来源应用尚未通过健康检查，保持待回切状态', 409);
      const activeVmId = await this.actions.trafficTarget(vm, returning.plan);
      if (activeVmId !== vm.sourceVmId && activeVmId !== returning.plan.remoteVmId)
        throw new AppError('流量入口指向未知实例，拒绝覆盖现有路由', 409);
      if (activeVmId !== vm.sourceVmId)
        await this.actions.restoreTraffic!(vm, returning.plan);
      if (await this.actions.trafficTarget(vm, returning.plan) !== vm.sourceVmId)
        throw new AppError('流量入口没有确认来源实例，保持待回切状态', 409);
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.phase !== 'source' || current.plan ||
            current.failback?.phase !== 'pending' ||
            current.failback.plan.transferId !== returning.plan.transferId)
          throw new AppError('流量回切期间见证登记发生变化', 503);
        await this.save(vm.sourceVmId, { ...current, error: undefined,
          failback: { ...current.failback, phase: 'completed', completedAt: this.now() } });
      });
    } catch (error) {
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.failback?.phase === 'pending' &&
            current.failback.plan.transferId === returning.plan.transferId) {
          const detail = (error instanceof Error ? error.message : '流量回切失败').slice(0, 500);
          if (current.error !== detail) await this.save(vm.sourceVmId, { ...current, error: detail });
        }
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
      const entry = await this.enqueue(async () => {
        this.requireStorage();
        return this.entry(vm.sourceVmId);
      });
      if (entry.recoveryHold) return this.releaseRecovery(vm, entry);
      if (entry.phase === 'source' && !entry.plan && entry.recoveryReceipt)
        return { released: true as const, recovered: true as const,
          retiredVmIds: entry.recoveryReceipt.replicas.map((item) => item.remoteVmId),
          ...(entry.retiredRemoteVmId ? { retiredRemoteVmId: entry.retiredRemoteVmId } : {}),
          ...(entry.failback ? { failback: entry.failback.phase } : {}) };
      if (entry.phase === 'source' && !entry.plan && entry.retiredRemoteVmId)
        return { released: true as const, retiredRemoteVmId: entry.retiredRemoteVmId,
          ...(entry.failback ? { failback: entry.failback.phase } : {}) };
      if (entry.phase === 'source' || !entry.plan)
        throw new AppError('见证节点没有待退出的隔离或接管记录', 409);
      // Retire is idempotent and refuses a running target. A lost response is retried.
      await this.actions.retire(vm, entry.plan);
      await this.enqueue(async () => {
        const current = this.entry(vm.sourceVmId);
        if (current.phase !== entry.phase ||
            current.plan?.transferId !== entry.plan?.transferId)
          throw new AppError('退出接管期间见证计划发生变化', 503);
        await this.save(vm.sourceVmId, { phase: 'source', plan: null,
          lastHeartbeatAt: 0, retiredRemoteVmId: entry.plan!.remoteVmId,
          ...(vm.failbackBinding ? { failback: { plan: entry.plan!,
            phase: 'pending' as const, requestedAt: this.now() } } : {}) });
      });
      return { released: true as const, retiredRemoteVmId: entry.plan.remoteVmId,
        ...(vm.failbackBinding ? { failback: 'pending' as const } : {}) };
    });
  }

  private async releaseRecovery(vm: HaWitnessVm, entry: Entry) {
    if (!this.actions.inspectReplicas || !this.actions.recoveryTrafficTarget)
      throw new AppError('目标未提供完整副本清单，保持恢复封锁', 503);
    const inventory = async () => {
      const result = haWitnessReplicaInventorySchema.parse(await this.actions.inspectReplicas!(vm));
      if (result.hostId !== vm.targetHostId || result.sourceHostId !== vm.sourceHostId ||
          result.sourceVmId !== vm.sourceVmId)
        throw new AppError('完整副本清单的来源或目标身份不一致，保持恢复封锁', 409);
      return result;
    };
    const before = await inventory();
    const same = (left: HaWitnessReplicaIdentity, right: HaWitnessReplicaIdentity) =>
      Object.entries(haWitnessReplicaIdentitySchema.parse({ sourceHostId: left.sourceHostId,
        sourceVmId: left.sourceVmId, targetHostId: left.targetHostId,
        transferId: left.transferId, remoteVmId: left.remoteVmId,
        snapshotId: left.snapshotId, sha256: left.sha256 })).every(([key, value]) =>
        right[key as keyof HaWitnessReplicaIdentity] === value);
    const expected = [entry.plan, entry.failback?.plan,
      ...(entry.recoveryReceipt?.replicas || [])].filter(Boolean) as HaWitnessReplicaIdentity[];
    if (expected.some((identity) => !before.replicas.some((item) => same(identity, item.identity))) ||
        (entry.retiredRemoteVmId && !before.replicas.some((item) =>
          item.identity.remoteVmId === entry.retiredRemoteVmId && item.retirement)))
      throw new AppError('历史副本或完整退役证据缺失，保持恢复封锁', 409);
    if (before.replicas.some((item) => item.status !== 'stopped'))
      throw new AppError('所有历史故障副本须先停止，保持恢复封锁', 409);
    const readTraffic = async () => {
      const activeVmId = await this.actions.recoveryTrafficTarget!(vm);
      if (activeVmId !== vm.sourceVmId && !before.replicas.some((item) =>
        item.identity.remoteVmId === activeVmId))
        throw new AppError('流量入口指向未知实例，保持恢复封锁', 409);
      return activeVmId;
    };
    await readTraffic();
    for (const item of before.replicas) await this.actions.retire(vm, item.identity);
    const after = await inventory();
    if (after.replicas.length !== before.replicas.length ||
        after.replicas.some((item) => item.status !== 'stopped' || !item.retirement ||
          !before.replicas.some((previous) => same(item.identity, previous.identity))))
      throw new AppError('完整副本清单已变化或退役未确认，保持恢复封锁', 409);
    const activeVmId = await readTraffic();
    const primary = after.replicas.find((item) => item.identity.remoteVmId === activeVmId)?.identity;
    await this.enqueue(async () => {
      const current = this.entry(vm.sourceVmId);
      if (!current.recoveryHold || current.recoveryHold.backupSha256 !== entry.recoveryHold!.backupSha256)
        throw new AppError('恢复期间见证登记发生变化，保持封锁', 503);
      await this.save(vm.sourceVmId, { phase: 'source', plan: null, lastHeartbeatAt: 0,
        recoveryReceipt: { releasedAt: this.now(), replicas: after.replicas.map((item) => item.retirement!) },
        ...(primary ? { retiredRemoteVmId: primary.remoteVmId } : {}),
        ...(primary && vm.failbackBinding ? { failback: { plan: primary,
          phase: 'pending' as const, requestedAt: this.now() } } : {}) });
    });
    return { released: true as const, recovered: true as const,
      retiredVmIds: after.replicas.map((item) => item.identity.remoteVmId),
      ...(primary ? { retiredRemoteVmId: primary.remoteVmId } : {}),
      ...(primary && vm.failbackBinding ? { failback: 'pending' as const } : {}) };
  }
}

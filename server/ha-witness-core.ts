/**
 * 模块职责：维护见证节点的来源、目标与副本状态，依据隔离及退役证明协调接管。
 * Module purpose: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
 */
import { z } from 'zod';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { AppError } from '../shared/errors.ts';
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
/**
 * 入口 / Entry: callback@39.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（z.object().strict().superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (z.object().strict().superRefine).
 * 输入 / Inputs: value; context
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `context.addIssue`; `ids.add`; `transfers.add`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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

/**
 * 入口 / Entry: haWitnessBinding.
 * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `bindingSchema.parse({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThresho…` 供上层消费（`ha-witness-core.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-core.ts`; this entry produces `bindingSchema.parse({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThresho…` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
 * 处理：通过 `bindingSchema.parse`, `vm.sourceSystemUuid.toLowerCase` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `bindingSchema.parse`, `vm.sourceSystemUuid.toLowerCase`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: vm: HaWitnessVm
 * 输出 / Returns: `bindingSchema.parse({ sourceHostId: vm.sourceHostId, sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId, failureThresho…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function haWitnessBinding(vm: HaWitnessVm) {
  return bindingSchema.parse({ sourceHostId: vm.sourceHostId,
    sourceVmId: vm.sourceVmId, targetHostId: vm.targetHostId,
    failureThreshold: vm.failureThreshold,
    ...(vm.sourceSystemUuid ? { sourceSystemUuid: vm.sourceSystemUuid.toLowerCase() } : {}),
    ...(vm.failbackBinding ? { failbackBinding: vm.failbackBinding } : {}) });
}
const binding = haWitnessBinding;

/** Validate authority without changing an unknown or interrupted phase. */
/**
 * 入口 / Entry: validateHaWitnessState.
 * 功能：在维护见证节点的来源、目标与副本状态中，核对调用资格、输入或资源归属；本入口产生 `state` 供上层消费（`ha-witness-core.ts`）。
 * Purpose: Checks admission, input or resource ownership in `ha-witness-core.ts`; this entry produces `state` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
 * 处理：通过 `inline.safeParse`, `vms.map`, `inline.sort`, `known.keys` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.safeParse`, `vms.map`, `inline.sort`, `known.keys`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: raw: unknown; vms: HaWitnessVm[]; legacy: default=false
 * 输出 / Returns: `state`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 条件 / conditions `!parsed.success`; `known.size !== vms.length || JSON.stringify(configured) !== JSON.stringify(Object.keys(state.bindings).sort()) || JSON.string…`; `(entry.phase !== 'source' && !entry.plan) || plans.some((plan) => plan!.sourceHostId !== vm.sourceHostId || plan!.sourceVmId …`; 异常 / errors `new AppError('见证状态版本或内容无效；须人工核对来源与目标后恢复', 503, 'HA_WITNESS_STATE_MISMATCH')`; `new AppError('见证实例配置与持久登记不一致；须人工核对后恢复', 503, 'HA_WITNESS_STATE_MISMATCH')`.
 */
export function validateHaWitnessState(raw: unknown, vms: HaWitnessVm[], legacy = false) {
  const parsed = (legacy ? haWitnessLegacyStoreSchema : storeSchema).safeParse(raw);
  if (!parsed.success)
    throw new AppError('见证状态版本或内容无效；须人工核对来源与目标后恢复',
      503, 'HA_WITNESS_STATE_MISMATCH');
  const state = parsed.data;
  const known = new Map(vms.map((vm) => [vm.sourceVmId, vm]));
  const configured = [...known.keys()].sort();
  /**
   * 入口 / Entry: validateHaWitnessState.callback@122.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（configured.some）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (configured.some).
   * 输入 / Inputs: id
   * 输出 / Returns: `!saved || Object.keys(current).some((key) => saved[key as keyof typeof saved] !== current[key as keyof typeof current]) || Ob…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 签名 / Signature: HaWitnessActions.fence.
   * 功能：为维护见证节点的来源、目标与副本状态声明 fence 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for fence in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  fence: (vm: HaWitnessVm) => Promise<void>;
  /** Read-only recheck of both system identity and Off; a historical fence is insufficient. */
  /**
   * 签名 / Signature: HaWitnessActions.confirmFence.
   * 功能：为维护见证节点的来源、目标与副本状态声明 confirmFence 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for confirmFence in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  confirmFence: (vm: HaWitnessVm) => Promise<void>;
  /** Target inspection must validate the exact imported snapshot identity. */
  /**
   * 签名 / Signature: HaWitnessActions.targetStatus.
   * 功能：为维护见证节点的来源、目标与副本状态声明 targetStatus 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for targetStatus in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessPlan
   * 输出 / Returns: Promise<'stopped' | 'starting' | 'running'>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  targetStatus: (vm: HaWitnessVm, plan: HaWitnessPlan) =>
    Promise<'stopped' | 'starting' | 'running'>;
  /**
   * 签名 / Signature: HaWitnessActions.activate.
   * 功能：为维护见证节点的来源、目标与副本状态声明 activate 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for activate in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessPlan
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  activate: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  /** Application readiness and traffic routing are independent of VM boot. */
  /**
   * 签名 / Signature: HaWitnessActions.applicationReady.
   * 功能：为维护见证节点的来源、目标与副本状态声明 applicationReady 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for applicationReady in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessPlan
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  applicationReady: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<boolean>;
  /**
   * 签名 / Signature: HaWitnessActions.switchTraffic.
   * 功能：为维护见证节点的来源、目标与副本状态声明 switchTraffic 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for switchTraffic in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessPlan
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  switchTraffic: (vm: HaWitnessVm, plan: HaWitnessPlan) => Promise<void>;
  /**
   * 签名 / Signature: HaWitnessActions.trafficTarget.
   * 功能：为维护见证节点的来源、目标与副本状态声明 trafficTarget 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for trafficTarget in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessReplicaIdentity
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  trafficTarget: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<string>;
  /**
   * 签名 / Signature: HaWitnessActions.retire.
   * 功能：为维护见证节点的来源、目标与副本状态声明 retire 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for retire in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessReplicaIdentity
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  retire: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<void>;
  /**
   * 签名 / Signature: HaWitnessActions.sourceApplicationReady.
   * 功能：为维护见证节点的来源、目标与副本状态声明 sourceApplicationReady 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for sourceApplicationReady in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessReplicaIdentity
   * 输出 / Returns: Promise<boolean>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  sourceApplicationReady?: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<boolean>;
  /**
   * 签名 / Signature: HaWitnessActions.restoreTraffic.
   * 功能：为维护见证节点的来源、目标与副本状态声明 restoreTraffic 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for restoreTraffic in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm; plan: HaWitnessReplicaIdentity
   * 输出 / Returns: Promise<void>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  restoreTraffic?: (vm: HaWitnessVm, plan: HaWitnessReplicaIdentity) => Promise<void>;
  /**
   * 签名 / Signature: HaWitnessActions.inspectReplicas.
   * 功能：为维护见证节点的来源、目标与副本状态声明 inspectReplicas 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for inspectReplicas in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: Promise<HaWitnessReplicaInventory>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  inspectReplicas?: (vm: HaWitnessVm) => Promise<HaWitnessReplicaInventory>;
  /**
   * 签名 / Signature: HaWitnessActions.recoveryTrafficTarget.
   * 功能：为维护见证节点的来源、目标与副本状态声明 recoveryTrafficTarget 的输入与结果契约，所属容器为 HaWitnessActions。
   * Purpose: Declares the input/result contract for recoveryTrafficTarget in HaWitnessActions. Module responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: Promise<string>.
   * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
   * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
   */
  recoveryTrafficTarget?: (vm: HaWitnessVm) => Promise<string>;
};

/**
 * 入口 / Entry: syncHaWitnessDirectory.
 * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`ha-witness-core.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `ha-witness-core.ts`; this entry produces `void` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
 * 处理：通过 `open`, `dirname`, `directory.sync`, `directory.close` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `open`, `dirname`, `directory.sync`, `directory.close`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `process.platform !== 'linux'`.
 * 输入 / Inputs: file: string
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `directory.close`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `await directory.close();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `await directory.close();`; these steps also apply to exceptional exits.
 */
export async function syncHaWitnessDirectory(file: string) {
  if (process.platform !== 'linux') return;
  const directory = await open(dirname(file), 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}
const syncDirectory = syncHaWitnessDirectory;

/**
 * 入口 / Entry: persistHaWitnessState.
 * 功能：在维护见证节点的来源、目标与副本状态中，校验并提交领域状态变更；完成下述调用及状态处理（`ha-witness-core.ts`）。
 * Purpose: Validates and commits a domain state change in `ha-witness-core.ts`; the calls and state transitions below complete the operation. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
 * 处理：通过 `writeStore`, `inline.includes`, `syncDirectory` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `writeStore`, `inline.includes`, `syncDirectory`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: file: string; next: Store
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `writeStore`.
 * 拒绝 / Refusals: 条件 / conditions `process.platform !== 'win32' || attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code …`; 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (process.platform !== 'win32' || attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).c…`; `await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (process.platform !== 'win32' || attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).c…`; `await new Promise((done) => setTimeout(done, 25 * 2 ** attempt));`; these statements determine whether a failure is absorbed or rejected again.
 */
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

  /**
   * 入口 / Entry: HaWitness.constructor.
   * 功能：建立 HaWitness 的维护见证节点的来源、目标与副本状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the HaWitness context for this module's responsibility: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: string; vms: HaWitnessVm[]; actions: HaWitnessActions; now: default=() => Date.now()
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: `this.known.set`.
   * 拒绝 / Refusals: 条件 / conditions `vm.failbackBinding && (!actions.sourceApplicationReady || !actions.restoreTraffic)`; `this.known.has(vm.sourceVmId)`; 异常 / errors `new AppError('自动流量回切已登记，但回切接口不可用', 503)`; `new AppError('见证实例配置无效')`.
   */
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

  /**
   * 入口 / Entry: HaWitness.initialize.
   * 功能：在维护见证节点的来源、目标与副本状态中，初始化并核对当前领域状态；完成下述调用及状态处理（`HaWitness`）。
   * Purpose: Initializes and verifies current domain state in `HaWitness`; the calls and state transitions below complete the operation. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `vms.map`, `mkdir`, `dirname`, `writeFile` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `vms.map`, `mkdir`, `dirname`, `writeFile`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: file: string; vms: HaWitnessVm[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `mkdir`; `writeFile`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(vms.map((vm) => vm.sourceVmId)).size !== vms.length`; `(error as NodeJS.ErrnoException).code === 'EEXIST'`; 异常 / errors `new AppError('见证实例 ID 重复', 409)`; `new AppError('见证状态文件已存在，不能重新初始化', 409)`.
   * 失败处理：catch 分支执行 `if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('见证状态文件已存在，不能重新初始化', 409);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('见证状态文件已存在，不能重新初始化', 409);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
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

  /**
   * 入口 / Entry: HaWitness.init.
   * 功能：在维护见证节点的来源、目标与副本状态中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`HaWitness`）。
   * Purpose: Initializes and verifies current domain state in `HaWitness`; the outcome is recorded in `this.state`. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `readStore`, `validateHaWitnessState`, `this.known.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readStore`, `validateHaWitnessState`, `this.known.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `!loaded`; 异常 / errors `new AppError('见证状态文件缺失；为避免双主启动，须人工核对后初始化', 503, 'HA_WITNESS_STATE_MISSING')`.
   */
  async init() {
    const loaded = await readStore(this.file, () => null);
    if (!loaded)
      throw new AppError('见证状态文件缺失；为避免双主启动，须人工核对后初始化',
        503, 'HA_WITNESS_STATE_MISSING');
    this.state = validateHaWitnessState(loaded, [...this.known.values()]) as Store;
  }

  /**
   * 入口 / Entry: HaWitness.enqueue.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `current` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `current` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `this.work.catch().then`, `this.work.catch`, `current.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.work.catch().then`, `this.work.catch`, `current.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: task: () => Promise<T>
   * 输出 / Returns: Promise<T>；结果来自 / values from `current`.
   * 副作用 / Effects: 更新 / updates `this.work`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const current = this.work.catch(() => {}).then(task);
    this.work = current.then(() => {}, () => {});
    return current;
  }

  /**
   * 入口 / Entry: HaWitness.runVm.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.resolve(undefined)` / `current` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `Promise.resolve(undefined)` / `current` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `this.vmWork.get`, `Promise.resolve`, `inline.catch().then`, `inline.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.vmWork.get`, `Promise.resolve`, `inline.catch().then`, `inline.catch`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `previous && skipBusy`.
   * 输入 / Inputs: id: string; task: () => Promise<T>; skipBusy: default=false
   * 输出 / Returns: Promise<T | undefined>；结果来自 / values from `Promise.resolve(undefined)`; `current`.
   * 副作用 / Effects: `this.vmWork.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private runVm<T>(id: string, task: () => Promise<T>, skipBusy = false): Promise<T | undefined> {
    const previous = this.vmWork.get(id);
    if (previous && skipBusy) return Promise.resolve(undefined);
    const current = (previous || Promise.resolve()).catch(() => {}).then(task);
    this.vmWork.set(id, current);
    /**
     * 入口 / Entry: HaWitness.runVm.finished.
     * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaWitness`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; the calls and state transitions below complete the operation. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
     * 处理：通过 `this.vmWork.get`, `this.vmWork.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `this.vmWork.get`, `this.vmWork.delete`; the branches below determine continuation, return or refusal.
     * 分支 / Branches: `this.vmWork.get(id) === current`.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: `this.vmWork.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const finished = () => {
      if (this.vmWork.get(id) === current) this.vmWork.delete(id);
    };
    void current.then(finished, finished);
    return current;
  }

  /**
   * 入口 / Entry: HaWitness.vm.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `vm` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `vm` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `haWitnessIdentitySchema.parse`, `this.known.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessIdentitySchema.parse`, `this.known.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: HaWitnessIdentity
   * 输出 / Returns: `vm`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!vm || vm.sourceHostId !== identity.sourceHostId`; 异常 / errors `new AppError('未登记此来源实例', 404)`.
   */
  private vm(raw: HaWitnessIdentity) {
    const identity = haWitnessIdentitySchema.parse(raw);
    const vm = this.known.get(identity.sourceVmId);
    if (!vm || vm.sourceHostId !== identity.sourceHostId)
      throw new AppError('未登记此来源实例', 404);
    return vm;
  }

  /**
   * 入口 / Entry: HaWitness.entry.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `entry` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `entry` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: id: string
   * 输出 / Returns: Entry；结果来自 / values from `entry`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!entry`; 异常 / errors `new AppError('见证状态缺少已登记实例', 503, 'HA_WITNESS_STATE_MISMATCH')`.
   */
  private entry(id: string): Entry {
    const entry = this.state.entries[id];
    if (!entry) throw new AppError('见证状态缺少已登记实例',
      503, 'HA_WITNESS_STATE_MISMATCH');
    return entry;
  }

  /**
   * 入口 / Entry: HaWitness.save.
   * 功能：在维护见证节点的来源、目标与副本状态中，校验并提交领域状态变更；处理结果记录到 `this.storageUnavailable`, `this.state`（`HaWitness`）。
   * Purpose: Validates and commits a domain state change in `HaWitness`; the outcome is recorded in `this.storageUnavailable`, `this.state`. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `storeSchema.parse`, `entrySchema.parse`, `persistState` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `entrySchema.parse`, `persistState`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; entry: Entry
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `persistState`; 更新 / updates `this.storageUnavailable`, `this.state`.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `this.storageUnavailable = true;`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `this.storageUnavailable = true;`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async save(id: string, entry: Entry) {
    const next = storeSchema.parse({ ...this.state,
      entries: { ...this.state.entries, [id]: entrySchema.parse(entry) } });
    try { await persistState(this.file, next); }
    catch (error) { this.storageUnavailable = true; throw error; }
    this.state = next;
  }

  /**
   * 入口 / Entry: HaWitness.requireStorage.
   * 功能：在维护见证节点的来源、目标与副本状态中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`HaWitness`）。
   * Purpose: Checks admission, input or resource ownership in `HaWitness`; the calls and state transitions below complete the operation. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.storageUnavailable`; 异常 / errors `new AppError('见证持久存储写入失败；须恢复存储并重启后核对状态', 503, 'HA_WITNESS_STORAGE_UNAVAILABLE')`.
   */
  private requireStorage() {
    if (this.storageUnavailable)
      throw new AppError('见证持久存储写入失败；须恢复存储并重启后核对状态',
        503, 'HA_WITNESS_STORAGE_UNAVAILABLE');
  }

  /**
   * 入口 / Entry: HaWitness.heartbeat.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.enqueue(async () => { this.requireStorage(); const input = haWitnessHeartbeatSchema.parse(raw), vm = this.vm({ sourceHos…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  heartbeat(raw: unknown) {
    /**
     * 入口 / Entry: HaWitness.heartbeat.callback@301.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ armed: !!plan, phase: 'source' as const, failback: !plan ? entry.failback?.phase || null : null }`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `input.failureThreshold !== vm.failureThreshold`; `entry.recoveryHold`; `entry.phase !== 'source'`; 异常 / errors `new AppError('见证节点与来源的故障阈值配置不一致', 409)`; `new AppError('见证状态已恢复并保持封锁；须核对全部副本后受控退出', 409, 'HA_WITNESS_RECOVERY_HOLD')`.
     */
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

  /**
   * 入口 / Entry: HaWitness.authorizeStart.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.enqueue(async () => { this.requireStorage(); const vm = this.vm(haWitnessIdentitySchema.parse(raw)); const entry = this.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  authorizeStart(raw: unknown) {
    /**
     * 入口 / Entry: HaWitness.authorizeStart.callback@338.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ allowed: true as const, phase: entry.phase }`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `entry.phase !== 'source' || entry.recoveryHold`; 异常 / errors `new AppError('见证节点已隔离来源，不能启动', 409, 'HA_WITNESS_FENCED')`.
     */
    return this.enqueue(async () => {
      this.requireStorage();
      const vm = this.vm(haWitnessIdentitySchema.parse(raw));
      const entry = this.entry(vm.sourceVmId);
      if (entry.phase !== 'source' || entry.recoveryHold)
        throw new AppError('见证节点已隔离来源，不能启动', 409, 'HA_WITNESS_FENCED');
      return { allowed: true as const, phase: entry.phase };
    });
  }

  /**
   * 入口 / Entry: HaWitness.status.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.enqueue(async () => { const vm = this.vm(haWitnessIdentitySchema.parse(raw)); const entry = this.entry(vm.sourceVmId); r…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  status(raw: unknown) {
    /**
     * 入口 / Entry: HaWitness.status.callback@349.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ phase: entry.phase, armed: !!entry.plan && !entry.recoveryHold, targetHostId: vm.targetHostId, failureThreshold: vm.failure…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
  /**
   * 入口 / Entry: HaWitness.deploymentState.
   * 功能：把本层请求转交 `this.enqueue`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.enqueue` and propagates the provider result or rejection.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.enqueue(async () => { const vm = this.vm(haWitnessIdentitySchema.parse(raw)); const entry = this.entry(vm.sourceVmId); r…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
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
  /**
   * 入口 / Entry: HaWitness.drain.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; the calls and state transitions below complete the operation. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `Promise.allSettled`, `this.vmWork.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.allSettled`, `this.vmWork.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async drain() {
    await Promise.allSettled([...this.vmWork.values()]);
    await this.work;
  }

  /**
   * 入口 / Entry: HaWitness.sample.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.all([...this.known.values()].map((vm) => this.runVm(vm.sourceVmId, () => this.sampleVm(vm), true)))` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `Promise.all([...this.known.values()].map((vm) => this.runVm(vm.sourceVmId, () => this.sampleVm(vm), true)))` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `Promise.all`, `inline.map`, `this.known.values` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `inline.map`, `this.known.values`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `Promise.all([...this.known.values()].map((vm) => this.runVm(vm.sourceVmId, () => this.sampleVm(vm), true)))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  sample() {
    return Promise.all([...this.known.values()].map((vm) =>
      this.runVm(vm.sourceVmId, () => this.sampleVm(vm), true)));
  }

  /**
   * 入口 / Entry: HaWitness.sampleVm.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `this.sampleFailback(vm)` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `void` / `this.sampleFailback(vm)` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `this.enqueue`, `this.sampleFailback`, `this.actions.fence`, `this.actions.confirmFence` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enqueue`, `this.sampleFailback`, `this.actions.fence`, `this.actions.confirmFence`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `transition.held`; `transition.returning`; `!entry?.plan`.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: `void`; `this.sampleFailback(vm)`.
   * 副作用 / Effects: 更新 / updates `entry`.
   * 拒绝 / Refusals: 条件 / conditions `target !== 'starting' && target !== 'running'`; `await this.actions.targetStatus(vm, plan) !== 'running'`; `!await this.actions.applicationReady(vm, plan)`; 异常 / errors `new AppError(`目标副本处于 ${target}，不能接管`, 409)`; `new AppError('目标副本仍在启动，保持来源隔离', 409)`.
   * 失败处理：catch 分支执行 `await this.enqueue(async () => { const current = this.entry(vm.sourceVmId); const detail = (error instanceof Error ? error.me…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.enqueue(async () => { const current = this.entry(vm.sourceVmId); const detail = (error instanceof Error ? error.me…`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async sampleVm(vm: HaWitnessVm) {
    const transition = await this.enqueue(async () => {
      this.requireStorage();
      const entry = this.entry(vm.sourceVmId);
      return { held: !!entry.recoveryHold, returning: entry.failback?.phase === 'pending' };
    });
    if (transition.held) return;
    if (transition.returning) return this.sampleFailback(vm);
    /**
     * 入口 / Entry: HaWitness.sampleVm.callback@400.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `null`; `current`; `fencing`.
     * 副作用 / Effects: `this.save`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
        /**
         * 入口 / Entry: HaWitness.sampleVm.callback@423.
         * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
         * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `fenced`.
         * 副作用 / Effects: `this.save`.
         * 拒绝 / Refusals: 条件 / conditions `current.phase !== 'fencing' || current.plan?.transferId !== plan.transferId`; 异常 / errors `new AppError('隔离期间见证计划发生变化', 503)`.
         */
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
      const activeVmId = await this.actions.trafficTarget(vm, plan);
      if (activeVmId && activeVmId !== vm.sourceVmId && activeVmId !== plan.remoteVmId)
        throw new AppError('流量入口指向未知实例，拒绝覆盖现有路由', 409);
      if (activeVmId !== plan.remoteVmId)
        await this.actions.switchTraffic(vm, plan);
      if (await this.actions.trafficTarget(vm, plan) !== plan.remoteVmId)
        throw new AppError('流量入口没有确认目标实例', 409);
      /**
       * 入口 / Entry: HaWitness.sampleVm.callback@451.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.enqueue）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.enqueue).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `void`.
       * 副作用 / Effects: `this.save`.
       * 拒绝 / Refusals: 条件 / conditions `(current.phase !== 'fenced' && current.phase !== 'promoted') || current.plan?.transferId !== plan.transferId`; 异常 / errors `new AppError('切流期间见证计划发生变化', 503)`.
       */
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

  /**
   * 入口 / Entry: HaWitness.sampleFailback.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `void` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `this.enqueue`, `this.now`, `this.actions.retire`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.enqueue`, `this.now`, `this.actions.retire`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.phase !== 'source' || entry.recoveryHold || returning?.phase !== 'pending'`; `activeVmId !== vm.sourceVmId`.
   * 输入 / Inputs: vm: HaWitnessVm
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!entry.lastHeartbeatAt || this.now() - entry.lastHeartbeatAt >= vm.failureThreshold * 15_000`; `!await this.actions.sourceApplicationReady!(vm, returning.plan)`; `activeVmId !== vm.sourceVmId && activeVmId !== returning.plan.remoteVmId`; 异常 / errors `new AppError('等待来源恢复并续报存活心跳后回切流量', 409)`; `new AppError('来源应用尚未通过健康检查，保持待回切状态', 409)`.
   * 失败处理：catch 分支执行 `await this.enqueue(async () => { const current = this.entry(vm.sourceVmId); if (current.failback?.phase === 'pending' && curr…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.enqueue(async () => { const current = this.entry(vm.sourceVmId); if (current.failback?.phase === 'pending' && curr…`; these statements determine whether a failure is absorbed or rejected again.
   */
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

  /**
   * 入口 / Entry: HaWitness.rejoin.
   * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.runVm(vm.sourceVmId, async () => { const entry = await this.enqueue(async () => { this.requireStorage(); return this.ent…` 供上层消费（`HaWitness`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `this.runVm(vm.sourceVmId, async () => { const entry = await this.enqueue(async () => { this.requireStorage(); return this.ent…` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `haWitnessIdentitySchema.safeExtend().parse`, `haWitnessIdentitySchema.safeExtend`, `z.literal`, `this.vm` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `haWitnessIdentitySchema.safeExtend().parse`, `haWitnessIdentitySchema.safeExtend`, `z.literal`, `this.vm`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: raw: unknown
   * 输出 / Returns: `this.runVm(vm.sourceVmId, async () => { const entry = await this.enqueue(async () => { this.requireStorage(); return this.ent…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async rejoin(raw: unknown) {
    const input = haWitnessIdentitySchema.safeExtend({
      dataReconciled: z.literal(true),
    }).parse(raw);
    const vm = this.vm({ sourceHostId: input.sourceHostId,
      sourceVmId: input.sourceVmId });
    /**
     * 入口 / Entry: HaWitness.rejoin.callback@522.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.runVm）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.runVm).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.releaseRecovery(vm, entry)`; `{ released: true as const, recovered: true as const, retiredVmIds: entry.recoveryReceipt.replicas.map((item) => item.remoteVm…`; `{ released: true as const, retiredRemoteVmId: entry.retiredRemoteVmId, ...(entry.failback ? { failback: entry.failback.phase …`；另有分支返回 / additional branch-specific returns.
     * 副作用 / Effects: `this.releaseRecovery`.
     * 拒绝 / Refusals: 条件 / conditions `entry.phase === 'source' || !entry.plan`; 异常 / errors `new AppError('见证节点没有待退出的隔离或接管记录', 409)`.
     */
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

  /**
   * 入口 / Entry: HaWitness.releaseRecovery.
   * 功能：在维护见证节点的来源、目标与副本状态中，结束、撤销或清理本次拥有的领域资源；本入口产生 `{ released: true as const, recovered: true as const, retiredVmIds: after.replicas.map((item) => item.identity.remoteVmId), ..…` 供上层消费（`HaWitness`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `HaWitness`; this entry produces `{ released: true as const, recovered: true as const, retiredVmIds: after.replicas.map((item) => item.identity.remoteVmId), ..…` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
   * 处理：通过 `inventory`, `inline.filter`, `expected.some`, `before.replicas.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inventory`, `inline.filter`, `expected.some`, `before.replicas.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vm: HaWitnessVm; entry: Entry
   * 输出 / Returns: `{ released: true as const, recovered: true as const, retiredVmIds: after.replicas.map((item) => item.identity.remoteVmId), ..…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.actions.inspectReplicas || !this.actions.recoveryTrafficTarget`; `expected.some((identity) => !before.replicas.some((item) => same(identity, item.identity))) || (entry.retiredRemoteVmId && !b…`; `before.replicas.some((item) => item.status !== 'stopped')`; 异常 / errors `new AppError('目标未提供完整副本清单，保持恢复封锁', 503)`; `new AppError('历史副本或完整退役证据缺失，保持恢复封锁', 409)`.
   */
  private async releaseRecovery(vm: HaWitnessVm, entry: Entry) {
    if (!this.actions.inspectReplicas || !this.actions.recoveryTrafficTarget)
      throw new AppError('目标未提供完整副本清单，保持恢复封锁', 503);
    /**
     * 入口 / Entry: HaWitness.releaseRecovery.inventory.
     * 功能：在维护见证节点的来源、目标与副本状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`HaWitness`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `HaWitness`; this entry produces `result` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
     * 处理：通过 `haWitnessReplicaInventorySchema.parse`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `haWitnessReplicaInventorySchema.parse`, `inline`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `result.hostId !== vm.targetHostId || result.sourceHostId !== vm.sourceHostId || result.sourceVmId !== vm.sourceVmId`; 异常 / errors `new AppError('完整副本清单的来源或目标身份不一致，保持恢复封锁', 409)`.
     */
    const inventory = async () => {
      const result = haWitnessReplicaInventorySchema.parse(await this.actions.inspectReplicas!(vm));
      if (result.hostId !== vm.targetHostId || result.sourceHostId !== vm.sourceHostId ||
          result.sourceVmId !== vm.sourceVmId)
        throw new AppError('完整副本清单的来源或目标身份不一致，保持恢复封锁', 409);
      return result;
    };
    const before = await inventory();
    /**
     * 入口 / Entry: HaWitness.releaseRecovery.same.
     * 功能：从当前输入或状态计算 `Object.entries(haWitnessReplicaIdentitySchema.parse({ sourceHostId: left.sourceHostId, sourceVmId: left.sourceVmId, targetHos…`，供调用方后续验证或使用。
     * Purpose: Computes `Object.entries(haWitnessReplicaIdentitySchema.parse({ sourceHostId: left.sourceHostId, sourceVmId: left.sourceVmId, targetHos…` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: left: HaWitnessReplicaIdentity; right: HaWitnessReplicaIdentity
     * 输出 / Returns: `Object.entries(haWitnessReplicaIdentitySchema.parse({ sourceHostId: left.sourceHostId, sourceVmId: left.sourceVmId, targetHos…`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
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
    /**
     * 入口 / Entry: HaWitness.releaseRecovery.readTraffic.
     * 功能：在维护见证节点的来源、目标与副本状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `activeVmId` 供上层消费（`HaWitness`）。
     * Purpose: Reads/verifies domain state and constructs a caller-facing result in `HaWitness`; this entry produces `activeVmId` for its caller. Module context: Owns witness source/target/replica state and coordinates promotion from fencing and retirement evidence.
     * 处理：通过 `inline`, `before.replicas.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `inline`, `before.replicas.some`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `activeVmId`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `activeVmId !== vm.sourceVmId && !before.replicas.some((item) => item.identity.remoteVmId === activeVmId)`; 异常 / errors `new AppError('流量入口指向未知实例，保持恢复封锁', 409)`.
     */
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

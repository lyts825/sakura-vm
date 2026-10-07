/**
 * 模块职责：保存集群策略分批发布计划，限制存储记录并校验批次身份唯一性。
 * Module purpose: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
 */
import type { HostPeersV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { rolloutPolicyInput } from './feature-rollouts.ts';
import type { PeerRolloutView } from './host-peers.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

const targetSchema = z.object({
  peerId: z.uuid(), hostId: z.uuid(), name: z.string().min(1).max(128),
  beforeRevision: z.number().int().nonnegative(),
  state: z.enum(['pending', 'applied', 'failed']),
  error: z.string().max(500).optional(), appliedAt: z.string().optional(),
}).strict();
const batchSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(),
  policy: rolloutPolicyInput, targets: z.array(targetSchema).min(1).max(16),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), batches: z.array(batchSchema).max(50) }).strict();
type Store = z.infer<typeof storeSchema>;
type Batch = Store['batches'][number];
const createSchema = z.object({ operation: z.literal('create'), policy: rolloutPolicyInput,
  peers: z.array(z.uuid()).min(1).max(16) }).strict();
const publishSchema = z.object({ operation: z.literal('publish'), id: z.uuid(),
  revision: z.number().int().positive() }).strict();
export const fleetRolloutRequest = z.discriminatedUnion('operation', [createSchema, publishSchema]);
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, batches: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, batches: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, batches: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const initial = (): Store => ({ version: 1, batches: [] });
/**
 * 入口 / Entry: samePolicy.
 * 功能：从当前输入或状态计算 `left.pluginId === right.pluginId && left.enabled === right.enabled && left.percentage === right.percentage && left.cohortVers…`，供调用方后续验证或使用。
 * Purpose: Computes `left.pluginId === right.pluginId && left.enabled === right.enabled && left.percentage === right.percentage && left.cohortVers…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: left: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string }; right: Batch['policy']
 * 输出 / Returns: `left.pluginId === right.pluginId && left.enabled === right.enabled && left.percentage === right.percentage && left.cohortVers…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const samePolicy = (left: { pluginId: string; enabled: boolean; percentage: number; cohortVersion: string },
  right: Batch['policy']) => left.pluginId === right.pluginId && left.enabled === right.enabled &&
    left.percentage === right.percentage && left.cohortVersion === right.cohortVersion;

/** Durable, reviewable policy batches with per-peer reconciliation after ambiguous responses. */
export class FleetPolicyRollouts {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /**
   * 入口 / Entry: FleetPolicyRollouts.constructor.
   * 功能：建立 FleetPolicyRollouts 的保存集群策略分批发布计划上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FleetPolicyRollouts context for this module's responsibility: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: peers: HostPeersV1; file: default=join(DATA, 'fleet-policy-rollouts.json'); blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private peers: HostPeersV1,
    private file = join(DATA, 'fleet-policy-rollouts.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {}) {}

  /**
   * 入口 / Entry: FleetPolicyRollouts.init.
   * 功能：在保存集群策略分批发布计划中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`FleetPolicyRollouts`）。
   * Purpose: Initializes and verifies current domain state in `FleetPolicyRollouts`; the outcome is recorded in `this.state`. Module context: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 256 * 1024)`; `new Set(this.state.batches.map((batch) => batch.id)).size !== this.state.batches.length`; 异常 / errors `new AppError('集群策略记录类型或大小无效')`; `new AppError('集群策略批次重复')`.
   */
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 256 * 1024))
      throw new AppError('集群策略记录类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.batches.map((batch) => batch.id)).size !== this.state.batches.length)
      throw new AppError('集群策略批次重复');
    if (!info) await writeStore(this.file, this.state);
  }
  /**
   * 入口 / Entry: FleetPolicyRollouts.view.
   * 功能：从当前输入或状态计算 `{ batches: structuredClone(this.state.batches) }`，供调用方后续验证或使用。
   * Purpose: Computes `{ batches: structuredClone(this.state.batches) }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ batches: structuredClone(this.state.batches) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() { return { batches: structuredClone(this.state.batches) }; }
  /**
   * 入口 / Entry: FleetPolicyRollouts.serialized.
   * 功能：在保存集群策略分批发布计划中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task.finally(() => this.mutation(-1))` 供上层消费（`FleetPolicyRollouts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FleetPolicyRollouts`; this entry produces `task.finally(() => this.mutation(-1))` for its caller. Module context: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
   * 处理：通过 `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `this.mutation`, `this.queue.catch().then`, `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task.finally(() => this.mutation(-1))`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   */
  private serialized<T>(work: () => Promise<T>) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    this.mutation(1);
    const task = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('服务正在关闭', 503);
      if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
      return work();
    });
    this.queue = task;
    return task.finally(() => this.mutation(-1));
  }
  /**
   * 入口 / Entry: FleetPolicyRollouts.save.
   * 功能：在保存集群策略分批发布计划中，校验并提交领域状态变更；处理结果记录到 `this.state`（`FleetPolicyRollouts`）。
   * Purpose: Validates and commits a domain state change in `FleetPolicyRollouts`; the outcome is recorded in `this.state`. Module context: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: next: Store
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(next: Store) {
    await writeStore(this.file, next);
    this.state = next;
  }
  /**
   * 入口 / Entry: FleetPolicyRollouts.configure.
   * 功能：在保存集群策略分批发布计划中，校验并提交领域状态变更；本入口产生 `this.serialized(async () => { if (value.operation === 'create') { if (new Set(value.peers).size !== value.peers.length) throw…` 供上层消费（`FleetPolicyRollouts`）。
   * Purpose: Validates and commits a domain state change in `FleetPolicyRollouts`; this entry produces `this.serialized(async () => { if (value.operation === 'create') { if (new Set(value.peers).size !== value.peers.length) throw…` for its caller. Module context: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
   * 处理：通过 `fleetRolloutRequest.parse`, `this.serialized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `fleetRolloutRequest.parse`, `this.serialized`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serialized(async () => { if (value.operation === 'create') { if (new Set(value.peers).size !== value.peers.length) throw…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async configure(input: unknown) {
    const value = fleetRolloutRequest.parse(input);
    /**
     * 入口 / Entry: FleetPolicyRollouts.configure.callback@80.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.serialized）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.serialized).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `structuredClone(batch)`.
     * 副作用 / Effects: `targets.push`; `this.save`; `this.peers.publishRollout`; 更新 / updates `target.state`, `target.appliedAt`, `target.error`, `batch.updatedAt`.
     * 拒绝 / Refusals: 条件 / conditions `value.operation === 'create'`; `new Set(value.peers).size !== value.peers.length`; `this.state.batches.length >= 50`; 异常 / errors `new AppError('发布目标重复')`; `new AppError('集群策略批次已达上限', 409)`.
     * 失败处理：catch 分支执行 `target.state = 'failed';`; `target.error = String((error as Error).message || error).slice(0, 500);`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `target.state = 'failed';`; `target.error = String((error as Error).message || error).slice(0, 500);`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serialized(async () => {
      if (value.operation === 'create') {
        if (new Set(value.peers).size !== value.peers.length)
          throw new AppError('发布目标重复');
        if (this.state.batches.length >= 50) throw new AppError('集群策略批次已达上限', 409);
        const known = new Map(this.peers.view().outbound.map((peer) => [peer.id, peer]));
        const targets = [];
        for (const peerId of value.peers) {
          const peer = known.get(peerId);
          if (!peer) throw new AppError('发布目标未配对或已移除', 409);
          const status = await this.peers.rolloutStatus(peerId);
          const previous = status.policies.find((policy) => policy.pluginId === value.policy.pluginId);
          targets.push({ peerId, hostId: status.hostId, name: peer.name,
            beforeRevision: previous?.revision || 0, state: 'pending' as const });
        }
        const timestamp = new Date().toISOString();
        const batch: Batch = { id: randomUUID(), revision: 1, policy: value.policy,
          targets, createdAt: timestamp, updatedAt: timestamp };
        await this.save({ ...this.state, batches: [batch, ...this.state.batches] });
        return structuredClone(batch);
      }
      const next = structuredClone(this.state);
      const batch = next.batches.find((item) => item.id === value.id);
      if (!batch) throw new AppError('策略批次不存在', 404);
      if (batch.revision !== value.revision) throw new AppError('策略批次已变化，请刷新', 409);
      for (const target of batch.targets) {
        if (target.state === 'applied') continue;
        try {
          const current = await this.peers.rolloutStatus(target.peerId);
          if (current.hostId !== target.hostId) throw new AppError('目标主机身份已变化', 409);
          const policy = current.policies.find((item) => item.pluginId === batch.policy.pluginId);
          const revision = policy?.revision || 0;
          if (revision === target.beforeRevision + 1 && policy && samePolicy(policy, batch.policy)) {
            target.state = 'applied'; target.appliedAt = new Date().toISOString();
          } else {
            if (revision !== target.beforeRevision)
              throw new AppError('目标策略已被其他操作修改，请创建新批次', 409);
            const result: PeerRolloutView = await this.peers.publishRollout(target.peerId, {
              operation: 'save', ...(revision ? { revision } : {}), policy: batch.policy,
            });
            const applied = result.policies.find((item) => item.pluginId === batch.policy.pluginId);
            if (result.hostId !== target.hostId || !applied ||
                applied.revision !== target.beforeRevision + 1 || !samePolicy(applied, batch.policy))
              throw new AppError('目标未确认策略版本，请重试核对', 502);
            target.state = 'applied'; target.appliedAt = new Date().toISOString();
          }
          delete target.error;
        } catch (error) {
          target.state = 'failed'; target.error = String((error as Error).message || error).slice(0, 500);
        }
        batch.revision++;
        batch.updatedAt = new Date().toISOString();
        await this.save(structuredClone(next));
      }
      return structuredClone(batch);
    });
  }
  /**
   * 入口 / Entry: FleetPolicyRollouts.close.
   * 功能：在保存集群策略分批发布计划中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`FleetPolicyRollouts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FleetPolicyRollouts`; the outcome is recorded in `this.closed`. Module context: Persists staged fleet policy rollout plans, bounding records and checking batch identity uniqueness.
   * 处理：通过 `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() { this.closed = true; await this.queue.catch(() => {}); }
}

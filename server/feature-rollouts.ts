/**
 * 模块职责：保存插件灰度策略并计算启用决策，校验插件存在性及持久记录唯一性。
 * Module purpose: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
 */
import { createHash, randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { PLUGINS } from '../shared/plugins.ts';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';

const ids = new Set<string>(PLUGINS.map((plugin) => plugin.id));
const pluginId = z.string().refine((id) => ids.has(id), '插件不存在');
export const rolloutPolicyInput = z.object({
  pluginId,
  enabled: z.boolean(),
  percentage: z.number().int().min(0).max(100),
  cohortVersion: z.string().trim().min(1).max(64),
}).strict();
const policySchema = rolloutPolicyInput.extend({
  revision: z.number().int().positive(),
  updatedAt: z.number().int().nonnegative(),
}).strict();
const storeSchema = z.object({
  version: z.literal(1),
  hostId: z.uuid(),
  policies: z.array(policySchema).max(PLUGINS.length),
}).strict();
type Store = z.infer<typeof storeSchema>;
export type RolloutPolicy = Store['policies'][number];
export const featureRolloutRequest = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('save'), revision: z.number().int().positive().optional(),
    policy: rolloutPolicyInput }).strict(),
  z.object({ operation: z.literal('remove'), pluginId,
    revision: z.number().int().positive() }).strict(),
  z.object({ operation: z.literal('preview'), policy: rolloutPolicyInput }).strict(),
]);
/**
 * 入口 / Entry: initial.
 * 功能：从当前输入或状态计算 `({ version: 1, hostId: randomUUID(), policies: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, hostId: randomUUID(), policies: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, hostId: randomUUID(), policies: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const initial = (): Store => ({ version: 1, hostId: randomUUID(), policies: [] });

/** A persisted host cohort decides whether a selected plugin starts on the next service launch. */
export class FeatureRollouts {
  private state: Store = initial();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  /**
   * 入口 / Entry: FeatureRollouts.constructor.
   * 功能：建立 FeatureRollouts 的保存插件灰度策略并计算启用决策上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the FeatureRollouts context for this module's responsibility: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: default=join(DATA, 'feature-rollouts.json'); blocked: () => boolean default=() => false; mutation: (delta: number) => void default=() => {}; now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private file = join(DATA, 'feature-rollouts.json'),
    private blocked: () => boolean = () => false,
    private mutation: (delta: number) => void = () => {},
    private now = Date.now,
  ) {}

  /**
   * 入口 / Entry: FeatureRollouts.init.
   * 功能：在保存插件灰度策略并计算启用决策中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`FeatureRollouts`）。
   * Purpose: Initializes and verifies current domain state in `FeatureRollouts`; the outcome is recorded in `this.state`. Module context: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
   * 处理：通过 `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stat().catch`, `stat`, `info.isFile`, `storeSchema.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!info`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `info && (!info.isFile() || info.size > 256 * 1024)`; `new Set(this.state.policies.map((item) => item.pluginId)).size !== this.state.policies.length`; 异常 / errors `new AppError('功能灰度存储类型或大小无效')`; `new AppError('功能灰度记录重复')`.
   */
  async init() {
    const info = await stat(this.file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info && (!info.isFile() || info.size > 256 * 1024))
      throw new AppError('功能灰度存储类型或大小无效');
    this.state = storeSchema.parse(await readStore(this.file, initial));
    if (new Set(this.state.policies.map((item) => item.pluginId)).size !== this.state.policies.length)
      throw new AppError('功能灰度记录重复');
    if (!info) await writeStore(this.file, this.state);
  }

  /**
   * 入口 / Entry: FeatureRollouts.decision.
   * 功能：在保存插件灰度策略并计算启用决策中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ pluginId: id, allowed: !policy || (policy.enabled && bucket! < policy.percentage * 100), bucket, ...(policy ? { policy } : …` 供上层消费（`FeatureRollouts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `FeatureRollouts`; this entry produces `{ pluginId: id, allowed: !policy || (policy.enabled && bucket! < policy.percentage * 100), bucket, ...(policy ? { policy } : …` for its caller. Module context: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
   * 处理：通过 `this.state.policies.find`, `parseInt`, `createHash().update().digest().slice`, `createHash().update().digest` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.policies.find`, `parseInt`, `createHash().update().digest().slice`, `createHash().update().digest`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; draft: z.infer<typeof rolloutPolicyInput> optional
   * 输出 / Returns: `{ pluginId: id, allowed: !policy || (policy.enabled && bucket! < policy.percentage * 100), bucket, ...(policy ? { policy } : …`.
   * 副作用 / Effects: `createHash().update().digest().slice`; `createHash().update().digest`; `createHash().update`; `createHash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  decision(id: string, draft?: z.infer<typeof rolloutPolicyInput>) {
    const policy = draft || this.state.policies.find((item) => item.pluginId === id);
    const bucket = policy ? parseInt(createHash('sha256')
      .update(`${this.state.hostId}:${id}:${policy.cohortVersion}`).digest('hex').slice(0, 8), 16) % 10_000 : null;
    return {
      pluginId: id,
      allowed: !policy || (policy.enabled && bucket! < policy.percentage * 100),
      bucket,
      ...(policy ? { policy } : {}),
    };
  }

  /**
   * 入口 / Entry: FeatureRollouts.view.
   * 功能：在保存插件灰度策略并计算启用决策中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ hostId: this.state.hostId, plugins: PLUGINS.map((plugin) => ({ id: plugin.id, name: plugin.name, ...this.decision(plugin.id…` 供上层消费（`FeatureRollouts`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `FeatureRollouts`; this entry produces `{ hostId: this.state.hostId, plugins: PLUGINS.map((plugin) => ({ id: plugin.id, name: plugin.name, ...this.decision(plugin.id…` for its caller. Module context: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
   * 处理：通过 `PLUGINS.map`, `structuredClone` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `PLUGINS.map`, `structuredClone`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ hostId: this.state.hostId, plugins: PLUGINS.map((plugin) => ({ id: plugin.id, name: plugin.name, ...this.decision(plugin.id…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view() {
    return {
      hostId: this.state.hostId,
      plugins: PLUGINS.map((plugin) => ({ id: plugin.id, name: plugin.name,
        ...this.decision(plugin.id) })),
      policies: structuredClone(this.state.policies),
    };
  }

  /**
   * 入口 / Entry: FeatureRollouts.configure.
   * 功能：在保存插件灰度策略并计算启用决策中，校验并提交领域状态变更；本入口产生 `this.decision(value.policy.pluginId, value.policy)` / `await task` 供上层消费（`FeatureRollouts`）。
   * Purpose: Validates and commits a domain state change in `FeatureRollouts`; this entry produces `this.decision(value.policy.pluginId, value.policy)` / `await task` for its caller. Module context: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
   * 处理：通过 `this.blocked`, `featureRolloutRequest.parse`, `this.decision`, `this.mutation` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.blocked`, `featureRolloutRequest.parse`, `this.decision`, `this.mutation`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.operation === 'preview'`.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.decision(value.policy.pluginId, value.policy)`; `await task`.
   * 副作用 / Effects: 更新 / updates `this.queue`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.blocked()`; 异常 / errors `new AppError('服务正在关闭', 503)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `this.mutation(-1);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `this.mutation(-1);`; these steps also apply to exceptional exits.
   */
  async configure(input: unknown) {
    if (this.closed) throw new AppError('服务正在关闭', 503);
    if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
    const value = featureRolloutRequest.parse(input);
    if (value.operation === 'preview') return this.decision(value.policy.pluginId, value.policy);
    this.mutation(1);
    try {
      /**
       * 入口 / Entry: FeatureRollouts.configure.callback@94.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.queue.catch().then）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.queue.catch().then).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.view()`.
       * 副作用 / Effects: `next.policies.splice`; `next.policies.push`; `writeStore`; 更新 / updates `next.policies[index]`, `this.state`.
       * 拒绝 / Refusals: 条件 / conditions `this.blocked()`; `value.operation === 'remove'`; `index < 0`; 异常 / errors `new AppError('数据目录迁移维护中', 409)`; `new AppError('灰度策略不存在', 404)`.
       */
      const task = this.queue.catch(() => {}).then(async () => {
        if (this.blocked()) throw new AppError('数据目录迁移维护中', 409);
        const next = structuredClone(this.state);
        if (value.operation === 'remove') {
          const index = next.policies.findIndex((item) => item.pluginId === value.pluginId);
          if (index < 0) throw new AppError('灰度策略不存在', 404);
          if (next.policies[index].revision !== value.revision)
            throw new AppError('灰度策略已变化，请刷新', 409);
          next.policies.splice(index, 1);
        } else {
          const index = next.policies.findIndex((item) => item.pluginId === value.policy.pluginId);
          if (index >= 0 && next.policies[index].revision !== value.revision)
            throw new AppError('灰度策略已变化，请刷新', 409);
          if (index < 0 && value.revision) throw new AppError('灰度策略不存在', 404);
          const policy = { ...value.policy, revision: (next.policies[index]?.revision || 0) + 1,
            updatedAt: this.now() };
          if (index >= 0) next.policies[index] = policy;
          else next.policies.push(policy);
        }
        await writeStore(this.file, next);
        this.state = next;
        return this.view();
      });
      this.queue = task;
      return await task;
    } finally {
      this.mutation(-1);
    }
  }

  /**
   * 入口 / Entry: FeatureRollouts.close.
   * 功能：在保存插件灰度策略并计算启用决策中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`FeatureRollouts`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `FeatureRollouts`; the outcome is recorded in `this.closed`. Module context: Stores plugin rollout policies and computes enablement, validating plugin existence and unique durable records.
   * 处理：通过 `this.queue.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.queue.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    await this.queue.catch(() => {});
  }
}

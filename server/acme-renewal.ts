/**
 * 模块职责：保存实例证书续期策略并调度客户机 Certbot；执行中的策略不能同时修改。
 * Module purpose: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { VmAccess as Machines } from './vm-access.ts';
import { scheduler, type ScheduleHandle } from './scheduler.ts';

export const acmeInput = z.object({
  mode: z.enum(['status', 'save', 'renew', 'dry-run']).default('status'),
  enabled: z.boolean().optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
}).strict();
const policy = z.object({ vmId: z.uuid(), enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(168),
  updatedAt: z.iso.datetime(),
  nextAttemptAt: z.number().int().nonnegative(),
  lastAttemptAt: z.number().int().nonnegative().optional() }).strict();
const attempt = z.object({ vmId: z.uuid(), at: z.number().int().positive(),
  mode: z.enum(['manual', 'scheduled', 'dry-run']),
  status: z.enum(['success', 'failed']), exitCode: z.number().int().optional() }).strict();
const storeSchema = z.object({ version: z.literal(1),
  policies: z.array(policy).max(64), attempts: z.array(attempt).max(200) }).strict();
type Store = z.infer<typeof storeSchema>;
type Attempt = z.infer<typeof attempt>;
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1, policies: [], attempts: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, policies: [], attempts: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: Store；结果来自 / values from `({ version: 1, policies: [], attempts: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): Store => ({ version: 1, policies: [], attempts: [] });
const checkCommand = "command -v certbot >/dev/null && test -d /etc/letsencrypt/renewal && find /etc/letsencrypt/renewal -maxdepth 1 -type f -name '*.conf' -print -quit | grep -q .";

/** Renews existing guest Certbot lineages; certificate issuance remains Certbot's responsibility. */
export class AcmeRenewal {
  private state: Store = defaults();
  private writes = Promise.resolve();
  private active = new Map<string, { promise: Promise<unknown>; controller: AbortController }>();
  private timer?: ScheduleHandle;
  private ticking?: Promise<void>;
  private closed = false;
  /**
   * 入口 / Entry: AcmeRenewal.allowed.
   * 功能：向调用者提供 `this.controls.allowed` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.controls.allowed` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.controls.allowed`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get allowed() { return this.controls.allowed; }
  /**
   * 入口 / Entry: AcmeRenewal.mutation.
   * 功能：向调用者提供 `this.controls.mutation` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.controls.mutation` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.controls.mutation`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private get mutation() { return this.controls.mutation; }

  /**
   * 入口 / Entry: AcmeRenewal.constructor.
   * 功能：建立 AcmeRenewal 的保存实例证书续期策略并调度客户机 Certbot上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the AcmeRenewal context for this module's responsibility: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: machines: Machines; file: default=join(DATA, 'acme-renewal.json'); now: default=Date.now; controls: { allowed: () => boolean; mutation: (delta: number) => void } default={ allowed: () => false, mutation: () => {}, }
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private machines: Machines,
    private file = join(DATA, 'acme-renewal.json'), private now = Date.now,
    private readonly controls: {
    /**
     * 签名 / Signature: AcmeRenewal.constructor.allowed.
     * 功能：为保存实例证书续期策略并调度客户机 Certbot声明 allowed 的输入与结果契约，所属容器为 AcmeRenewal.constructor。
     * Purpose: Declares the input/result contract for allowed in AcmeRenewal.constructor. Module responsibility: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: boolean.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    allowed: () => boolean;
    /**
     * 签名 / Signature: AcmeRenewal.constructor.mutation.
     * 功能：为保存实例证书续期策略并调度客户机 Certbot声明 mutation 的输入与结果契约，所属容器为 AcmeRenewal.constructor。
     * Purpose: Declares the input/result contract for mutation in AcmeRenewal.constructor. Module responsibility: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
     * 输入 / Inputs: delta: number
     * 输出 / Returns: void.
     * 契约：此声明定义调用形状，本身不执行 I/O；业务验证与副作用由实现方执行。
     * Contract: Defines the call shape and performs no I/O itself; the implementation performs domain validation and effects.
     */
    mutation: (delta: number) => void } = {
      /**
       * 入口 / Entry: AcmeRenewal.constructor.allowed.
       * 功能：从当前输入或状态计算 `false`，供调用方后续验证或使用。
       * Purpose: Computes `false` from current inputs/state for the caller to validate or consume.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `false`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      allowed: () => false,
      /**
       * 入口 / Entry: AcmeRenewal.constructor.mutation.
       * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AcmeRenewal`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; the calls and state transitions below complete the operation. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       */
      mutation: () => {},
    }) {}

  /**
   * 入口 / Entry: AcmeRenewal.init.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.timer`（`AcmeRenewal`）。
   * Purpose: Initializes and verifies current domain state in `AcmeRenewal`; the outcome is recorded in `this.state`, `this.timer`. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `storeSchema.parse`, `readStore`, `this.state.policies.map`, `scheduler.register` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `storeSchema.parse`, `readStore`, `this.state.policies.map`, `scheduler.register`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `scheduler.register`; 更新 / updates `this.state`, `this.timer`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.state.policies.map((item) => item.vmId)).size !== this.state.policies.length`; 异常 / errors `new AppError('证书续期目录包含重复实例', 503)`.
   */
  async init() {
    this.state = storeSchema.parse(await readStore(this.file, defaults));
    if (new Set(this.state.policies.map((item) => item.vmId)).size !== this.state.policies.length)
      throw new AppError('证书续期目录包含重复实例', 503);
    this.timer = scheduler.register({ owner: 'core:acme-renewal', label: '客户机证书续期检查', intervalMs: 60_000,
      immediate: true, overlap: 'coalesce', backoff: { initialMs: 60000, maxMs: 600000 },
      /**
       * 入口 / Entry: AcmeRenewal.init.run.
       * 功能：把本层请求转交 `this.tick`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `this.tick` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `this.tick()`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      run: () => this.tick() });
  }

  /**
   * 入口 / Entry: AcmeRenewal.kick.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; the calls and state transitions below complete the operation. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.timer.trigger` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.timer.trigger`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private kick() {
    this.timer?.trigger();
  }

  /**
   * 入口 / Entry: AcmeRenewal.serial.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; this entry produces `task` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes.catch(() => {}).then(work);
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: AcmeRenewal.change.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: edit: (state: Store) => T
   * 输出 / Returns: `this.serial(async () => { const next = structuredClone(this.state); const result = edit(next); await writeStore(this.file, ne…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private change<T>(edit: (state: Store) => T) {
    /**
     * 入口 / Entry: AcmeRenewal.change.callback@68.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `result`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    return this.serial(async () => {
      const next = structuredClone(this.state);
      const result = edit(next);
      await writeStore(this.file, next);
      this.state = next;
      return result;
    });
  }

  /**
   * 入口 / Entry: AcmeRenewal.view.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ policy: this.state.policies.find((item) => item.vmId === id) || null, attempts: this.state.attempts.filter((item) => item.v…` 供上层消费（`AcmeRenewal`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `AcmeRenewal`; this entry produces `{ policy: this.state.policies.find((item) => item.vmId === id) || null, attempts: this.state.attempts.filter((item) => item.v…` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.machines.get`, `this.state.policies.find`, `this.state.attempts.filter().slice().reverse`, `this.state.attempts.filter().slice` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.state.policies.find`, `this.state.attempts.filter().slice().reverse`, `this.state.attempts.filter().slice`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ policy: this.state.policies.find((item) => item.vmId === id) || null, attempts: this.state.attempts.filter((item) => item.v…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(id: string) {
    this.machines.get(id);
    return { policy: this.state.policies.find((item) => item.vmId === id) || null,
      attempts: this.state.attempts.filter((item) => item.vmId === id).slice(-20).reverse(),
      running: this.active.has(id) };
  }

  /**
   * 入口 / Entry: AcmeRenewal.save.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，校验并提交领域状态变更；本入口产生 `{ ...this.view(id), ready: true, executed: true }` 供上层消费（`AcmeRenewal`）。
   * Purpose: Validates and commits a domain state change in `AcmeRenewal`; this entry produces `{ ...this.view(id), ready: true, executed: true }` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.machines.get`, `acmeInput.parse`, `this.active.has`, `this.state.policies.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `acmeInput.parse`, `this.active.has`, `this.state.policies.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `value.enabled`.
   * 输入 / Inputs: id: string; input: unknown
   * 输出 / Returns: `{ ...this.view(id), ready: true, executed: true }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `value.mode !== 'save' || value.enabled === undefined`; `this.active.has(id)`; 异常 / errors `new AppError('证书续期服务正在关闭', 503)`; `new AppError('需要提供续期启用状态', 400)`.
   */
  async save(id: string, input: unknown) {
    this.machines.get(id);
    if (this.closed) throw new AppError('证书续期服务正在关闭', 503);
    const value = acmeInput.parse(input);
    if (value.mode !== 'save' || value.enabled === undefined)
      throw new AppError('需要提供续期启用状态', 400);
    if (this.active.has(id)) throw new AppError('此实例正在执行证书续期，请稍后修改策略', 409);
    const intervalHours = value.intervalHours ??
      this.state.policies.find((item) => item.vmId === id)?.intervalHours ?? 12;
    /**
     * 入口 / Entry: AcmeRenewal.save.callback@93.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（this.change）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (this.change).
     * 输入 / Inputs: state
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 更新 / updates `state.policies`.
     * 拒绝 / Refusals: 条件 / conditions `!current && state.policies.length >= 64`; 异常 / errors `new AppError('最多保留 64 个实例的续期策略', 409)`.
     */
    await this.change((state) => {
      const current = state.policies.find((item) => item.vmId === id);
      const next = { vmId: id, enabled: value.enabled!, intervalHours,
        updatedAt: new Date(this.now()).toISOString(),
        nextAttemptAt: value.enabled
          ? current?.enabled
            ? Math.min(current.nextAttemptAt, this.now() + intervalHours * 3_600_000)
            : this.now() : 0,
        ...(current?.lastAttemptAt !== undefined ? { lastAttemptAt: current.lastAttemptAt } : {}) };
      if (!current && state.policies.length >= 64)
        throw new AppError('最多保留 64 个实例的续期策略', 409);
      state.policies = [...state.policies.filter((item) => item.vmId !== id), next];
    });
    if (value.enabled) this.kick();
    return { ...this.view(id), ready: true, executed: true };
  }

  /**
   * 入口 / Entry: AcmeRenewal.check.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，核对调用资格、输入或资源归属；本入口产生 `{ ...this.view(id), ready: false, executed: false, reason: '请先启动实例以检查 Certbot 续期配置。' }` / `{ ...this.view(id), ready: result.code === 0, executed: false, ...(result.code !== 0 ? { reason: '客户机需要 Certbot 和已有的 /etc/let…` 供上层消费（`AcmeRenewal`）。
   * Purpose: Checks admission, input or resource ownership in `AcmeRenewal`; this entry produces `{ ...this.view(id), ready: false, executed: false, reason: '请先启动实例以检查 Certbot 续期配置。' }` / `{ ...this.view(id), ready: result.code === 0, executed: false, ...(result.code !== 0 ? { reason: '客户机需要 Certbot 和已有的 /etc/let…` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.machines.get`, `this.machines.state`, `this.view`, `this.machines.exec` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.machines.state`, `this.view`, `this.machines.exec`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.machines.state(id) !== 'running'`.
   * 输入 / Inputs: id: string; signal: AbortSignal optional
   * 输出 / Returns: `{ ...this.view(id), ready: false, executed: false, reason: '请先启动实例以检查 Certbot 续期配置。' }`; `{ ...this.view(id), ready: result.code === 0, executed: false, ...(result.code !== 0 ? { reason: '客户机需要 Certbot 和已有的 /etc/let…`; `{ ...this.view(id), ready: false, executed: false, reason: String((error as Error).message || error) }`.
   * 副作用 / Effects: `this.machines.exec`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `signal?.throwIfAborted();`; `return { ...this.view(id), ready: false, executed: false, reason: String((error as Error).message || error) };`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `signal?.throwIfAborted();`; `return { ...this.view(id), ready: false, executed: false, reason: String((error as Error).message || error) };`; these statements determine whether a failure is absorbed or rejected again.
   */
  async check(id: string, signal?: AbortSignal) {
    this.machines.get(id);
    if (this.machines.state(id) !== 'running')
      return { ...this.view(id), ready: false, executed: false,
        reason: '请先启动实例以检查 Certbot 续期配置。' };
    try {
      const result = await this.machines.exec(id, checkCommand, 15_000, signal);
      return { ...this.view(id), ready: result.code === 0, executed: false,
        ...(result.code !== 0 ? { reason: '客户机需要 Certbot 和已有的 /etc/letsencrypt/renewal/*.conf。' } : {}) };
    } catch (error) {
      signal?.throwIfAborted();
      return { ...this.view(id), ready: false, executed: false,
        reason: String((error as Error).message || error) };
    }
  }

  /**
   * 入口 / Entry: AcmeRenewal.record.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; the calls and state transitions below complete the operation. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.change` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.change`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: Attempt
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async record(item: Attempt) {
    await this.change((state) => {
      state.attempts = [...state.attempts, item].slice(-200);
    });
  }

  /**
   * 入口 / Entry: AcmeRenewal.perform.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...this.view(id), ready: code === 0, executed: true, exitCode: code, // A zero exit code also means no certificate was due.…` 供上层消费（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; this entry produces `{ ...this.view(id), ready: code === 0, executed: true, exitCode: code, // A zero exit code also means no certificate was due.…` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.allowed`, `this.machines.requireUnlocked`, `this.machines.state`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.allowed`, `this.machines.requireUnlocked`, `this.machines.state`, `this.now`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `mode !== 'dry-run'`; `code === undefined`.
   * 输入 / Inputs: id: string; mode: Attempt['mode']; signal: AbortSignal
   * 输出 / Returns: `{ ...this.view(id), ready: code === 0, executed: true, exitCode: code, // A zero exit code also means no certificate was due.…`.
   * 副作用 / Effects: `this.machines.exec`; 更新 / updates `code`.
   * 拒绝 / Refusals: 条件 / conditions `!this.allowed()`; `this.machines.state(id) !== 'running'`; `!checked.ready`; 异常 / errors `new AppError('控制面锁定或数据迁移中，暂不续期', 409)`; `new AppError('请先启动实例', 409)`.
   * 失败处理：catch 分支执行 `if (code === undefined) await this.record({ vmId: id, at, mode, status: 'failed' });`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `if (code === undefined) await this.record({ vmId: id, at, mode, status: 'failed' });`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  private async perform(id: string, mode: Attempt['mode'], signal: AbortSignal) {
    if (!this.allowed()) throw new AppError('控制面锁定或数据迁移中，暂不续期', 409);
    this.machines.requireUnlocked(id);
    if (this.machines.state(id) !== 'running') throw new AppError('请先启动实例', 409);
    const at = this.now();
    if (mode !== 'dry-run') await this.change((state) => {
      const current = state.policies.find((item) => item.vmId === id);
      if (current?.enabled) {
        current.lastAttemptAt = at;
        current.nextAttemptAt = at + current.intervalHours * 3_600_000;
      }
    });
    let code: number | undefined;
    try {
      const checked = await this.check(id, signal);
      if (!checked.ready) throw new AppError(checked.reason || 'Certbot 尚未就绪', 409);
      const command = 'certbot renew --non-interactive --quiet' +
        (mode === 'dry-run' ? ' --dry-run' : '');
      const result = await this.machines.exec(id, command, 15 * 60_000, signal);
      code = result.code;
      await this.record({ vmId: id, at, mode, status: code === 0 ? 'success' : 'failed',
        exitCode: code });
      return { ...this.view(id), ready: code === 0, executed: true, exitCode: code,
        // A zero exit code also means no certificate was due. Certbot decides which lineages renew.
        message: code === 0 ? 'Certbot 续期检查成功；请查看证书有效期确认是否实际更换。' :
          'Certbot 续期失败；请检查客户机中的 Certbot 日志与验证方式。',
        output: `${result.stdout}${result.stderr ? '\n' + result.stderr : ''}`.slice(0, 8000) };
    } catch (error) {
      if (code === undefined) await this.record({ vmId: id, at, mode, status: 'failed' });
      throw error;
    }
  }

  /**
   * 入口 / Entry: AcmeRenewal.execute.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；本入口产生 `promise` 供上层消费（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; this entry produces `promise` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.machines.get`, `this.active.has`, `this.allowed`, `AbortSignal.any` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.machines.get`, `this.active.has`, `this.allowed`, `AbortSignal.any`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; mode: Attempt['mode']; signal: AbortSignal optional
   * 输出 / Returns: `promise`.
   * 副作用 / Effects: `AbortSignal.any`; `this.active.set`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.active.has(id)`; `!this.allowed()`; 异常 / errors `new AppError('证书续期服务正在关闭', 503)`; `new AppError('此实例正在执行证书续期', 409)`.
   */
  private execute(id: string, mode: Attempt['mode'], signal?: AbortSignal) {
    this.machines.get(id);
    if (this.closed) throw new AppError('证书续期服务正在关闭', 503);
    if (this.active.has(id)) throw new AppError('此实例正在执行证书续期', 409);
    if (!this.allowed()) throw new AppError('控制面锁定或数据迁移中，暂不续期', 409);
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    this.mutation(1);
    const promise = this.perform(id, mode, combined).finally(() => {
      this.active.delete(id);
      this.mutation(-1);
    });
    this.active.set(id, { promise, controller });
    return promise;
  }

  /**
   * 入口 / Entry: AcmeRenewal.run.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.check(id, signal)` / `this.save(id, value)` 供上层消费（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; this entry produces `this.check(id, signal)` / `this.save(id, value)` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `acmeInput.parse`, `this.check`, `this.save`, `this.execute` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `acmeInput.parse`, `this.check`, `this.save`, `this.execute`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `action === 'check' || value.mode === 'status'`; `value.mode === 'save'`.
   * 输入 / Inputs: id: string; input: unknown; action: 'check' | 'run'; signal: AbortSignal optional
   * 输出 / Returns: `this.check(id, signal)`; `this.save(id, value)`; `this.execute(id, value.mode === 'dry-run' ? 'dry-run' : 'manual', signal)`.
   * 副作用 / Effects: `this.save`; `this.execute`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async run(id: string, input: unknown, action: 'check' | 'run', signal?: AbortSignal) {
    const value = acmeInput.parse(input);
    if (action === 'check' || value.mode === 'status') return this.check(id, signal);
    if (value.mode === 'save') return this.save(id, value);
    return this.execute(id, value.mode === 'dry-run' ? 'dry-run' : 'manual', signal);
  }

  /**
   * 入口 / Entry: AcmeRenewal.tick.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.ticking || Promise.resolve()` / `task` 供上层消费（`AcmeRenewal`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AcmeRenewal`; this entry produces `this.ticking || Promise.resolve()` / `task` for its caller. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `Promise.resolve`, `inline().finally`, `inline` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.resolve`, `inline().finally`, `inline`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed || this.ticking`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.ticking || Promise.resolve()`; `task`.
   * 副作用 / Effects: 更新 / updates `this.ticking`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  tick() {
    if (this.closed || this.ticking) return this.ticking || Promise.resolve();
    /**
     * 入口 / Entry: AcmeRenewal.tick.callback@190.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const task = (async () => {
      if (!this.allowed()) return;
      if (this.state.policies.some((item) => !this.machines.records.has(item.vmId)))
        await this.change((state) => {
          state.policies = state.policies.filter((item) => this.machines.records.has(item.vmId));
        });
      const due = this.state.policies.filter((item) => item.enabled &&
        item.nextAttemptAt <= this.now() && !this.active.has(item.vmId));
      await Promise.allSettled(due.map(async (item) => {
        if (!this.machines.records.has(item.vmId) ||
            this.machines.state(item.vmId) !== 'running') return;
        await this.execute(item.vmId, 'scheduled');
      }));
    })().finally(() => { if (this.ticking === task) this.ticking = undefined; });
    this.ticking = task;
    return task;
  }

  /**
   * 入口 / Entry: AcmeRenewal.close.
   * 功能：在保存实例证书续期策略并调度客户机 Certbot中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`AcmeRenewal`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AcmeRenewal`; the outcome is recorded in `this.closed`. Module context: Stores VM certificate renewal policies and schedules guest Certbot runs; policies cannot change while renewal runs.
   * 处理：通过 `this.active.values`, `item.controller.abort`, `this.timer.close`, `this.ticking.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.active.values`, `item.controller.abort`, `this.timer.close`, `this.ticking.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `item.controller.abort`; `this.timer.close`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    for (const item of this.active.values()) item.controller.abort();
    await this.timer?.close();
    await this.ticking?.catch(() => {});
    await Promise.allSettled([...this.active.values()].map((item) => item.promise));
    await this.writes;
  }
}

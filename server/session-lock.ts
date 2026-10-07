/**
 * 模块职责：管理会话锁配置、活动期限与解锁，锁定代次变化使原授权操作失效。
 * Module purpose: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import type { SessionLockView } from '../shared/session-lock.ts';
import { rejectOperationBeforeEffect } from './operation-execution.ts';

const password = z.string().max(256);
export const sessionLockConfiguration = z
  .object({
    enabled: z.boolean(),
    idleMinutes: z.number().int().min(1).max(240),
    password: password.default(''),
    newPassword: z.string().min(12).max(256).optional(),
  })
  .strict();
export const sessionUnlockRequest = z.object({ password }).strict();
const stored = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    idleMinutes: z.number().int().min(1).max(240),
    credential: z
      .object({ salt: z.string().regex(/^[a-f0-9]{64}$/), hash: z.string().regex(/^[a-f0-9]{128}$/) })
      .strict()
      .optional(),
    failures: z.number().int().min(0).max(5),
    blockedUntil: z.number().finite().nonnegative(),
  })
  .strict()
  .refine((value) => !value.enabled || !!value.credential);
type State = z.infer<typeof stored>;
/**
 * 入口 / Entry: derive.
 * 功能：从当前输入或状态计算 `new Promise<Buffer>((resolve, reject) => scrypt( text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<Buffer>((resolve, reject) => scrypt( text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: text: string; salt: string
 * 输出 / Returns: `new Promise<Buffer>((resolve, reject) => scrypt( text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const derive = (text: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      text,
      Buffer.from(salt, 'hex'),
      64,
      { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 ** 2 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
/**
 * 入口 / Entry: rejectUnlock.
 * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`session-lock.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `session-lock.ts`; the calls and state transitions below complete the operation. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
 * 处理：通过 `rejectOperationBeforeEffect` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `rejectOperationBeforeEffect`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `error !== null && typeof error === 'object'`.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: never.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `error`.
 */
const rejectUnlock = (error: unknown): never => {
  if (error !== null && typeof error === 'object')
    rejectOperationBeforeEffect(error, ['core.session.unlock']);
  throw error;
};
export class SessionLock {
  private state: State = { version: 1, enabled: false, idleMinutes: 15, failures: 0, blockedUntil: 0 };
  private locked = false;
  private reason?: SessionLockView['reason'];
  private lastActivity = 0;
  private generation = 0;
  private busy = false;
  private closed = false;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<unknown>;
  /**
   * 入口 / Entry: SessionLock.constructor.
   * 功能：建立 SessionLock 的管理会话锁配置、活动期限与解锁上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the SessionLock context for this module's responsibility: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: changed: (locked: boolean, transitioned: boolean) => void default=() => {}; file: default=join(DATA, 'session-lock.json'); now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(
    private changed: (locked: boolean, transitioned: boolean) => void = () => {},
    private file = join(DATA, 'session-lock.json'),
    private now = Date.now,
  ) {}
  /**
   * 入口 / Entry: SessionLock.init.
   * 功能：在管理会话锁配置、活动期限与解锁中，初始化并核对当前领域状态；处理结果记录到 `this.state`, `this.lastActivity`, `this.locked`（`SessionLock`）。
   * Purpose: Initializes and verifies current domain state in `SessionLock`; the outcome is recorded in `this.state`, `this.lastActivity`, `this.locked`. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `stored.parse`, `readStore`, `this.now`, `setInterval` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stored.parse`, `readStore`, `this.now`, `setInterval`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.enabled`; `schedule`.
   * 输入 / Inputs: schedule: default=true
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `setInterval`; 更新 / updates `this.state`, `this.lastActivity`, `this.locked`, `this.reason`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('会话锁配置读取失败，控制服务未开放；请检查本地配置或恢复备份。', 503)`.
   * 失败处理：catch 分支执行 `throw new AppError('会话锁配置读取失败，控制服务未开放；请检查本地配置或恢复备份。', 503);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('会话锁配置读取失败，控制服务未开放；请检查本地配置或恢复备份。', 503);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async init(schedule = true) {
    try {
      this.state = stored.parse(await readStore(this.file, () => this.state));
    } catch {
      throw new AppError('会话锁配置读取失败，控制服务未开放；请检查本地配置或恢复备份。', 503);
    }
    this.lastActivity = this.now();
    if (this.state.enabled) {
      this.locked = true;
      this.reason = 'startup';
    }
    if (schedule) {
      this.timer = setInterval(() => this.checkIdle(), 1000);
      this.timer.unref();
    }
  }
  /**
   * 入口 / Entry: SessionLock.checkIdle.
   * 功能：在管理会话锁配置、活动期限与解锁中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SessionLock`）。
   * Purpose: Checks admission, input or resource ownership in `SessionLock`; the calls and state transitions below complete the operation. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.now`, `this.setLocked` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `this.setLocked`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.state.enabled && !this.locked && (now < this.lastActivity || now - this.lastActivity >= this.st…`.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.setLocked`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private checkIdle() {
    const now = this.now();
    if (
      this.state.enabled &&
      !this.locked &&
      (now < this.lastActivity || now - this.lastActivity >= this.state.idleMinutes * 60000)
    )
      this.setLocked('idle');
  }
  /**
   * 入口 / Entry: SessionLock.setLocked.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; this entry produces `void` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.changed` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.changed`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.locked`; `reason === 'manual'`.
   * 输入 / Inputs: reason: NonNullable<SessionLockView['reason']>
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 更新 / updates `this.locked`, `this.reason`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private setLocked(reason: NonNullable<SessionLockView['reason']>) {
    if (this.locked) {
      if (reason === 'manual') this.generation++;
      return;
    }
    this.locked = true;
    this.reason = reason;
    this.generation++;
    this.changed(true, true);
  }
  /**
   * 入口 / Entry: SessionLock.view.
   * 功能：在管理会话锁配置、活动期限与解锁中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ configured: !!this.state.credential, enabled: this.state.enabled, locked: this.locked, idleMinutes: this.state.idleMinutes,…` 供上层消费（`SessionLock`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `SessionLock`; this entry produces `{ configured: !!this.state.credential, enabled: this.state.enabled, locked: this.locked, idleMinutes: this.state.idleMinutes,…` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.checkIdle`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.checkIdle`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: SessionLockView；结果来自 / values from `{ configured: !!this.state.credential, enabled: this.state.enabled, locked: this.locked, idleMinutes: this.state.idleMinutes,…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  view(): SessionLockView {
    this.checkIdle();
    return {
      configured: !!this.state.credential,
      enabled: this.state.enabled,
      locked: this.locked,
      idleMinutes: this.state.idleMinutes,
      ...(this.state.enabled && !this.locked
        ? { expiresAt: this.lastActivity + this.state.idleMinutes * 60000 }
        : {}),
      reason: this.reason,
      retryAfterSeconds: Math.max(0, Math.ceil((this.state.blockedUntil - this.now()) / 1000)),
    };
  }
  /**
   * 入口 / Entry: SessionLock.getGeneration.
   * 功能：从当前输入或状态计算 `this.generation`，供调用方后续验证或使用。
   * Purpose: Computes `this.generation` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.generation`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  getGeneration() { return this.generation; }
  /**
   * 入口 / Entry: SessionLock.requireUnlocked.
   * 功能：在管理会话锁配置、活动期限与解锁中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`SessionLock`）。
   * Purpose: Checks admission, input or resource ownership in `SessionLock`; the calls and state transitions below complete the operation. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.checkIdle` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.checkIdle`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `this.locked`; 异常 / errors `new AppError('会话服务正在关闭', 503)`; `new AppError('控制面已锁定，请解锁后重新操作', 423, 'SESSION_LOCKED')`.
   */
  requireUnlocked() {
    if (this.closed) throw new AppError('会话服务正在关闭', 503);
    this.checkIdle();
    if (this.locked) throw new AppError('控制面已锁定，请解锁后重新操作', 423, 'SESSION_LOCKED');
  }
  /**
   * 入口 / Entry: SessionLock.activity.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view()` 供上层消费（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; this entry produces `this.view()` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.requireUnlocked`, `this.now`, `this.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireUnlocked`, `this.now`, `this.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.view()`.
   * 副作用 / Effects: 更新 / updates `this.lastActivity`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  activity() {
    this.requireUnlocked();
    this.lastActivity = this.now();
    return this.view();
  }
  /**
   * 入口 / Entry: SessionLock.lock.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.view()` 供上层消费（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; this entry produces `this.view()` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.setLocked`, `this.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.setLocked`, `this.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.view()`.
   * 副作用 / Effects: `this.setLocked`.
   * 拒绝 / Refusals: 条件 / conditions `this.closed`; `!this.state.enabled`; 异常 / errors `new AppError('会话服务正在关闭', 503)`; `new AppError('请先启用会话自动锁定', 409)`.
   */
  lock() {
    if (this.closed) throw new AppError('会话服务正在关闭', 503);
    if (!this.state.enabled) throw new AppError('请先启用会话自动锁定', 409);
    this.setLocked('manual');
    return this.view();
  }
  /**
   * 入口 / Entry: SessionLock.exclusive.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；本入口产生 `Promise.reject(new AppError('会话服务正在关闭', 503))` / `Promise.reject(new AppError('正在验证会话，请稍后再试', 429))` 供上层消费（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; this entry produces `Promise.reject(new AppError('会话服务正在关闭', 503))` / `Promise.reject(new AppError('正在验证会话，请稍后再试', 429))` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `Promise.reject`, `work().finally`, `work` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.reject`, `work().finally`, `work`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `this.closed`; `this.busy`.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `Promise.reject(new AppError('会话服务正在关闭', 503))`; `Promise.reject(new AppError('正在验证会话，请稍后再试', 429))`; `pending`.
   * 副作用 / Effects: 更新 / updates `this.busy`, `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private exclusive<T>(work: () => Promise<T>) {
    if (this.closed) return Promise.reject(new AppError('会话服务正在关闭', 503));
    if (this.busy) return Promise.reject(new AppError('正在验证会话，请稍后再试', 429));
    this.busy = true;
    const pending = work().finally(() => {
      this.busy = false;
      this.pending = undefined;
    });
    this.pending = pending;
    return pending;
  }
  /**
   * 入口 / Entry: SessionLock.verify.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；处理结果记录到 `this.state`（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; the outcome is recorded in `this.state`. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `this.now`, `derive`, `timingSafeEqual`, `key.fill` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `derive`, `timingSafeEqual`, `key.fill`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: text: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `!this.state.credential`; `this.now() < this.state.blockedUntil`; `!valid`; 异常 / errors `new AppError('尚未设置解锁密码', 409)`; `new AppError('尝试过多，请在一分钟冷却结束后重试', 429, 'SESSION_RATE_LIMITED')`.
   */
  private async verify(text: string) {
    if (!this.state.credential) throw new AppError('尚未设置解锁密码', 409);
    if (this.now() < this.state.blockedUntil)
      throw new AppError('尝试过多，请在一分钟冷却结束后重试', 429, 'SESSION_RATE_LIMITED');
    const key = await derive(text, this.state.credential.salt);
    const valid = timingSafeEqual(key, Buffer.from(this.state.credential.hash, 'hex'));
    key.fill(0);
    if (!valid) {
      const failures =
        (this.state.blockedUntil && this.now() >= this.state.blockedUntil ? 0 : this.state.failures) + 1;
      const next = {
        ...this.state,
        failures: Math.min(5, failures),
        blockedUntil: failures >= 5 ? this.now() + 60000 : 0,
      };
      this.state = next;
      await writeStore(this.file, next);
      throw new AppError('解锁密码不正确', 403, 'SESSION_PASSWORD_INVALID');
    }
  }
  /**
   * 入口 / Entry: SessionLock.configure.
   * 功能：在管理会话锁配置、活动期限与解锁中，校验并提交领域状态变更；本入口产生 `this.exclusive(async () => { this.requireUnlocked(); const generation = this.generation; if (this.state.credential) await thi…` 供上层消费（`SessionLock`）。
   * Purpose: Validates and commits a domain state change in `SessionLock`; this entry produces `this.exclusive(async () => { this.requireUnlocked(); const generation = this.generation; if (this.state.credential) await thi…` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `sessionLockConfiguration.parse`, `this.exclusive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sessionLockConfiguration.parse`, `this.exclusive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.exclusive(async () => { this.requireUnlocked(); const generation = this.generation; if (this.state.credential) await thi…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  configure(input: unknown) {
    const value = sessionLockConfiguration.parse(input);
    /**
     * 入口 / Entry: SessionLock.configure.callback@167.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `credential`, `this.state`, `this.lastActivity`.
     * 拒绝 / Refusals: 条件 / conditions `value.enabled && !credential`; `generation !== this.generation`; 异常 / errors `new AppError('首次启用需要至少 12 个字符的解锁密码')`; `new AppError('会话状态已变化，请重新操作', 409)`.
     */
    return this.exclusive(async () => {
      this.requireUnlocked();
      const generation = this.generation;
      if (this.state.credential) await this.verify(value.password);
      let credential = this.state.credential;
      if (value.newPassword !== undefined) {
        const salt = randomBytes(32).toString('hex'),
          key = await derive(value.newPassword, salt);
        credential = { salt, hash: key.toString('hex') };
        key.fill(0);
      }
      if (value.enabled && !credential) throw new AppError('首次启用需要至少 12 个字符的解锁密码');
      this.requireUnlocked();
      if (generation !== this.generation) throw new AppError('会话状态已变化，请重新操作', 409);
      const next: State = {
        version: 1,
        enabled: value.enabled,
        idleMinutes: value.idleMinutes,
        credential,
        failures: 0,
        blockedUntil: 0,
      };
      await writeStore(this.file, next);
      this.state = next;
      // An idle/manual lock admitted during the durable write remains locked until a fresh proof.
      if (!this.locked) this.lastActivity = this.now();
      this.changed(this.locked, false);
      return this.view();
    });
  }
  /**
   * 入口 / Entry: SessionLock.unlock.
   * 功能：在管理会话锁配置、活动期限与解锁中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.exclusive(async () => { const generation = this.generation; await this.verify(value.password); const next = { ...this.st…` 供上层消费（`SessionLock`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `SessionLock`; this entry produces `this.exclusive(async () => { const generation = this.generation; await this.verify(value.password); const next = { ...this.st…` for its caller. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `sessionUnlockRequest.parse`, `rejectUnlock`, `this.exclusive().catch`, `this.exclusive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `sessionUnlockRequest.parse`, `rejectUnlock`, `this.exclusive().catch`, `this.exclusive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.exclusive(async () => { const generation = this.generation; await this.verify(value.password); const next = { ...this.st…`.
   * 副作用 / Effects: 更新 / updates `value`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `rejectUnlock(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `rejectUnlock(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  unlock(input: unknown) {
    let value: z.infer<typeof sessionUnlockRequest>;
    try { value = sessionUnlockRequest.parse(input); }
    catch (error) { rejectUnlock(error); }
    let effectStarted = false;
    /**
     * 入口 / Entry: SessionLock.unlock.callback@202.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`, `effectStarted`, `this.locked`, `this.reason`.
     * 拒绝 / Refusals: 条件 / conditions `this.closed || generation !== this.generation`; 异常 / errors `new AppError('会话状态已变化，请重新解锁', 409)`.
     */
    return this.exclusive(async () => {
      const generation = this.generation;
      await this.verify(value.password);
      const next = { ...this.state, failures: 0, blockedUntil: 0 };
      await writeStore(this.file, next);
      this.state = next;
      if (this.closed || generation !== this.generation)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      const transitioned = this.locked;
      // Failed proof/cooldown bookkeeping is auxiliary. The requested unlock
      // starts here; callback/response failures after it remain unconfirmed.
      effectStarted = true;
      this.locked = false;
      this.reason = undefined;
      this.lastActivity = this.now();
      if (transitioned) this.generation++;
      this.changed(false, transitioned);
      return this.view();
    }).catch((error) => {
      if (!effectStarted) rejectUnlock(error);
      throw error;
    });
  }
  /**
   * 入口 / Entry: SessionLock.unlockWithPasskey.
   * 功能：把本层请求转交 `this.exclusive`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.exclusive` and propagates the provider result or rejection.
   * 输入 / Inputs: expectedGeneration: number
   * 输出 / Returns: `this.exclusive(async () => { if (!this.state.enabled || !this.locked || this.generation !== expectedGeneration) throw new App…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  unlockWithPasskey(expectedGeneration: number) {
    /**
     * 入口 / Entry: SessionLock.unlockWithPasskey.callback@226.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.exclusive）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.exclusive).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.view()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`, `this.locked`, `this.reason`, `this.lastActivity`.
     * 拒绝 / Refusals: 条件 / conditions `!this.state.enabled || !this.locked || this.generation !== expectedGeneration`; `this.closed || !this.locked || this.generation !== expectedGeneration`; 异常 / errors `new AppError('会话状态已变化，请重新解锁', 409)`.
     */
    return this.exclusive(async () => {
      if (!this.state.enabled || !this.locked || this.generation !== expectedGeneration)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      const next = { ...this.state, failures: 0, blockedUntil: 0 };
      await writeStore(this.file, next);
      this.state = next;
      if (this.closed || !this.locked || this.generation !== expectedGeneration)
        throw new AppError('会话状态已变化，请重新解锁', 409);
      this.locked = false;
      this.reason = undefined;
      this.lastActivity = this.now();
      this.generation++;
      this.changed(false, true);
      return this.view();
    });
  }
  /**
   * 入口 / Entry: SessionLock.close.
   * 功能：在管理会话锁配置、活动期限与解锁中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`SessionLock`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `SessionLock`; the outcome is recorded in `this.closed`. Module context: Owns lock policies, idle time and unlock; lock-generation changes invalidate original operation authority.
   * 处理：通过 `clearInterval`, `this.pending.catch` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `clearInterval`, `this.pending.catch`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `clearInterval`; 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    await this.pending?.catch(() => {});
  }
}

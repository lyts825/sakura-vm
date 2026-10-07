/**
 * 模块职责：管理有期限的临时权限请求、审批及执行，操作依据原请求和当前决定。
 * Module purpose: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
 */
import type { AccessControlV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { readStore, writeStore } from './local-store.ts';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import type { Principal } from './access-control.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const operation = z.enum(['start', 'stop']);
const status = z.enum(['pending', 'approved', 'denied', 'revoked', 'claimed', 'completed', 'failed']);
const request = z.object({
  id: z.uuid(), viewerId: z.uuid(), vmId: z.uuid(), operation,
  reason: z.string().trim().min(8).max(300), status,
  createdAt: z.number().int().positive(), requestExpiresAt: z.number().int().positive(),
  approvedBy: z.uuid().optional(), approvedAt: z.number().int().positive().optional(),
  expiresAt: z.number().int().positive().optional(),
  decidedAt: z.number().int().positive().optional(),
  claimedAt: z.number().int().positive().optional(),
  finishedAt: z.number().int().positive().optional(),
  error: z.string().max(300).optional(),
}).strict();
const state = z.object({ version: z.literal(1), requests: z.array(request).max(256) }).strict();
type Request = z.infer<typeof request>;

export const jitRequestInput = z.object({
  vmId: z.uuid(), operation, reason: z.string().trim().min(8).max(300),
}).strict();
export const jitDecisionInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), minutes: z.number().int().min(1).max(60) }).strict(),
  z.object({ decision: z.literal('deny') }).strict(),
]);

/** A persisted, exact-operation, one-use approval for a scoped viewer. */
export class JitPrivileges {
  private requests: Request[] = [];
  private pending = Promise.resolve();
  private closed = false;

  /**
   * 入口 / Entry: JitPrivileges.constructor.
   * 功能：建立 JitPrivileges 的管理有期限的临时权限请求、审批及执行上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the JitPrivileges context for this module's responsibility: Owns time-limited privilege requests, decisions and execution under the original request and current approval. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; machines: Machines; file: default=join(DATA, 'jit-privileges.json'); now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private access: AccessControlV1, private machines: Machines,
    private file = join(DATA, 'jit-privileges.json'), private now = Date.now) {}

  /**
   * 入口 / Entry: JitPrivileges.init.
   * 功能：在管理有期限的临时权限请求、审批及执行中，初始化并核对当前领域状态；处理结果记录到 `this.requests`（`JitPrivileges`）。
   * Purpose: Initializes and verifies current domain state in `JitPrivileges`; the outcome is recorded in `this.requests`. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `state.parse`, `readStore`, `this.requests.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `state.parse`, `readStore`, `this.requests.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.requests.map`; 更新 / updates `this.requests`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.requests.map((item) => item.id)).size !== this.requests.length`; 异常 / errors `new AppError('临时授权目录包含重复请求', 503)`.
   */
  async init() {
    this.requests = state.parse(await readStore(this.file,
      () => ({ version: 1, requests: [] }))).requests;
    if (new Set(this.requests.map((item) => item.id)).size !== this.requests.length)
      throw new AppError('临时授权目录包含重复请求', 503);
  }

  /**
   * 入口 / Entry: JitPrivileges.serial.
   * 功能：在管理有期限的临时权限请求、审批及执行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`JitPrivileges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `JitPrivileges`; this entry produces `task` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('临时授权服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: JitPrivileges.save.
   * 功能：在管理有期限的临时权限请求、审批及执行中，校验并提交领域状态变更；处理结果记录到 `this.requests`（`JitPrivileges`）。
   * Purpose: Validates and commits a domain state change in `JitPrivileges`; the outcome is recorded in `this.requests`. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: requests: Request[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.requests`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(requests: Request[]) {
    await writeStore(this.file, { version: 1, requests });
    this.requests = requests;
  }

  /**
   * 入口 / Entry: JitPrivileges.liveViewer.
   * 功能：在管理有期限的临时权限请求、审批及执行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `user` 供上层消费（`JitPrivileges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `JitPrivileges`; this entry produces `user` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `principal.vmIds.includes`, `this.access.users().find`, `this.access.users`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `principal.vmIds.includes`, `this.access.users().find`, `this.access.users`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; vmId: string
   * 输出 / Returns: `user`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `principal.role !== 'viewer' || !principal.vmIds.includes(vmId)`; `!user || principal.expiresAt <= this.now()`; 异常 / errors `new AppError('账户没有此实例权限', 403)`; `new AppError('账户已失效', 403)`.
   */
  private liveViewer(principal: Principal, vmId: string) {
    if (principal.role !== 'viewer' || !principal.vmIds.includes(vmId))
      throw new AppError('账户没有此实例权限', 403);
    const user = this.access.users().find((item) => item.id === principal.id &&
      item.role === 'viewer' && item.vmIds.includes(vmId) &&
      item.expiresAt !== null && item.expiresAt > this.now());
    if (!user || principal.expiresAt <= this.now())
      throw new AppError('账户已失效', 403);
    this.machines.get(vmId);
    return user;
  }

  /**
   * 入口 / Entry: JitPrivileges.effective.
   * 功能：从当前输入或状态计算 `{ ...item, status: ((item.status === 'pending' && item.requestExpiresAt <= this.now()) || (item.status === 'approved' && (!it…`，供调用方后续验证或使用。
   * Purpose: Computes `{ ...item, status: ((item.status === 'pending' && item.requestExpiresAt <= this.now()) || (item.status === 'approved' && (!it…` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: item: Request
   * 输出 / Returns: `{ ...item, status: ((item.status === 'pending' && item.requestExpiresAt <= this.now()) || (item.status === 'approved' && (!it…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private effective(item: Request) {
    return {
      ...item,
      status: ((item.status === 'pending' && item.requestExpiresAt <= this.now()) ||
        (item.status === 'approved' && (!item.expiresAt || item.expiresAt <= this.now())))
        ? 'expired' as const : item.status,
    };
  }

  /**
   * 入口 / Entry: JitPrivileges.list.
   * 功能：在管理有期限的临时权限请求、审批及执行中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.requests.filter((item) => principal.role === 'owner' || item.viewerId === principal.id) .map((item) => this.effective(it…` 供上层消费（`JitPrivileges`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `JitPrivileges`; this entry produces `this.requests.filter((item) => principal.role === 'owner' || item.viewerId === principal.id) .map((item) => this.effective(it…` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `this.requests.filter().map`, `this.requests.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requests.filter().map`, `this.requests.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal
   * 输出 / Returns: `this.requests.filter((item) => principal.role === 'owner' || item.viewerId === principal.id) .map((item) => this.effective(it…`.
   * 副作用 / Effects: `this.requests.filter().map`; `this.requests.filter`.
   * 拒绝 / Refusals: 条件 / conditions `!this.access.enabled`; 异常 / errors `new AppError('账户模式未启用', 409)`.
   */
  list(principal: Principal) {
    if (!this.access.enabled) throw new AppError('账户模式未启用', 409);
    return this.requests.filter((item) => principal.role === 'owner' || item.viewerId === principal.id)
      .map((item) => this.effective(item));
  }

  /**
   * 入口 / Entry: JitPrivileges.create.
   * 功能：在管理有期限的临时权限请求、审批及执行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { this.liveViewer(principal, value.vmId); if (this.requests.filter((item) => item.status === 'pending…` 供上层消费（`JitPrivileges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `JitPrivileges`; this entry produces `this.serial(async () => { this.liveViewer(principal, value.vmId); if (this.requests.filter((item) => item.status === 'pending…` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `jitRequestInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `jitRequestInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; input: unknown
   * 输出 / Returns: `this.serial(async () => { this.liveViewer(principal, value.vmId); if (this.requests.filter((item) => item.status === 'pending…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(principal: Principal, input: unknown) {
    const value = jitRequestInput.parse(input);
    /**
     * 入口 / Entry: JitPrivileges.create.callback@97.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(item)`.
     * 副作用 / Effects: `this.requests.filter`; `this.save`; 更新 / updates `retained`.
     * 拒绝 / Refusals: 条件 / conditions `this.requests.filter((item) => item.status === 'pending' && item.requestExpiresAt > this.now()).length >= 64`; `retained.length >= 256`; `drop < 0`; 异常 / errors `new AppError('待审批请求已达上限', 429)`; `new AppError('临时授权记录已达上限', 429)`.
     */
    return this.serial(async () => {
      this.liveViewer(principal, value.vmId);
      if (this.requests.filter((item) => item.status === 'pending' &&
          item.requestExpiresAt > this.now()).length >= 64)
        throw new AppError('待审批请求已达上限', 429);
      let retained = this.requests;
      if (retained.length >= 256) {
        const drop = retained.findIndex((item) => !['pending', 'approved', 'claimed']
          .includes(this.effective(item).status));
        if (drop < 0) throw new AppError('临时授权记录已达上限', 429);
        retained = retained.filter((_item, index) => index !== drop);
      }
      const item: Request = { ...value, id: randomUUID(), viewerId: principal.id,
        status: 'pending', createdAt: this.now(), requestExpiresAt: this.now() + 86_400_000 };
      await this.save([...retained, item]);
      return this.effective(item);
    });
  }

  /**
   * 入口 / Entry: JitPrivileges.decide.
   * 功能：在管理有期限的临时权限请求、审批及执行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (principal.role !== 'owner') throw new AppError('只有管理员可审批', 403); const current = this.requests.…` 供上层消费（`JitPrivileges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `JitPrivileges`; this entry produces `this.serial(async () => { if (principal.role !== 'owner') throw new AppError('只有管理员可审批', 403); const current = this.requests.…` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `jitDecisionInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `jitDecisionInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; id: string; input: unknown
   * 输出 / Returns: `this.serial(async () => { if (principal.role !== 'owner') throw new AppError('只有管理员可审批', 403); const current = this.requests.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async decide(principal: Principal, id: string, input: unknown) {
    z.uuid().parse(id);
    const value = jitDecisionInput.parse(input);
    /**
     * 入口 / Entry: JitPrivileges.decide.callback@119.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(next)`.
     * 副作用 / Effects: `this.requests.find`; `this.save`; `this.requests.map`.
     * 拒绝 / Refusals: 条件 / conditions `principal.role !== 'owner'`; `!current`; `value.decision === 'approve'`; 异常 / errors `new AppError('只有管理员可审批', 403)`; `new AppError('临时授权请求不存在', 404)`.
     */
    return this.serial(async () => {
      if (principal.role !== 'owner') throw new AppError('只有管理员可审批', 403);
      const current = this.requests.find((item) => item.id === id);
      if (!current) throw new AppError('临时授权请求不存在', 404);
      if (value.decision === 'approve') {
        if (this.effective(current).status !== 'pending')
          throw new AppError('请求不再等待审批', 409);
        const viewer = this.access.users().find((item) => item.id === current.viewerId &&
          item.role === 'viewer' && item.vmIds.includes(current.vmId) &&
          item.expiresAt !== null && item.expiresAt > this.now());
        if (!viewer) throw new AppError('申请账户已失效或实例范围已变更', 409);
        this.machines.get(current.vmId);
      } else if (current.status !== 'pending' && current.status !== 'approved') {
        throw new AppError('请求已结束', 409);
      }
      const next: Request = value.decision === 'approve'
        ? { ...current, status: 'approved', approvedBy: principal.id,
          approvedAt: this.now(), decidedAt: this.now(),
          expiresAt: Math.min(this.now() + value.minutes * 60_000,
            this.access.users().find((item) => item.id === current.viewerId)!.expiresAt!) }
        : { ...current, status: current.status === 'approved' ? 'revoked' : 'denied',
          decidedAt: this.now() };
      await this.save(this.requests.map((item) => item.id === id ? next : item));
      return this.effective(next);
    });
  }

  /**
   * 入口 / Entry: JitPrivileges.execute.
   * 功能：在管理有期限的临时权限请求、审批及执行中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.finish(id, 'completed')` 供上层消费（`JitPrivileges`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `JitPrivileges`; this entry produces `this.finish(id, 'completed')` for its caller. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial`, `this.machines.start` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`, `this.machines.start`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `claimed.operation === 'start'`.
   * 输入 / Inputs: principal: Principal; id: string
   * 输出 / Returns: `this.finish(id, 'completed')`.
   * 副作用 / Effects: `this.machines.start`; `this.machines.stop`.
   * 拒绝 / Refusals: 异常 / errors `new AppError(message, 409)`.
   * 失败处理：catch 分支执行 `const message = claimed.operation === 'start' ? '实例启动失败，请联系管理员' : '实例停止失败，请联系管理员';`; `await this.finish(id, 'failed', message);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `const message = claimed.operation === 'start' ? '实例启动失败，请联系管理员' : '实例停止失败，请联系管理员';`; `await this.finish(id, 'failed', message);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async execute(principal: Principal, id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: JitPrivileges.execute.callback@148.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `next`.
     * 副作用 / Effects: `this.requests.find`; `this.save`; `this.requests.map`.
     * 拒绝 / Refusals: 条件 / conditions `!current`; `current.viewerId !== principal.id`; `this.effective(current).status !== 'approved'`; 异常 / errors `new AppError('临时授权请求不存在', 404)`; `new AppError('不能执行其他账户的请求', 403)`.
     */
    const claimed = await this.serial(async () => {
      const current = this.requests.find((item) => item.id === id);
      if (!current) throw new AppError('临时授权请求不存在', 404);
      if (current.viewerId !== principal.id) throw new AppError('不能执行其他账户的请求', 403);
      this.liveViewer(principal, current.vmId);
      if (this.effective(current).status !== 'approved')
        throw new AppError('请求未获有效批准或已使用', 409);
      this.machines.requireUnlocked(current.vmId);
      const next: Request = { ...current, status: 'claimed', claimedAt: this.now() };
      await this.save(this.requests.map((item) => item.id === id ? next : item));
      return next;
    });
    try {
      if (claimed.operation === 'start') await this.machines.start(claimed.vmId);
      else await this.machines.stop(claimed.vmId, false);
      return this.finish(id, 'completed');
    } catch {
      const message = claimed.operation === 'start' ? '实例启动失败，请联系管理员' :
        '实例停止失败，请联系管理员';
      await this.finish(id, 'failed', message);
      throw new AppError(message, 409);
    }
  }

  /**
   * 入口 / Entry: JitPrivileges.finish.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; result: 'completed' | 'failed'; error: string optional
   * 输出 / Returns: `this.serial(async () => { const current = this.requests.find((item) => item.id === id); if (!current || current.status !== 'c…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private finish(id: string, result: 'completed' | 'failed', error?: string) {
    /**
     * 入口 / Entry: JitPrivileges.finish.callback@173.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(next)`.
     * 副作用 / Effects: `this.requests.find`; `this.save`; `this.requests.map`.
     * 拒绝 / Refusals: 条件 / conditions `!current || current.status !== 'claimed'`; 异常 / errors `new AppError('临时授权状态已变化', 409)`.
     */
    return this.serial(async () => {
      const current = this.requests.find((item) => item.id === id);
      if (!current || current.status !== 'claimed')
        throw new AppError('临时授权状态已变化', 409);
      const next: Request = { ...current, status: result, finishedAt: this.now(),
        ...(error ? { error: error.slice(0, 300) } : {}) };
      await this.save(this.requests.map((item) => item.id === id ? next : item));
      return this.effective(next);
    });
  }

  /**
   * 入口 / Entry: JitPrivileges.close.
   * 功能：在管理有期限的临时权限请求、审批及执行中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`JitPrivileges`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `JitPrivileges`; the outcome is recorded in `this.closed`. Module context: Owns time-limited privilege requests, decisions and execution under the original request and current approval.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.pending; }
}

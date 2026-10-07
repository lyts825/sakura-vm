/**
 * 模块职责：保存变更请求、审批决定与应用状态；应用前复核当前账户的审批权限。
 * Module purpose: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
 */
import type { ProjectPermissionsV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectSchema, projectVersion } from './project-config.ts';

import type { Principal } from './access-control.ts';

const status = z.enum(['pending', 'approved', 'denied', 'claimed', 'applied', 'failed']);
const change = z.object({
  id: z.uuid(), vmId: z.uuid(), projectId: projectIdSchema,
  requesterId: z.uuid(), summary: z.string().trim().min(8).max(500),
  project: projectSchema, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/),
  status, createdAt: z.number().int().positive(), expiresAt: z.number().int().positive(),
  approvedBy: z.uuid().optional(), decidedAt: z.number().int().positive().optional(),
  claimedAt: z.number().int().positive().optional(), finishedAt: z.number().int().positive().optional(),
  error: z.string().max(300).optional(),
}).strict();
const state = z.object({ version: z.literal(1), changes: z.array(change).max(256) }).strict();
type Change = z.infer<typeof change>;
export const changeRequestInput = z.object({
  vmId: z.uuid(), projectId: projectIdSchema,
  summary: change.shape.summary, project: projectSchema,
  expectedVersion: change.shape.expectedVersion,
}).strict();
export const changeDecisionInput = z.object({ decision: z.enum(['approve', 'deny']) }).strict();

/** A distinct second account must approve the exact project document before its author can apply it. */
export class ChangeApprovals {
  private changes: Change[] = [];
  private pending = Promise.resolve();
  private closed = false;

  /**
   * 入口 / Entry: ChangeApprovals.constructor.
   * 功能：建立 ChangeApprovals 的保存变更请求、审批决定与应用状态上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ChangeApprovals context for this module's responsibility: Persists change requests, decisions and application state; rechecks current approval authority before applying changes. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: permissions: ProjectPermissionsV1; workspaces: WorkspacesV1; file: default=join(DATA, 'change-approvals.json'); now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private permissions: ProjectPermissionsV1, private workspaces: WorkspacesV1,
    private file = join(DATA, 'change-approvals.json'), private now = Date.now) {}

  /**
   * 入口 / Entry: ChangeApprovals.init.
   * 功能：在保存变更请求、审批决定与应用状态中，初始化并核对当前领域状态；处理结果记录到 `this.changes`（`ChangeApprovals`）。
   * Purpose: Initializes and verifies current domain state in `ChangeApprovals`; the outcome is recorded in `this.changes`. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `state.parse`, `readStore`, `this.changes.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `state.parse`, `readStore`, `this.changes.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.changes`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.changes.map((item) => item.id)).size !== this.changes.length`; 异常 / errors `new AppError('变更审批目录包含重复记录', 503)`.
   */
  async init() {
    this.changes = state.parse(await readStore(this.file, () => ({ version: 1, changes: [] }))).changes;
    if (new Set(this.changes.map((item) => item.id)).size !== this.changes.length)
      throw new AppError('变更审批目录包含重复记录', 503);
  }

  /**
   * 入口 / Entry: ChangeApprovals.serial.
   * 功能：在保存变更请求、审批决定与应用状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`ChangeApprovals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ChangeApprovals`; this entry produces `task` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('变更审批服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: ChangeApprovals.effective.
   * 功能：在保存变更请求、审批决定与应用状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ...item, status: item.expiresAt <= this.now() && ['pending', 'approved'].includes(item.status) ? 'expired' as const : item.…` 供上层消费（`ChangeApprovals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ChangeApprovals`; this entry produces `{ ...item, status: item.expiresAt <= this.now() && ['pending', 'approved'].includes(item.status) ? 'expired' as const : item.…` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `this.now`, `inline.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `inline.includes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: item: Change
   * 输出 / Returns: `{ ...item, status: item.expiresAt <= this.now() && ['pending', 'approved'].includes(item.status) ? 'expired' as const : item.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private effective(item: Change) {
    return { ...item, status: item.expiresAt <= this.now() &&
      ['pending', 'approved'].includes(item.status) ? 'expired' as const : item.status };
  }

  /**
   * 入口 / Entry: ChangeApprovals.save.
   * 功能：在保存变更请求、审批决定与应用状态中，校验并提交领域状态变更；处理结果记录到 `this.changes`（`ChangeApprovals`）。
   * Purpose: Validates and commits a domain state change in `ChangeApprovals`; the outcome is recorded in `this.changes`. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: changes: Change[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.changes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(changes: Change[]) {
    await writeStore(this.file, { version: 1, changes });
    this.changes = changes;
  }

  /**
   * 入口 / Entry: ChangeApprovals.list.
   * 功能：在保存变更请求、审批决定与应用状态中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.changes.map((item) => this.effective(item))` / `visible` 供上层消费（`ChangeApprovals`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ChangeApprovals`; this entry produces `this.changes.map((item) => this.effective(item))` / `visible` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `this.changes.map`, `visible.push`, `this.effective`, `this.permissions.require().then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.changes.map`, `visible.push`, `this.effective`, `this.permissions.require().then`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `principal.role === 'owner'`; `item.requesterId === principal.id`; `await this.permissions.require(principal, item.vmId, item.projectId, 'approve') .then(() => true, ()…`.
   * 输入 / Inputs: principal: Principal
   * 输出 / Returns: `this.changes.map((item) => this.effective(item))`; `visible`.
   * 副作用 / Effects: `visible.push`.
   * 拒绝 / Refusals: 条件 / conditions `principal.role !== 'member'`; 异常 / errors `new AppError('账户没有变更审批权限', 403)`.
   */
  async list(principal: Principal) {
    if (principal.role === 'owner') return this.changes.map((item) => this.effective(item));
    if (principal.role !== 'member') throw new AppError('账户没有变更审批权限', 403);
    const visible: ReturnType<typeof this.effective>[] = [];
    for (const item of this.changes) {
      if (item.requesterId === principal.id) { visible.push(this.effective(item)); continue; }
      if (await this.permissions.require(principal, item.vmId, item.projectId, 'approve')
        .then(() => true, () => false)) visible.push(this.effective(item));
    }
    return visible;
  }

  /**
   * 入口 / Entry: ChangeApprovals.create.
   * 功能：在保存变更请求、审批决定与应用状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (!this.permissions.requiresApproval(value.vmId, value.projectId)) throw new AppError('此项目未启用双人变更…` 供上层消费（`ChangeApprovals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ChangeApprovals`; this entry produces `this.serial(async () => { if (!this.permissions.requiresApproval(value.vmId, value.projectId)) throw new AppError('此项目未启用双人变更…` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `changeRequestInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `changeRequestInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; input: unknown
   * 输出 / Returns: `this.serial(async () => { if (!this.permissions.requiresApproval(value.vmId, value.projectId)) throw new AppError('此项目未启用双人变更…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async create(principal: Principal, input: unknown) {
    const value = changeRequestInput.parse(input);
    /**
     * 入口 / Entry: ChangeApprovals.create.callback@83.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(item)`.
     * 副作用 / Effects: `this.save`; 更新 / updates `retained`.
     * 拒绝 / Refusals: 条件 / conditions `!this.permissions.requiresApproval(value.vmId, value.projectId)`; `projectVersion(current) !== value.expectedVersion`; `current.directory !== value.project.directory`; 异常 / errors `new AppError('此项目未启用双人变更审批', 409)`; `new AppError('项目配置已变化，请刷新后重新提交', 409)`.
     */
    return this.serial(async () => {
      if (!this.permissions.requiresApproval(value.vmId, value.projectId))
        throw new AppError('此项目未启用双人变更审批', 409);
      await this.permissions.require(principal, value.vmId, value.projectId, 'write');
      const current = await this.workspaces.projects.with(value.vmId, value.projectId,
        () => this.workspaces.config(value.vmId));
      if (projectVersion(current) !== value.expectedVersion)
        throw new AppError('项目配置已变化，请刷新后重新提交', 409);
      if (current.directory !== value.project.directory)
        throw new AppError('审批变更不能修改项目目录', 403);
      if (this.changes.filter((item) => this.effective(item).status === 'pending').length >= 64)
        throw new AppError('待审批变更已达上限', 429);
      let retained = this.changes;
      if (retained.length >= 256) {
        const drop = retained.findIndex((item) => !['pending', 'approved', 'claimed']
          .includes(this.effective(item).status));
        if (drop < 0) throw new AppError('变更审批记录已达上限', 429);
        retained = retained.filter((_item, index) => index !== drop);
      }
      const item: Change = { ...value, id: randomUUID(), requesterId: principal.id,
        status: 'pending', createdAt: this.now(), expiresAt: this.now() + 24 * 3_600_000 };
      await this.save([...retained, item]);
      return this.effective(item);
    });
  }

  /**
   * 入口 / Entry: ChangeApprovals.decide.
   * 功能：在保存变更请求、审批决定与应用状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const item = this.changes.find((entry) => entry.id === id); if (!item) throw new AppError('变更请求不存在'…` 供上层消费（`ChangeApprovals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ChangeApprovals`; this entry produces `this.serial(async () => { const item = this.changes.find((entry) => entry.id === id); if (!item) throw new AppError('变更请求不存在'…` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `changeDecisionInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `changeDecisionInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; id: string; input: unknown
   * 输出 / Returns: `this.serial(async () => { const item = this.changes.find((entry) => entry.id === id); if (!item) throw new AppError('变更请求不存在'…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async decide(principal: Principal, id: string, input: unknown) {
    z.uuid().parse(id);
    const { decision } = changeDecisionInput.parse(input);
    /**
     * 入口 / Entry: ChangeApprovals.decide.callback@112.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(next)`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!item`; `principal.id === item.requesterId`; `this.effective(item).status !== 'pending'`; 异常 / errors `new AppError('变更请求不存在', 404)`; `new AppError('申请人不能审批自己的变更', 403)`.
     */
    return this.serial(async () => {
      const item = this.changes.find((entry) => entry.id === id);
      if (!item) throw new AppError('变更请求不存在', 404);
      if (principal.id === item.requesterId)
        throw new AppError('申请人不能审批自己的变更', 403);
      await this.permissions.require(principal, item.vmId, item.projectId, 'approve');
      if (this.effective(item).status !== 'pending')
        throw new AppError('变更请求不再等待审批', 409);
      if (!this.permissions.requiresApproval(item.vmId, item.projectId))
        throw new AppError('项目审批策略已变化', 409);
      const next: Change = { ...item, status: decision === 'approve' ? 'approved' : 'denied',
        ...(decision === 'approve' ? { approvedBy: principal.id } : {}),
        decidedAt: this.now() };
      await this.save(this.changes.map((entry) => entry.id === id ? next : entry));
      return this.effective(next);
    });
  }

  /**
   * 入口 / Entry: ChangeApprovals.apply.
   * 功能：在保存变更请求、审批决定与应用状态中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.finish(id, 'applied')` 供上层消费（`ChangeApprovals`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ChangeApprovals`; this entry produces `this.finish(id, 'applied')` for its caller. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial`, `this.workspaces.projects.with` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`, `this.workspaces.projects.with`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; id: string
   * 输出 / Returns: `this.finish(id, 'applied')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `error`.
   * 失败处理：catch 分支执行 `await this.finish(id, 'failed', (error as Error).message);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `await this.finish(id, 'failed', (error as Error).message);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  async apply(principal: Principal, id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: ChangeApprovals.apply.callback@132.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `next`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!item`; `item.requesterId !== principal.id`; `this.effective(item).status !== 'approved' || !item.approvedBy || item.approvedBy === principal.id`; 异常 / errors `new AppError('变更请求不存在', 404)`; `new AppError('只有申请人可应用已批准的变更', 403)`.
     */
    const claimed = await this.serial(async () => {
      const item = this.changes.find((entry) => entry.id === id);
      if (!item) throw new AppError('变更请求不存在', 404);
      if (item.requesterId !== principal.id)
        throw new AppError('只有申请人可应用已批准的变更', 403);
      if (this.effective(item).status !== 'approved' || !item.approvedBy ||
          item.approvedBy === principal.id)
        throw new AppError('变更未获有效的第二人批准或已使用', 409);
      if (!this.permissions.requiresApproval(item.vmId, item.projectId))
        throw new AppError('项目审批策略已变化', 409);
      await this.permissions.require(principal, item.vmId, item.projectId, 'write');
      if (!await this.permissions.liveApprover(item.approvedBy, item.vmId, item.projectId))
        throw new AppError('审批账户已失效或不再具有审批权限', 409);
      const next: Change = { ...item, status: 'claimed', claimedAt: this.now() };
      await this.save(this.changes.map((entry) => entry.id === id ? next : entry));
      return next;
    });
    try {
      await this.workspaces.projects.with(claimed.vmId, claimed.projectId, () =>
        this.workspaces.save(claimed.vmId, claimed.project,
          claimed.project.directory, claimed.expectedVersion));
      return this.finish(id, 'applied');
    } catch (error) {
      await this.finish(id, 'failed', (error as Error).message);
      throw error;
    }
  }

  /**
   * 入口 / Entry: ChangeApprovals.finish.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: id: string; result: 'applied' | 'failed'; error: string optional
   * 输出 / Returns: `this.serial(async () => { const current = this.changes.find((item) => item.id === id); if (!current || current.status !== 'cl…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private finish(id: string, result: 'applied' | 'failed', error?: string) {
    /**
     * 入口 / Entry: ChangeApprovals.finish.callback@161.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.effective(next)`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!current || current.status !== 'claimed'`; 异常 / errors `new AppError('变更审批状态已变化', 409)`.
     */
    return this.serial(async () => {
      const current = this.changes.find((item) => item.id === id);
      if (!current || current.status !== 'claimed')
        throw new AppError('变更审批状态已变化', 409);
      const next: Change = { ...current, status: result, finishedAt: this.now(),
        ...(error ? { error: error.slice(0, 300) } : {}) };
      await this.save(this.changes.map((item) => item.id === id ? next : item));
      return this.effective(next);
    });
  }

  /**
   * 入口 / Entry: ChangeApprovals.close.
   * 功能：在保存变更请求、审批决定与应用状态中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`ChangeApprovals`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ChangeApprovals`; the outcome is recorded in `this.closed`. Module context: Persists change requests, decisions and application state; rechecks current approval authority before applying changes.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.pending; }
}

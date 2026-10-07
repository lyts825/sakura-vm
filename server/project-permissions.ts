/**
 * 模块职责：保存项目角色和成员授权，执行时重查当前权限并处理成员及实例撤销。
 * Module purpose: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
 */
import type { AccessControlV1, ProjectCatalogV1, WorkspacesV1 } from './service-contracts/v1.ts';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema, ProjectCatalog } from './project-catalog.ts';
import type { Principal } from './access-control.ts';
import type { VmAccess as Machines } from './vm-access.ts';

const permission = z.enum(['read', 'write', 'execute', 'approve']);
const role = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string().trim().min(1).max(64),
  permissions: z.array(permission).min(1).max(4),
}).strict();
const grant = z.object({ accountId: z.uuid(), roleId: role.shape.id }).strict();
const scopeFields = z.object({
  vmId: z.uuid(), projectId: projectIdSchema,
  roles: z.array(role).min(1).max(20),
  grants: z.array(grant).max(40),
  approvalRequired: z.boolean().default(false),
  revision: z.number().int().min(0).default(0),
}).strict();
/**
 * 入口 / Entry: callback@29.
 * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（scopeFields.superRefine）。
 * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (scopeFields.superRefine).
 * 输入 / Inputs: value; ctx
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `ctx.addIssue`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const scope = scopeFields.superRefine((value, ctx) => {
  const ids = value.roles.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', message: '角色 ID 不得重复', path: ['roles'] });
  if (new Set(value.grants.map((item) => item.accountId)).size !== value.grants.length)
    ctx.addIssue({ code: 'custom', message: '每位成员在项目中只能有一个角色', path: ['grants'] });
  for (const [index, item] of value.roles.entries()) {
    if (new Set(item.permissions).size !== item.permissions.length ||
        (!item.permissions.includes('read') && item.permissions.some((p) => p !== 'read')))
      ctx.addIssue({ code: 'custom', message: '非只读角色须包含读取权限，权限不能重复',
        path: ['roles', index, 'permissions'] });
  }
  for (const [index, item] of value.grants.entries())
    if (!ids.includes(item.roleId))
      ctx.addIssue({ code: 'custom', message: '成员引用的角色不存在', path: ['grants', index, 'roleId'] });
});
const state = z.object({ version: z.literal(1), scopes: z.array(scope).max(1000) }).strict();
export const projectPermissionInput = scopeFields.pick({ roles: true, grants: true })
  .extend({ approvalRequired: z.boolean().optional() });
export const projectPermissionDocument = scopeFields.pick({
  roles: true, grants: true, approvalRequired: true,
});
type Scope = z.infer<typeof scope>;
export type ProjectPermission = z.infer<typeof permission>;

const defaultRoles: Scope['roles'] = [
  { id: 'reader', name: '阅读者', permissions: ['read'] },
  { id: 'editor', name: '编辑者', permissions: ['read', 'write'] },
  { id: 'operator', name: '操作者', permissions: ['read', 'write', 'execute'] },
];

/** Deny-by-default project membership, checked on every member request. */
export class ProjectPermissions {
  private scopes: Scope[] = [];
  private pending = Promise.resolve();
  private closed = false;
  private catalog: ProjectCatalogV1;

  /**
   * 入口 / Entry: ProjectPermissions.constructor.
   * 功能：建立 ProjectPermissions 的保存项目角色和成员授权上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the ProjectPermissions context for this module's responsibility: Persists project roles/membership, rechecks current grants and handles member/VM revocation. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; machines: Machines; workspaces: WorkspacesV1 optional; file: default=join(DATA, 'project-permissions.json')
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.catalog`.
   */
  constructor(private access: AccessControlV1, private machines: Machines,
    private workspaces?: WorkspacesV1,
    private file = join(DATA, 'project-permissions.json')) {
    this.catalog = new ProjectCatalog(machines);
  }

  /**
   * 入口 / Entry: ProjectPermissions.init.
   * 功能：在保存项目角色和成员授权中，初始化并核对当前领域状态；处理结果记录到 `this.scopes`（`ProjectPermissions`）。
   * Purpose: Initializes and verifies current domain state in `ProjectPermissions`; the outcome is recorded in `this.scopes`. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `state.parse`, `readStore`, `this.scopes.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `state.parse`, `readStore`, `this.scopes.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.scopes`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(keys).size !== keys.length`; 异常 / errors `new AppError('项目权限目录包含重复范围', 503)`.
   */
  async init() {
    this.scopes = state.parse(await readStore(this.file, () => ({ version: 1, scopes: [] }))).scopes;
    const keys = this.scopes.map((item) => `${item.vmId}:${item.projectId}`);
    if (new Set(keys).size !== keys.length) throw new AppError('项目权限目录包含重复范围', 503);
  }

  /**
   * 入口 / Entry: ProjectPermissions.serial.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; this entry produces `task` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.pending.catch().then`, `this.pending.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.pending.catch().then`, `this.pending.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('项目权限服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: ProjectPermissions.existing.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；本入口产生 `index` 供上层消费（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; this entry produces `index` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.catalog.readCommittedList`, `this.catalog.list`, `index.projects.some` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.catalog.readCommittedList`, `this.catalog.list`, `index.projects.some`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string; committed: default=false
   * 输出 / Returns: `index`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!index.projects.some((item) => item.id === projectIdSchema.parse(projectId))`; 异常 / errors `new AppError('项目不存在', 404)`.
   */
  private async existing(vmId: string, projectId: string, committed = false) {
    const index = await (committed ? this.catalog.readCommittedList(vmId) : this.catalog.list(vmId));
    if (!index.projects.some((item) => item.id === projectIdSchema.parse(projectId)))
      throw new AppError('项目不存在', 404);
    return index;
  }

  /**
   * 入口 / Entry: ProjectPermissions.requireIsolated.
   * 功能：在保存项目角色和成员授权中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`ProjectPermissions`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectPermissions`; the calls and state transitions below complete the operation. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `Promise.all`, `index.projects.map`, `paths.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `Promise.all`, `index.projects.map`, `paths.find`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string; index: Awaited<ReturnType<ProjectCatalogV1['list']>>; committed: default=false
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.workspaces`; `conflict`; 异常 / errors `new AppError('项目工作区插件未启用', 403)`; `new AppError(`项目目录 ${selected} 与 ${conflict.directory} 重叠，不能向成员授权`, 409)`.
   */
  private async requireIsolated(vmId: string, projectId: string,
    index: Awaited<ReturnType<ProjectCatalogV1['list']>>, committed = false) {
    if (!this.workspaces) throw new AppError('项目工作区插件未启用', 403);
    const paths = await Promise.all(index.projects.map(async (item) => ({
      id: item.id,
      directory: posix.normalize((await this.workspaces!.projects.inScope(vmId, item.id,
        () => committed ? this.workspaces!.readCommittedConfig(vmId) : this.workspaces!.config(vmId))).directory).replace(/\/$/, '') || '/',
    })));
    const selected = paths.find((item) => item.id === projectId)!.directory;
    const conflict = paths.find((item) => item.id !== projectId &&
        (item.directory === selected || selected === '/' || item.directory === '/' ||
          item.directory.startsWith(selected + '/') ||
          selected.startsWith(item.directory + '/')));
    if (conflict)
      throw new AppError(`项目目录 ${selected} 与 ${conflict.directory} 重叠，不能向成员授权`, 409);
  }

  /**
   * 入口 / Entry: ProjectPermissions.view.
   * 功能：在保存项目角色和成员授权中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ vmId, projectId, ...policy, version: this.version(vmId, projectId) }` 供上层消费（`ProjectPermissions`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `ProjectPermissions`; this entry produces `{ vmId, projectId, ...policy, version: this.version(vmId, projectId) }` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.existing`, `this.scopes.find`, `this.version` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.existing`, `this.scopes.find`, `this.version`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: `{ vmId, projectId, ...policy, version: this.version(vmId, projectId) }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async view(vmId: string, projectId: string) {
    await this.existing(vmId, projectId);
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    const policy = { roles: item?.roles || defaultRoles,
      grants: item?.grants || [], approvalRequired: item?.approvalRequired || false };
    return { vmId, projectId, ...policy, version: this.version(vmId, projectId) };
  }

  /**
   * 入口 / Entry: ProjectPermissions.version.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(JSON.stringify({ vmId, projectId, revision: item?.revision || 0, roles: item?.roles || defaultRol…` 供上层消费（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; this entry produces `createHash('sha256').update(JSON.stringify({ vmId, projectId, revision: item?.revision || 0, roles: item?.roles || defaultRol…` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.scopes.find`, `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.scopes.find`, `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: `createHash('sha256').update(JSON.stringify({ vmId, projectId, revision: item?.revision || 0, roles: item?.roles || defaultRol…`.
   * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  version(vmId: string, projectId: string) {
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    return createHash('sha256').update(JSON.stringify({ vmId, projectId,
      revision: item?.revision || 0,
      roles: item?.roles || defaultRoles, grants: item?.grants || [],
      approvalRequired: item?.approvalRequired || false })).digest('hex');
  }

  /**
   * 入口 / Entry: ProjectPermissions.configure.
   * 功能：在保存项目角色和成员授权中，校验并提交领域状态变更；本入口产生 `this.serial(async () => { if (expectedVersion !== undefined && expectedVersion !== this.version(vmId, projectId)) throw new A…` 供上层消费（`ProjectPermissions`）。
   * Purpose: Validates and commits a domain state change in `ProjectPermissions`; this entry produces `this.serial(async () => { if (expectedVersion !== undefined && expectedVersion !== this.version(vmId, projectId)) throw new A…` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `projectPermissionInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `projectPermissionInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string; projectId: string; input: unknown; expectedVersion: string optional
   * 输出 / Returns: `this.serial(async () => { if (expectedVersion !== undefined && expectedVersion !== this.version(vmId, projectId)) throw new A…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async configure(vmId: string, projectId: string, input: unknown,
    expectedVersion?: string) {
    const value = projectPermissionInput.parse(input);
    /**
     * 入口 / Entry: ProjectPermissions.configure.callback@131.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ...next, version: this.version(vmId, projectId) }`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.scopes`.
     * 拒绝 / Refusals: 条件 / conditions `expectedVersion !== undefined && expectedVersion !== this.version(vmId, projectId)`; `value.grants.some((item) => !members.has(item.accountId))`; `scopes.length > 1000`; 异常 / errors `new AppError('项目权限已变化，请刷新后重新应用', 409)`; `new AppError('只能向现有项目成员账户授予角色', 409)`.
     */
    return this.serial(async () => {
      if (expectedVersion !== undefined && expectedVersion !== this.version(vmId, projectId))
        throw new AppError('项目权限已变化，请刷新后重新应用', 409);
      const previous = this.scopes.find((item) => item.vmId === vmId && item.projectId === projectId);
      const approvalRequired = value.approvalRequired ?? previous?.approvalRequired ?? false;
      const revision = (previous?.revision || 0) + 1;
      scope.parse({ vmId, projectId, ...value, approvalRequired, revision });
      const index = await this.existing(vmId, projectId);
      if (value.grants.length) await this.requireIsolated(vmId, projectId, index);
      const members = new Set(this.access.users().filter((item) => item.role === 'member')
        .map((item) => item.id));
      if (value.grants.some((item) => !members.has(item.accountId)))
        throw new AppError('只能向现有项目成员账户授予角色', 409);
      const next: Scope = { vmId, projectId, roles: value.roles, grants: value.grants,
        approvalRequired, revision };
      const scopes = [...this.scopes.filter((item) =>
        item.vmId !== vmId || item.projectId !== projectId), next];
      if (scopes.length > 1000) throw new AppError('项目权限范围已达上限', 409);
      await writeStore(this.file, { version: 1, scopes });
      this.scopes = scopes;
      return { ...next, version: this.version(vmId, projectId) };
    });
  }

  /**
   * 入口 / Entry: ProjectPermissions.accessible.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；本入口产生 `results` 供上层消费（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; this entry produces `results` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.access.users().some`, `this.access.users`, `item.grants.find`, `item.roles.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().some`, `this.access.users`, `item.grants.find`, `item.roles.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!entry`; `!role || !vm`; `project && await this.requireIsolated(item.vmId, item.projectId, index!) .then(() => true, () => fal…`.
   * 输入 / Inputs: principal: Principal
   * 输出 / Returns: `results`.
   * 副作用 / Effects: `results.push`.
   * 拒绝 / Refusals: 条件 / conditions `principal.role !== 'member'`; `!live`; 异常 / errors `new AppError('只有项目成员可查看此列表', 403)`; `new AppError('账户已失效', 401)`.
   */
  async accessible(principal: Principal) {
    if (principal.role !== 'member') throw new AppError('只有项目成员可查看此列表', 403);
    const live = this.access.users().some((item) => item.id === principal.id && item.role === 'member');
    if (!live) throw new AppError('账户已失效', 401);
    const results: Array<{ vmId: string; vmName: string; projectId: string; projectName: string;
      roleId: string; permissions: ProjectPermission[]; approvalRequired: boolean }> = [];
    for (const item of this.scopes) {
      const entry = item.grants.find((grant) => grant.accountId === principal.id);
      if (!entry) continue;
      const role = item.roles.find((role) => role.id === entry.roleId);
      const vm = this.machines.records.get(item.vmId);
      if (!role || !vm) continue;
      const index = await this.catalog.list(item.vmId).catch(() => null);
      const project = index?.projects.find((project) => project.id === item.projectId);
      if (project && await this.requireIsolated(item.vmId, item.projectId, index!)
        .then(() => true, () => false)) results.push({ vmId: item.vmId, vmName: vm.name,
        projectId: item.projectId, projectName: project.name,
        roleId: role.id, permissions: [...role.permissions],
        approvalRequired: item.approvalRequired });
    }
    return results;
  }

  /**
   * 入口 / Entry: ProjectPermissions.require.
   * 功能：把本层请求转交 `this.checkPermission`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.checkPermission` and propagates the provider result or rejection.
   * 输入 / Inputs: principal: Principal; vmId: string; projectId: string; required: ProjectPermission
   * 输出 / Returns: `this.checkPermission(principal, vmId, projectId, required, false)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async require(principal: Principal, vmId: string, projectId: string,
    required: ProjectPermission) {
    return this.checkPermission(principal, vmId, projectId, required, false);
  }

  /** Full role and isolation check without acquiring a metadata RMW queue in reverse order. */
  /**
   * 入口 / Entry: ProjectPermissions.requireCommitted.
   * 功能：把本层请求转交 `this.checkPermission`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.checkPermission` and propagates the provider result or rejection.
   * 输入 / Inputs: principal: Principal; vmId: string; projectId: string; required: ProjectPermission
   * 输出 / Returns: `this.checkPermission(principal, vmId, projectId, required, true)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async requireCommitted(principal: Principal, vmId: string, projectId: string,
    required: ProjectPermission) {
    return this.checkPermission(principal, vmId, projectId, required, true);
  }

  /**
   * 入口 / Entry: ProjectPermissions.checkPermission.
   * 功能：在保存项目角色和成员授权中，核对调用资格、输入或资源归属；本入口产生 `void` 供上层消费（`ProjectPermissions`）。
   * Purpose: Checks admission, input or resource ownership in `ProjectPermissions`; this entry produces `void` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.access.users().some`, `this.access.users`, `this.existing`, `this.version` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().some`, `this.access.users`, `this.existing`, `this.version`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `principal.role === 'owner'`.
   * 输入 / Inputs: principal: Principal; vmId: string; projectId: string; required: ProjectPermission; committed: boolean
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `principal.role !== 'member'`; `!live || principal.expiresAt <= Date.now()`; `!role?.permissions.includes(required)`; 异常 / errors `new AppError('账户没有项目权限', 403)`; `new AppError('账户已失效', 401)`.
   */
  private async checkPermission(principal: Principal, vmId: string, projectId: string,
    required: ProjectPermission, committed: boolean) {
    if (principal.role === 'owner') return;
    if (principal.role !== 'member') throw new AppError('账户没有项目权限', 403);
    const live = this.access.users().some((item) => item.id === principal.id && item.role === 'member');
    if (!live || principal.expiresAt <= Date.now()) throw new AppError('账户已失效', 401);
    const index = await this.existing(vmId, projectId, committed);
    const version = this.version(vmId, projectId);
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    const grant = item?.grants.find((entry) => entry.accountId === principal.id);
    const role = item?.roles.find((entry) => entry.id === grant?.roleId);
    if (!role?.permissions.includes(required)) throw new AppError('账户没有此项目操作权限', 403);
    await this.requireIsolated(vmId, projectId, index, committed);
    if (version !== this.version(vmId, projectId) || principal.expiresAt <= Date.now() ||
        !this.access.users().some((item) => item.id === principal.id && item.role === 'member'))
      throw new AppError('项目授权在校验期间已改变', 403);
  }

  /**
   * 入口 / Entry: ProjectPermissions.requiresApproval.
   * 功能：从当前输入或状态计算 `this.scopes.some((item) => item.vmId === vmId && item.projectId === projectId && item.approvalRequired)`，供调用方后续验证或使用。
   * Purpose: Computes `this.scopes.some((item) => item.vmId === vmId && item.projectId === projectId && item.approvalRequired)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: vmId: string; projectId: string
   * 输出 / Returns: `this.scopes.some((item) => item.vmId === vmId && item.projectId === projectId && item.approvalRequired)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  requiresApproval(vmId: string, projectId: string) {
    return this.scopes.some((item) => item.vmId === vmId && item.projectId === projectId &&
      item.approvalRequired);
  }

  /**
   * 入口 / Entry: ProjectPermissions.liveApprover.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；本入口产生 `false` / `true` 供上层消费（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; this entry produces `false` / `true` for its caller. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.access.users().find`, `this.access.users`, `this.require().then`, `this.require` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().find`, `this.access.users`, `this.require().then`, `this.require`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!account`; `account.role === 'owner'`; `account.role !== 'member' || (account.expiresAt && account.expiresAt <= Date.now())`.
   * 输入 / Inputs: accountId: string; vmId: string; projectId: string
   * 输出 / Returns: `false`; `true`; `this.require(principal, vmId, projectId, 'approve').then(() => true, () => false)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async liveApprover(accountId: string, vmId: string, projectId: string) {
    const account = this.access.users().find((item) => item.id === accountId);
    if (!account) return false;
    if (account.role === 'owner') return true;
    if (account.role !== 'member' || (account.expiresAt && account.expiresAt <= Date.now()))
      return false;
    const principal: Principal = { id: account.id, username: account.username,
      role: account.role, vmIds: [], expiresAt: Number.MAX_SAFE_INTEGER };
    return this.require(principal, vmId, projectId, 'approve').then(() => true, () => false);
  }

  /**
   * 入口 / Entry: ProjectPermissions.revokeMember.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; the calls and state transitions below complete the operation. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revokeMember(accountId: string) {
    await this.serial(async () => {
      const scopes = this.scopes.map((item) => ({ ...item,
        grants: item.grants.filter((grant) => grant.accountId !== accountId),
        revision: item.revision + (item.grants.some((grant) => grant.accountId === accountId) ? 1 : 0) }));
      await writeStore(this.file, { version: 1, scopes });
      this.scopes = scopes;
    });
  }

  /**
   * 入口 / Entry: ProjectPermissions.revokeVm.
   * 功能：在保存项目角色和成员授权中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`ProjectPermissions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `ProjectPermissions`; the calls and state transitions below complete the operation. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 处理：通过 `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: vmId: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revokeVm(vmId: string) {
    /**
     * 入口 / Entry: ProjectPermissions.revokeVm.callback@234.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `void`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.scopes`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    await this.serial(async () => {
      const scopes = this.scopes.filter((item) => item.vmId !== vmId);
      if (scopes.length === this.scopes.length) return;
      await writeStore(this.file, { version: 1, scopes });
      this.scopes = scopes;
    });
  }

  /**
   * 入口 / Entry: ProjectPermissions.close.
   * 功能：在保存项目角色和成员授权中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`ProjectPermissions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `ProjectPermissions`; the outcome is recorded in `this.closed`. Module context: Persists project roles/membership, rechecks current grants and handles member/VM revocation.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.pending; }
}

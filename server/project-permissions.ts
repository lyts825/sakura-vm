import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema, ProjectCatalog } from './project-catalog.ts';
import type { AccessControl, Principal } from './access-control.ts';
import type { Machines } from './machines.ts';
import type { Workspaces } from './workspaces.ts';

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
  private catalog: ProjectCatalog;

  constructor(private access: AccessControl, private machines: Machines,
    private workspaces?: Workspaces,
    private file = join(DATA, 'project-permissions.json')) {
    this.catalog = new ProjectCatalog(machines);
  }

  async init() {
    this.scopes = state.parse(await readStore(this.file, () => ({ version: 1, scopes: [] }))).scopes;
    const keys = this.scopes.map((item) => `${item.vmId}:${item.projectId}`);
    if (new Set(keys).size !== keys.length) throw new AppError('项目权限目录包含重复范围', 503);
  }

  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('项目权限服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  private async existing(vmId: string, projectId: string) {
    const index = await this.catalog.list(vmId);
    if (!index.projects.some((item) => item.id === projectIdSchema.parse(projectId)))
      throw new AppError('项目不存在', 404);
    return index;
  }

  private async requireIsolated(vmId: string, projectId: string,
    index: Awaited<ReturnType<ProjectCatalog['list']>>) {
    if (!this.workspaces) throw new AppError('项目工作区插件未启用', 403);
    const paths = await Promise.all(index.projects.map(async (item) => ({
      id: item.id,
      directory: posix.normalize((await this.workspaces!.projects.inScope(vmId, item.id,
        () => this.workspaces!.config(vmId))).directory).replace(/\/$/, '') || '/',
    })));
    const selected = paths.find((item) => item.id === projectId)!.directory;
    const conflict = paths.find((item) => item.id !== projectId &&
        (item.directory === selected || selected === '/' || item.directory === '/' ||
          item.directory.startsWith(selected + '/') ||
          selected.startsWith(item.directory + '/')));
    if (conflict)
      throw new AppError(`项目目录 ${selected} 与 ${conflict.directory} 重叠，不能向成员授权`, 409);
  }

  async view(vmId: string, projectId: string) {
    await this.existing(vmId, projectId);
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    const policy = { roles: item?.roles || defaultRoles,
      grants: item?.grants || [], approvalRequired: item?.approvalRequired || false };
    return { vmId, projectId, ...policy, version: this.version(vmId, projectId) };
  }

  version(vmId: string, projectId: string) {
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    return createHash('sha256').update(JSON.stringify({ vmId, projectId,
      revision: item?.revision || 0,
      roles: item?.roles || defaultRoles, grants: item?.grants || [],
      approvalRequired: item?.approvalRequired || false })).digest('hex');
  }

  async configure(vmId: string, projectId: string, input: unknown,
    expectedVersion?: string) {
    const value = projectPermissionInput.parse(input);
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

  async require(principal: Principal, vmId: string, projectId: string,
    required: ProjectPermission) {
    if (principal.role === 'owner') return;
    if (principal.role !== 'member') throw new AppError('账户没有项目权限', 403);
    const live = this.access.users().some((item) => item.id === principal.id && item.role === 'member');
    if (!live || principal.expiresAt <= Date.now()) throw new AppError('账户已失效', 401);
    const index = await this.existing(vmId, projectId);
    const item = this.scopes.find((entry) => entry.vmId === vmId && entry.projectId === projectId);
    const grant = item?.grants.find((entry) => entry.accountId === principal.id);
    const role = item?.roles.find((entry) => entry.id === grant?.roleId);
    if (!role?.permissions.includes(required)) throw new AppError('账户没有此项目操作权限', 403);
    await this.requireIsolated(vmId, projectId, index);
  }

  requiresApproval(vmId: string, projectId: string) {
    return this.scopes.some((item) => item.vmId === vmId && item.projectId === projectId &&
      item.approvalRequired);
  }

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

  async revokeMember(accountId: string) {
    await this.serial(async () => {
      const scopes = this.scopes.map((item) => ({ ...item,
        grants: item.grants.filter((grant) => grant.accountId !== accountId),
        revision: item.revision + (item.grants.some((grant) => grant.accountId === accountId) ? 1 : 0) }));
      await writeStore(this.file, { version: 1, scopes });
      this.scopes = scopes;
    });
  }

  async revokeVm(vmId: string) {
    await this.serial(async () => {
      const scopes = this.scopes.filter((item) => item.vmId !== vmId);
      if (scopes.length === this.scopes.length) return;
      await writeStore(this.file, { version: 1, scopes });
      this.scopes = scopes;
    });
  }

  async close() { this.closed = true; await this.pending; }
}

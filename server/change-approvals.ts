import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import { projectIdSchema } from './project-catalog.ts';
import { projectSchema, projectVersion, type Workspaces } from './workspaces.ts';
import type { Principal } from './access-control.ts';
import type { ProjectPermissions } from './project-permissions.ts';

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

  constructor(private permissions: ProjectPermissions, private workspaces: Workspaces,
    private file = join(DATA, 'change-approvals.json'), private now = Date.now) {}

  async init() {
    this.changes = state.parse(await readStore(this.file, () => ({ version: 1, changes: [] }))).changes;
    if (new Set(this.changes.map((item) => item.id)).size !== this.changes.length)
      throw new AppError('变更审批目录包含重复记录', 503);
  }

  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('变更审批服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  private effective(item: Change) {
    return { ...item, status: item.expiresAt <= this.now() &&
      ['pending', 'approved'].includes(item.status) ? 'expired' as const : item.status };
  }

  private async save(changes: Change[]) {
    await writeStore(this.file, { version: 1, changes });
    this.changes = changes;
  }

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

  async create(principal: Principal, input: unknown) {
    const value = changeRequestInput.parse(input);
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

  async decide(principal: Principal, id: string, input: unknown) {
    z.uuid().parse(id);
    const { decision } = changeDecisionInput.parse(input);
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

  async apply(principal: Principal, id: string) {
    z.uuid().parse(id);
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

  private finish(id: string, result: 'applied' | 'failed', error?: string) {
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

  async close() { this.closed = true; await this.pending; }
}

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';
import type { AccessControl, Principal } from './access-control.ts';
import type { Machines } from './machines.ts';

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

  constructor(private access: AccessControl, private machines: Machines,
    private file = join(DATA, 'jit-privileges.json'), private now = Date.now) {}

  async init() {
    this.requests = state.parse(await readStore(this.file,
      () => ({ version: 1, requests: [] }))).requests;
    if (new Set(this.requests.map((item) => item.id)).size !== this.requests.length)
      throw new AppError('临时授权目录包含重复请求', 503);
  }

  private serial<T>(work: () => Promise<T>) {
    const task = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('临时授权服务正在关闭', 503);
      return work();
    });
    this.pending = task.then(() => {}, () => {});
    return task;
  }

  private async save(requests: Request[]) {
    await writeStore(this.file, { version: 1, requests });
    this.requests = requests;
  }

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

  private effective(item: Request) {
    return {
      ...item,
      status: ((item.status === 'pending' && item.requestExpiresAt <= this.now()) ||
        (item.status === 'approved' && (!item.expiresAt || item.expiresAt <= this.now())))
        ? 'expired' as const : item.status,
    };
  }

  list(principal: Principal) {
    if (!this.access.enabled) throw new AppError('账户模式未启用', 409);
    return this.requests.filter((item) => principal.role === 'owner' || item.viewerId === principal.id)
      .map((item) => this.effective(item));
  }

  async create(principal: Principal, input: unknown) {
    const value = jitRequestInput.parse(input);
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

  async decide(principal: Principal, id: string, input: unknown) {
    z.uuid().parse(id);
    const value = jitDecisionInput.parse(input);
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

  async execute(principal: Principal, id: string) {
    z.uuid().parse(id);
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

  private finish(id: string, result: 'completed' | 'failed', error?: string) {
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

  async close() { this.closed = true; await this.pending; }
}

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { readStore, writeStore } from './local-store.ts';
import { AppError, DATA } from './model.ts';
import type { Machines } from './machines.ts';
import { projectIdSchema } from './project-catalog.ts';
import type { ProjectTerminals } from './project-terminals.ts';

const sessionId = z.string().regex(/^[a-z0-9-]{1,48}$/);
const grant = z.object({
  id: z.uuid(), vmId: z.uuid(), session: sessionId, viewerId: z.uuid(),
  projectId: projectIdSchema.optional(),
  terminalId: z.uuid().optional(),
  createdAt: z.iso.datetime(), expiresAt: z.number().int().positive(),
}).strict();
const state = z.object({ version: z.literal(1), grants: z.array(grant).max(64) }).strict();
type Grant = z.infer<typeof grant>;

export const terminalShareInput = z.object({
  vmId: z.uuid(), session: sessionId, viewerId: z.uuid(),
  projectId: projectIdSchema.optional(),
  minutes: z.number().int().min(1).max(480).default(60),
}).strict();

/** Explicit, expiring grants for read-only tmux attachments. */
export class TerminalSharing {
  private grants: Grant[] = [];
  private writes = Promise.resolve();
  private closed = false;
  private terminals?: ProjectTerminals;

  constructor(private machines: Machines,
    private file = join(DATA, 'terminal-sharing.json'), private now = Date.now) {}

  useProjectTerminals(terminals: ProjectTerminals) { this.terminals = terminals; }

  async init() {
    this.grants = state.parse(await readStore(this.file, () => ({ version: 1, grants: [] }))).grants;
    if (new Set(this.grants.map((item) => item.id)).size !== this.grants.length)
      throw new AppError('共享终端目录包含重复授权', 503);
  }

  private serial<T>(work: () => Promise<T>) {
    const operation = this.writes.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('共享终端服务正在关闭', 503);
      return work();
    });
    this.writes = operation.then(() => {}, () => {});
    return operation;
  }

  list(accountId?: string, vmId?: string, projectId?: string) {
    return this.grants.filter((item) => item.expiresAt > this.now() &&
      (!accountId || item.viewerId === accountId) && (!vmId || item.vmId === vmId) &&
      (projectId === undefined || item.projectId === projectId));
  }

  find(viewerId: string, vmId: string, session: string, projectId?: string | null) {
    return this.list(viewerId, vmId).find((item) => item.session === session &&
      item.projectId === (projectId || undefined)) || null;
  }

  async create(input: unknown) {
    const value = terminalShareInput.parse(input);
    return this.serial(async () => {
      if (this.machines.state(value.vmId) !== 'running')
        throw new AppError('请先启动实例和要共享的终端会话', 409);
      let projectId: string | undefined;
      let terminalId: string | undefined;
      if (this.terminals) ({ projectId, terminalId } = await this.terminals.validate(value.vmId, value.projectId, value.session));
      else {
        if (value.projectId) throw new AppError('项目终端服务不可用', 503);
        const name = `sakura-terminal-${value.session}`;
        const found = await this.machines.exec(value.vmId,
          `command -v tmux >/dev/null && tmux has-session -t =${name}`, 10_000);
        if (found.code !== 0)
          throw new AppError('客户机中没有运行中的 tmux 终端会话；请先打开该终端', 409);
      }
      const current = this.grants.filter((item) => item.expiresAt > this.now());
      const existing = current.find((item) => item.vmId === value.vmId &&
        item.session === value.session && item.viewerId === value.viewerId && item.projectId === projectId);
      if (!existing && current.length >= 64) throw new AppError('共享终端授权已达上限', 409);
      const next: Grant = { id: existing?.id || randomUUID(), vmId: value.vmId,
        session: value.session, viewerId: value.viewerId,
        ...(projectId ? { projectId } : {}),
        ...(terminalId ? { terminalId } : {}),
        createdAt: existing?.createdAt || new Date(this.now()).toISOString(),
        expiresAt: this.now() + value.minutes * 60_000 };
      const grants = [...current.filter((item) => item.id !== existing?.id), next];
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
      return next;
    });
  }

  async revoke(id: string) {
    z.uuid().parse(id);
    return this.serial(async () => {
      if (!this.grants.some((item) => item.id === id))
        throw new AppError('共享终端授权不存在', 404);
      const grants = this.grants.filter((item) => item.id !== id);
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
      return { revoked: id };
    });
  }

  async revokeViewer(viewerId: string) {
    return this.serial(async () => {
      const grants = this.grants.filter((item) => item.viewerId !== viewerId);
      if (grants.length === this.grants.length) return;
      await writeStore(this.file, { version: 1, grants });
      this.grants = grants;
    });
  }

  async close() { this.closed = true; await this.writes; }
}

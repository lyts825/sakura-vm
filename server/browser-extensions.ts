import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';
import type { AccessControl } from './access-control.ts';

const originSchema = z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/);
const grant = z.object({ id: z.uuid(), origin: originSchema, ownerId: z.uuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(), lastSeenAt: z.number().int().positive().optional() }).strict();
const stateSchema = z.object({ version: z.literal(1), grants: z.array(grant).max(16) }).strict();
type Grant = z.infer<typeof grant>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sameHash = (left: string, right: string) => timingSafeEqual(
  Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
const defaults = () => ({ version: 1 as const, grants: [] as Grant[] });

export const extensionCodeInput = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{12}$/),
}).strict();
export const extensionOrigin = (value: unknown) => originSchema.parse(value);

/** Owner-paired, read-only extension identities, independent of browser login sessions. */
export class BrowserExtensions {
  private grants: Grant[] = [];
  private pairing?: { codeHash: string; ownerId: string; expiresAt: number };
  private failures = new Map<string, { count: number; blockedUntil: number }>();
  private writes = Promise.resolve();
  private closed = false;

  constructor(private access: AccessControl,
    private file = join(DATA, 'browser-extensions.json'), private now = Date.now) {}

  async init() {
    this.grants = stateSchema.parse(await readStore(this.file, defaults)).grants;
    if (new Set(this.grants.map((item) => item.id)).size !== this.grants.length ||
        new Set(this.grants.map((item) => item.origin)).size !== this.grants.length)
      throw new AppError('浏览器扩展目录包含重复连接', 503);
  }

  private serial<T>(work: () => Promise<T>) {
    const task = this.writes.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('浏览器扩展服务正在关闭', 503);
      return work();
    });
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  private async save(grants: Grant[]) {
    await writeStore(this.file, { version: 1, grants });
    this.grants = grants;
  }

  private liveOwner(id: string) {
    if (!this.access.enabled || !this.access.users().some((item) =>
      item.id === id && item.role === 'owner'))
      throw new AppError('管理员账户已失效', 403);
  }

  list(ownerId: string) {
    this.liveOwner(ownerId);
    return this.grants.filter((item) => item.ownerId === ownerId)
      .map(({ tokenHash: _, ...item }) => ({ ...item,
        connected: !!item.lastSeenAt && item.lastSeenAt > this.now() - 2 * 60_000,
        expired: item.expiresAt <= this.now(), permissions: ['inventory:read'] }));
  }

  createPairing(ownerId: string) {
    this.liveOwner(ownerId);
    const code = randomBytes(9).toString('base64url');
    this.pairing = { codeHash: hash(code), ownerId, expiresAt: this.now() + 5 * 60_000 };
    return { code, expiresAt: this.pairing.expiresAt,
      permissions: ['inventory:read'] };
  }

  async connect(originValue: unknown, input: unknown) {
    const origin = extensionOrigin(originValue);
    const { code } = extensionCodeInput.parse(input);
    return this.serial(async () => {
      const failed = this.failures.get(origin);
      if (failed && failed.blockedUntil > this.now())
        throw new AppError('尝试过多，请一分钟后重试', 429);
      const pairing = this.pairing;
      const valid = pairing && pairing.expiresAt > this.now() &&
        sameHash(hash(code), pairing.codeHash);
      if (!valid) {
        const count = (failed?.blockedUntil && failed.blockedUntil <= this.now()
          ? 0 : failed?.count || 0) + 1;
        this.failures.set(origin, { count: Math.min(count, 5),
          blockedUntil: count >= 5 ? this.now() + 60_000 : 0 });
        throw new AppError('配对码无效或已过期', 403);
      }
      this.liveOwner(pairing.ownerId);
      const token = randomBytes(32).toString('hex');
      const item: Grant = { id: randomUUID(), origin, ownerId: pairing.ownerId,
        tokenHash: hash(token), createdAt: this.now(),
        expiresAt: this.now() + 30 * 86_400_000 };
      const grants = this.grants.filter((entry) => entry.origin !== origin &&
        entry.expiresAt > this.now());
      if (grants.length >= 16) throw new AppError('最多配对 16 个浏览器扩展', 409);
      await this.save([...grants, item]);
      this.pairing = undefined;
      this.failures.delete(origin);
      return { token, id: item.id, expiresAt: item.expiresAt,
        permissions: ['inventory:read'] };
    });
  }

  authorize(originValue: unknown, token: unknown) {
    const origin = extensionOrigin(originValue);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new AppError('浏览器扩展凭证无效', 401);
    const digest = hash(token);
    const item = this.grants.find((entry) => entry.origin === origin &&
      sameHash(entry.tokenHash, digest));
    if (!item || item.expiresAt <= this.now())
      throw new AppError('浏览器扩展凭证已过期或撤销', 401);
    this.liveOwner(item.ownerId);
    if (!item.lastSeenAt || item.lastSeenAt <= this.now() - 60_000) {
      const at = this.now();
      void this.serial(async () => {
        const current = this.grants.find((entry) => entry.id === item.id);
        if (current && (!current.lastSeenAt || current.lastSeenAt <= at - 60_000))
          await this.save(this.grants.map((entry) => entry.id === item.id
            ? { ...entry, lastSeenAt: at } : entry));
      }).catch(() => {});
    }
    return { id: item.id, expiresAt: item.expiresAt,
      permissions: ['inventory:read'] };
  }

  async revoke(ownerId: string, id: string) {
    z.uuid().parse(id);
    return this.serial(async () => {
      this.liveOwner(ownerId);
      if (!this.grants.some((item) => item.id === id && item.ownerId === ownerId))
        throw new AppError('浏览器扩展连接不存在', 404);
      await this.save(this.grants.filter((item) => item.id !== id));
      return { revoked: id };
    });
  }

  async revokeAll() {
    return this.serial(async () => {
      await this.save([]);
      this.pairing = undefined;
    });
  }

  async close() { this.closed = true; await this.writes; }
}

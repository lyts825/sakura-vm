import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const password = z.string().min(12).max(256);
const username = z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/);
const credential = z.object({ salt: z.string().regex(/^[a-f0-9]{64}$/),
  hash: z.string().regex(/^[a-f0-9]{128}$/) }).strict();
const account = z.object({
  id: z.uuid(), username, role: z.enum(['owner', 'viewer']), credential,
  vmIds: z.array(z.uuid()).max(32),
  expiresAt: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
}).strict();
const stateSchema = z.object({ version: z.literal(1), enabled: z.boolean(),
  accounts: z.array(account).max(41) }).strict()
  .refine((state) => !state.enabled || state.accounts.filter((item) => item.role === 'owner').length === 1,
    '启用账户模式需要且只允许一个管理员');
type State = z.infer<typeof stateSchema>;
type Account = z.infer<typeof account>;
export type Principal = Pick<Account, 'id' | 'username' | 'role' | 'vmIds'> & { expiresAt: number };

export const accessEnableInput = z.object({ password }).strict();
export const accessLoginInput = z.object({ username, password: z.string().max(256) }).strict();
export const accessViewerInput = z.object({
  username, password, vmIds: z.array(z.uuid()).min(1).max(32),
  expiresAt: z.number().int().positive(),
}).strict();
export const accessPasswordInput = z.object({ password: z.string().max(256), newPassword: password }).strict();

const defaults = (): State => ({ version: 1, enabled: false, accounts: [] });
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = (text: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
  scrypt(text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 ** 2 },
    (error, key) => error ? reject(error) : resolve(key)));
async function makeCredential(text: string) {
  const salt = randomBytes(32).toString('hex');
  const key = await derive(text, salt);
  const result = { salt, hash: key.toString('hex') };
  key.fill(0);
  return result;
}
async function matches(text: string, stored: Account['credential']) {
  const key = await derive(text, stored.salt);
  const valid = timingSafeEqual(key, Buffer.from(stored.hash, 'hex'));
  key.fill(0);
  return valid;
}

/** Opt-in host identities. No legacy controller token is accepted once enabled. */
export class AccessControl {
  private state: State = defaults();
  private sessions = new Map<string, { accountId: string; expiresAt: number }>();
  private failures = new Map<string, { count: number; blockedUntil: number }>();
  private pending = Promise.resolve();
  private closed = false;

  constructor(private file = join(DATA, 'access-control.json'), private now = Date.now) {}

  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (new Set(this.state.accounts.map((item) => item.username)).size !== this.state.accounts.length ||
        new Set(this.state.accounts.map((item) => item.id)).size !== this.state.accounts.length)
      throw new AppError('账户目录包含重复身份', 503);
  }

  get enabled() { return this.state.enabled; }
  status() { return { enabled: this.state.enabled }; }
  users() {
    return this.state.accounts.map(({ credential: _, ...item }) => item);
  }

  private serial<T>(work: () => Promise<T>) {
    const operation = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('账户服务正在关闭', 503);
      return work();
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  async enable(input: unknown) {
    const value = accessEnableInput.parse(input);
    return this.serial(async () => {
      if (this.state.enabled) throw new AppError('账户模式已启用', 409);
      const owner: Account = {
        id: randomUUID(), username: 'owner', role: 'owner',
        credential: await makeCredential(value.password), vmIds: [], expiresAt: null,
        createdAt: new Date(this.now()).toISOString(),
      };
      const next: State = { version: 1, enabled: true, accounts: [owner] };
      await writeStore(this.file, next);
      this.state = next;
      this.sessions.clear();
      return this.status();
    });
  }

  async login(input: unknown) {
    const value = accessLoginInput.parse(input);
    return this.serial(async () => {
      if (!this.state.enabled) throw new AppError('账户模式未启用', 409);
      const failed = this.failures.get(value.username);
      if (failed && failed.blockedUntil > this.now())
        throw new AppError('尝试过多，请一分钟后重试', 429);
      const user = this.state.accounts.find((item) => item.username === value.username);
      const valid = user && (!user.expiresAt || user.expiresAt > this.now()) &&
        await matches(value.password, user.credential);
      if (!valid) {
        const count = (failed?.blockedUntil && failed.blockedUntil <= this.now() ? 0 : failed?.count || 0) + 1;
        this.failures.set(value.username, { count: Math.min(count, 5),
          blockedUntil: count >= 5 ? this.now() + 60_000 : 0 });
        throw new AppError('账户或密码无效', 403);
      }
      this.failures.delete(value.username);
      const expiresAt = Math.min(this.now() + (user.role === 'owner' ? 8 : 1) * 3_600_000,
        user.expiresAt ?? Number.MAX_SAFE_INTEGER);
      const token = randomBytes(32).toString('hex');
      this.sessions.set(digest(token), { accountId: user.id, expiresAt });
      return { token, principal: this.principal(user, expiresAt) };
    });
  }

  private principal(user: Account, expiresAt: number): Principal {
    return { id: user.id, username: user.username, role: user.role,
      vmIds: [...user.vmIds], expiresAt };
  }

  authorize(value: unknown): Principal {
    if (!this.state.enabled || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
      throw new AppError('访问凭证无效，请重新登录', 401);
    const key = digest(value);
    const session = this.sessions.get(key);
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      throw new AppError('访问凭证已过期，请重新登录', 401);
    }
    const user = this.state.accounts.find((item) => item.id === session.accountId);
    if (!user || (user.expiresAt && user.expiresAt <= this.now())) {
      this.sessions.delete(key);
      throw new AppError('账户已失效，请重新登录', 401);
    }
    return this.principal(user, session.expiresAt);
  }

  logout(value: unknown) {
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
      this.sessions.delete(digest(value));
    return { ok: true };
  }

  revokeAll() { this.sessions.clear(); }

  async createViewer(input: unknown) {
    const value = accessViewerInput.parse(input);
    return this.serial(async () => {
      if (!this.state.enabled) throw new AppError('账户模式未启用', 409);
      if (value.expiresAt < this.now() + 5 * 60_000 || value.expiresAt > this.now() + 30 * 86400_000)
        throw new AppError('只读账户期限应在 5 分钟至 30 天之间');
      if (this.state.accounts.length >= 41) throw new AppError('最多保留 40 个只读账户', 409);
      if (this.state.accounts.some((item) => item.username === value.username))
        throw new AppError('账户名称已存在', 409);
      const user: Account = {
        id: randomUUID(), username: value.username, role: 'viewer',
        credential: await makeCredential(value.password), vmIds: [...new Set(value.vmIds)],
        expiresAt: value.expiresAt, createdAt: new Date(this.now()).toISOString(),
      };
      const next: State = { ...this.state, accounts: [...this.state.accounts, user] };
      await writeStore(this.file, next);
      this.state = next;
      return this.users().find((item) => item.id === user.id)!;
    });
  }

  async removeViewer(id: string) {
    z.uuid().parse(id);
    return this.serial(async () => {
      const user = this.state.accounts.find((item) => item.id === id && item.role === 'viewer');
      if (!user) throw new AppError('只读账户不存在', 404);
      const next: State = { ...this.state, accounts: this.state.accounts.filter((item) => item.id !== id) };
      await writeStore(this.file, next);
      this.state = next;
      for (const [key, session] of this.sessions)
        if (session.accountId === id) this.sessions.delete(key);
      return { removed: id };
    });
  }

  async changeOwnerPassword(input: unknown) {
    const value = accessPasswordInput.parse(input);
    return this.serial(async () => {
      const owner = this.state.accounts.find((item) => item.role === 'owner');
      if (!owner || !await matches(value.password, owner.credential))
        throw new AppError('管理员密码无效', 403);
      const replacement = await makeCredential(value.newPassword);
      const next: State = { ...this.state, accounts: this.state.accounts.map((item) => item.id === owner.id
        ? { ...item, credential: replacement } : item) };
      await writeStore(this.file, next);
      this.state = next;
      this.sessions.clear();
      return { changed: true };
    });
  }

  async close() {
    this.closed = true;
    await this.pending;
    this.sessions.clear();
  }
}

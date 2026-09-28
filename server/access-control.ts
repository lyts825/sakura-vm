import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, DATA } from './model.ts';
import { readStore, writeStore } from './local-store.ts';

const password = z.string().min(12).max(256);
const username = z.string().regex(/^[a-z][a-z0-9_-]{2,31}$/);
const credential = z.object({ salt: z.string().regex(/^[a-f0-9]{64}$/),
  hash: z.string().regex(/^[a-f0-9]{128}$/) }).strict();
const passkey = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{16,1024}$/),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{16,4096}$/),
  counter: z.number().int().nonnegative(),
  transports: z.array(z.string().min(1).max(32)).max(8),
  name: z.string().trim().min(1).max(64),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().optional(),
}).strict();
const account = z.object({
  id: z.uuid(), username, role: z.enum(['owner', 'viewer', 'member']), credential,
  vmIds: z.array(z.uuid()).max(32),
  expiresAt: z.number().int().nonnegative().nullable(),
  createdAt: z.iso.datetime(),
  passkeys: z.array(passkey).max(10).default([]),
}).strict();
const stateSchema = z.object({ version: z.literal(1), enabled: z.boolean(),
  accounts: z.array(account).max(41) }).strict()
  .refine((state) => !state.enabled || state.accounts.filter((item) => item.role === 'owner').length === 1,
    '启用账户模式需要且只允许一个管理员');
type State = z.infer<typeof stateSchema>;
type Account = z.infer<typeof account>;
export type PasskeyRecord = z.infer<typeof passkey>;
export type Principal = Pick<Account, 'id' | 'username' | 'role' | 'vmIds'> & { expiresAt: number };

export const accessEnableInput = z.object({ password }).strict();
export const accessLoginInput = z.object({ username, password: z.string().max(256) }).strict();
export const accessViewerInput = z.object({
  username, password, vmIds: z.array(z.uuid()).min(1).max(32),
  expiresAt: z.number().int().positive(),
}).strict();
export const accessMemberInput = z.object({ username, password }).strict();
export const accessPasswordInput = z.object({ password: z.string().max(256), newPassword: password }).strict();
export const accessHandoffInput = z.object({ password: z.string().max(256) }).strict();
export const accessHandoffRedeem = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{24}$/) }).strict();

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
  private sessions = new Map<string, { accountId: string; expiresAt: number; credentialId?: string }>();
  private handoffs = new Map<string, { sourceToken: string; sessionKey: string;
    accountId: string; expiresAt: number }>();
  private failures = new Map<string, { count: number; blockedUntil: number }>();
  private pending = Promise.resolve();
  private closed = false;

  constructor(private file = join(DATA, 'access-control.json'), private now = Date.now) {}

  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (new Set(this.state.accounts.map((item) => item.username)).size !== this.state.accounts.length ||
        new Set(this.state.accounts.map((item) => item.id)).size !== this.state.accounts.length ||
        new Set(this.state.accounts.flatMap((item) => item.passkeys.map((key) => key.id))).size !==
          this.state.accounts.reduce((count, item) => count + item.passkeys.length, 0))
      throw new AppError('账户目录包含重复身份', 503);
  }

  get enabled() { return this.state.enabled; }
  status() { return { enabled: this.state.enabled }; }
  users() {
    return this.state.accounts.map(({ credential: _, passkeys: __, ...item }) => item);
  }

  passkeysFor(accountId: string) {
    const user = this.state.accounts.find((item) => item.id === accountId);
    if (!user) throw new AppError('账户不存在', 404);
    return user.passkeys.map(({ publicKey: _, counter: __, transports: ___, ...item }) => item);
  }

  registeredPasskeysFor(accountId: string) {
    const user = this.state.accounts.find((item) => item.id === accountId);
    if (!user) throw new AppError('账户不存在', 404);
    return user.passkeys.map((item) => ({ ...item }));
  }

  getPasskey(id: string) {
    for (const user of this.state.accounts) {
      const key = user.passkeys.find((item) => item.id === id);
      if (key) return { user, key };
    }
    return null;
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
        createdAt: new Date(this.now()).toISOString(), passkeys: [],
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
      return this.issueSession(user);
    });
  }

  private issueSession(user: Account, credentialId?: string, notAfter = Number.MAX_SAFE_INTEGER) {
    const expiresAt = Math.min(this.now() + (user.role === 'owner' ? 8 : 1) * 3_600_000,
      user.expiresAt ?? Number.MAX_SAFE_INTEGER, notAfter);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(digest(token), { accountId: user.id, expiresAt, credentialId });
    return { token, principal: this.principal(user, expiresAt) };
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
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) {
      const sessionKey = digest(value);
      this.sessions.delete(sessionKey);
      for (const [key, handoff] of this.handoffs)
        if (handoff.sessionKey === sessionKey) this.handoffs.delete(key);
    }
    return { ok: true };
  }

  revokeAll() { this.sessions.clear(); this.handoffs.clear(); }

  async createHandoff(sourceToken: unknown) {
    return this.serial(async () => {
      const principal = this.authorize(sourceToken);
      const sessionKey = digest(sourceToken as string);
      for (const [key, handoff] of this.handoffs)
        if (handoff.expiresAt <= this.now() || handoff.sessionKey === sessionKey)
          this.handoffs.delete(key);
      if (this.handoffs.size >= 32) throw new AppError('待接收的会话交接过多，请稍后重试', 429);
      const code = randomBytes(18).toString('base64url');
      const expiresAt = Math.min(this.now() + 2 * 60_000, principal.expiresAt);
      this.handoffs.set(digest(code), { sourceToken: sourceToken as string,
        sessionKey, accountId: principal.id, expiresAt });
      return { code, expiresAt };
    });
  }

  cancelHandoff(sourceToken: unknown) {
    const principal = this.authorize(sourceToken);
    const sessionKey = digest(sourceToken as string);
    for (const [key, handoff] of this.handoffs)
      if (handoff.sessionKey === sessionKey && handoff.accountId === principal.id)
        this.handoffs.delete(key);
    return { cancelled: true };
  }

  async redeemHandoff(input: unknown) {
    const { code } = accessHandoffRedeem.parse(input);
    return this.serial(async () => {
      const key = digest(code);
      const handoff = this.handoffs.get(key);
      this.handoffs.delete(key);
      const session = handoff && this.sessions.get(handoff.sessionKey);
      const user = handoff && this.state.accounts.find((item) => item.id === handoff.accountId);
      if (!handoff || handoff.expiresAt <= this.now() || !session ||
          session.accountId !== handoff.accountId || session.expiresAt <= this.now() ||
          !user || (user.expiresAt && user.expiresAt <= this.now()))
        throw new AppError('交接码无效或已过期', 403);
      this.sessions.delete(handoff.sessionKey);
      const login = this.issueSession(user, session.credentialId, session.expiresAt);
      return { ...login, sourceToken: handoff.sourceToken };
    });
  }

  async createViewer(input: unknown) {
    const value = accessViewerInput.parse(input);
    return this.serial(async () => {
      if (!this.state.enabled) throw new AppError('账户模式未启用', 409);
      if (value.expiresAt < this.now() + 5 * 60_000 || value.expiresAt > this.now() + 30 * 86400_000)
        throw new AppError('只读账户期限应在 5 分钟至 30 天之间');
      if (this.state.accounts.length >= 41) throw new AppError('最多保留 40 个非管理员账户', 409);
      if (this.state.accounts.some((item) => item.username === value.username))
        throw new AppError('账户名称已存在', 409);
      const user: Account = {
        id: randomUUID(), username: value.username, role: 'viewer',
        credential: await makeCredential(value.password), vmIds: [...new Set(value.vmIds)],
        expiresAt: value.expiresAt, createdAt: new Date(this.now()).toISOString(), passkeys: [],
      };
      const next: State = { ...this.state, accounts: [...this.state.accounts, user] };
      await writeStore(this.file, next);
      this.state = next;
      return this.users().find((item) => item.id === user.id)!;
    });
  }

  async createMember(input: unknown) {
    const value = accessMemberInput.parse(input);
    return this.serial(async () => {
      if (!this.state.enabled) throw new AppError('账户模式未启用', 409);
      if (this.state.accounts.length >= 41) throw new AppError('最多保留 40 个非管理员账户', 409);
      if (this.state.accounts.some((item) => item.username === value.username))
        throw new AppError('账户名称已存在', 409);
      const user: Account = {
        id: randomUUID(), username: value.username, role: 'member',
        credential: await makeCredential(value.password), vmIds: [], expiresAt: null,
        createdAt: new Date(this.now()).toISOString(), passkeys: [],
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
      for (const [key, handoff] of this.handoffs)
        if (handoff.accountId === id) this.handoffs.delete(key);
      return { removed: id };
    });
  }

  async removeMember(id: string) {
    z.uuid().parse(id);
    return this.serial(async () => {
      const user = this.state.accounts.find((item) => item.id === id && item.role === 'member');
      if (!user) throw new AppError('项目成员不存在', 404);
      const next: State = { ...this.state, accounts: this.state.accounts.filter((item) => item.id !== id) };
      await writeStore(this.file, next);
      this.state = next;
      for (const [key, session] of this.sessions)
        if (session.accountId === id) this.sessions.delete(key);
      for (const [key, handoff] of this.handoffs)
        if (handoff.accountId === id) this.handoffs.delete(key);
      return { removed: id };
    });
  }

  async addPasskey(accountId: string, input: unknown) {
    const key = passkey.parse(input);
    return this.serial(async () => {
      if (this.getPasskey(key.id)) throw new AppError('通行密钥已登记', 409);
      const user = this.state.accounts.find((item) => item.id === accountId);
      if (!user || (user.expiresAt && user.expiresAt <= this.now()))
        throw new AppError('账户已失效', 401);
      if (user.passkeys.length >= 10) throw new AppError('每个账户最多登记 10 把通行密钥', 409);
      const next: State = { ...this.state, accounts: this.state.accounts.map((item) =>
        item.id === accountId ? { ...item, passkeys: [...item.passkeys, key] } : item) };
      await writeStore(this.file, next);
      this.state = next;
      return this.passkeysFor(accountId).find((item) => item.id === key.id)!;
    });
  }

  async removePasskey(accountId: string, id: string) {
    return this.serial(async () => {
      const user = this.state.accounts.find((item) => item.id === accountId);
      if (!user?.passkeys.some((item) => item.id === id))
        throw new AppError('通行密钥不存在', 404);
      const next: State = { ...this.state, accounts: this.state.accounts.map((item) =>
        item.id === accountId
          ? { ...item, passkeys: item.passkeys.filter((key) => key.id !== id) } : item) };
      await writeStore(this.file, next);
      this.state = next;
      for (const [token, session] of this.sessions)
        if (session.credentialId === id) this.sessions.delete(token);
      return { removed: id };
    });
  }

  async completePasskeyLogin(accountId: string, id: string,
    previousCounter: number, newCounter: number) {
    return this.serial(async () => {
      const user = this.state.accounts.find((item) => item.id === accountId);
      const key = user?.passkeys.find((item) => item.id === id);
      if (!user || !key || (user.expiresAt && user.expiresAt <= this.now()))
        throw new AppError('账户或通行密钥已失效', 401);
      if (key.counter !== previousCounter || newCounter < previousCounter)
        throw new AppError('通行密钥计数器已变化，请重新验证', 409);
      const next: State = { ...this.state, accounts: this.state.accounts.map((item) =>
        item.id === accountId ? { ...item, passkeys: item.passkeys.map((entry) =>
          entry.id === id ? { ...entry, counter: newCounter,
            lastUsedAt: new Date(this.now()).toISOString() } : entry) } : item) };
      await writeStore(this.file, next);
      this.state = next;
      return this.issueSession(next.accounts.find((item) => item.id === accountId)!, id);
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
      this.handoffs.clear();
      return { changed: true };
    });
  }

  async close() {
    this.closed = true;
    await this.pending;
    this.sessions.clear();
    this.handoffs.clear();
  }
}

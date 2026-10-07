/**
 * 模块职责：管理本地账户、会话、成员与登录交接凭证；授权与撤销以当前账户状态为准。
 * Module purpose: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';
import { rejectOperationBeforeEffect } from './operation-execution.ts';
import { captureOperationCheck, withOperationCheck } from './operation-context.ts';

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

/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1, enabled: false, accounts: [] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1, enabled: false, accounts: [] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: State；结果来自 / values from `({ version: 1, enabled: false, accounts: [] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = (): State => ({ version: 1, enabled: false, accounts: [] });
/**
 * 入口 / Entry: rejectLogin.
 * 功能：把本层请求转交 `rejectOperationBeforeEffect`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `rejectOperationBeforeEffect` and propagates the provider result or rejection.
 * 输入 / Inputs: error: object
 * 输出 / Returns: never；结果来自 / values from `rejectOperationBeforeEffect(error, ['core.access.login'])`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const rejectLogin = (error: object): never => rejectOperationBeforeEffect(error, ['core.access.login']);
/**
 * 入口 / Entry: digest.
 * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(token).digest('hex')` 供上层消费（`access-control.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `access-control.ts`; this entry produces `createHash('sha256').update(token).digest('hex')` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: token: string
 * 输出 / Returns: `createHash('sha256').update(token).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
/**
 * 入口 / Entry: derive.
 * 功能：从当前输入或状态计算 `new Promise<Buffer>((resolve, reject) => scrypt(text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 10…`，供调用方后续验证或使用。
 * Purpose: Computes `new Promise<Buffer>((resolve, reject) => scrypt(text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 10…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: text: string; salt: string
 * 输出 / Returns: `new Promise<Buffer>((resolve, reject) => scrypt(text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 10…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const derive = (text: string, salt: string) => new Promise<Buffer>((resolve, reject) =>
  scrypt(text, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 ** 2 },
    (error, key) => error ? reject(error) : resolve(key)));
/**
 * 入口 / Entry: makeCredential.
 * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `result` 供上层消费（`access-control.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `access-control.ts`; this entry produces `result` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
 * 处理：通过 `randomBytes().toString`, `randomBytes`, `derive`, `key.toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `randomBytes().toString`, `randomBytes`, `derive`, `key.toString`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string
 * 输出 / Returns: `result`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function makeCredential(text: string) {
  const salt = randomBytes(32).toString('hex');
  const key = await derive(text, salt);
  const result = { salt, hash: key.toString('hex') };
  key.fill(0);
  return result;
}
/**
 * 入口 / Entry: matches.
 * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `valid` 供上层消费（`access-control.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `access-control.ts`; this entry produces `valid` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
 * 处理：通过 `derive`, `timingSafeEqual`, `key.fill` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `derive`, `timingSafeEqual`, `key.fill`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: text: string; stored: Account['credential']
 * 输出 / Returns: `valid`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
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
  private sessionGeneration = 0;

  /**
   * 入口 / Entry: AccessControl.constructor.
   * 功能：建立 AccessControl 的管理本地账户、会话、成员与登录交接凭证上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the AccessControl context for this module's responsibility: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: file: default=join(DATA, 'access-control.json'); now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private file = join(DATA, 'access-control.json'), private now = Date.now) {}

  /**
   * 入口 / Entry: AccessControl.init.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，初始化并核对当前领域状态；处理结果记录到 `this.state`（`AccessControl`）。
   * Purpose: Initializes and verifies current domain state in `AccessControl`; the outcome is recorded in `this.state`. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `stateSchema.parse`, `readStore`, `this.state.accounts.map`, `this.state.accounts.flatMap` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `this.state.accounts.map`, `this.state.accounts.flatMap`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.state`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.state.accounts.map((item) => item.username)).size !== this.state.accounts.length || new Set(this.state.accounts.…`; 异常 / errors `new AppError('账户目录包含重复身份', 503)`.
   */
  async init() {
    this.state = stateSchema.parse(await readStore(this.file, defaults));
    if (new Set(this.state.accounts.map((item) => item.username)).size !== this.state.accounts.length ||
        new Set(this.state.accounts.map((item) => item.id)).size !== this.state.accounts.length ||
        new Set(this.state.accounts.flatMap((item) => item.passkeys.map((key) => key.id))).size !==
          this.state.accounts.reduce((count, item) => count + item.passkeys.length, 0))
      throw new AppError('账户目录包含重复身份', 503);
  }

  /**
   * 入口 / Entry: AccessControl.enabled.
   * 功能：向调用者提供 `this.state.enabled` 的当前视图，不复制独立的业务状态。
   * Purpose: Exposes the current `this.state.enabled` view rather than creating separate domain state.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.state.enabled`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  get enabled() { return this.state.enabled; }
  /**
   * 入口 / Entry: AccessControl.status.
   * 功能：从当前输入或状态计算 `{ enabled: this.state.enabled }`，供调用方后续验证或使用。
   * Purpose: Computes `{ enabled: this.state.enabled }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ enabled: this.state.enabled }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  status() { return { enabled: this.state.enabled }; }
  /**
   * 入口 / Entry: AccessControl.users.
   * 功能：从当前输入或状态计算 `this.state.accounts.map(({ credential: _, passkeys: __, ...item }) => item)`，供调用方后续验证或使用。
   * Purpose: Computes `this.state.accounts.map(({ credential: _, passkeys: __, ...item }) => item)` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.state.accounts.map(({ credential: _, passkeys: __, ...item }) => item)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  users() {
    return this.state.accounts.map(({ credential: _, passkeys: __, ...item }) => item);
  }

  /**
   * 入口 / Entry: AccessControl.passkeysFor.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `user.passkeys.map(({ publicKey: _, counter: __, transports: ___, ...item }) => item)` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `user.passkeys.map(({ publicKey: _, counter: __, transports: ___, ...item }) => item)` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.state.accounts.find`, `user.passkeys.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.accounts.find`, `user.passkeys.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: `user.passkeys.map(({ publicKey: _, counter: __, transports: ___, ...item }) => item)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!user`; 异常 / errors `new AppError('账户不存在', 404)`.
   */
  passkeysFor(accountId: string) {
    const user = this.state.accounts.find((item) => item.id === accountId);
    if (!user) throw new AppError('账户不存在', 404);
    return user.passkeys.map(({ publicKey: _, counter: __, transports: ___, ...item }) => item);
  }

  /**
   * 入口 / Entry: AccessControl.registeredPasskeysFor.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `user.passkeys.map((item) => ({ ...item }))` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `user.passkeys.map((item) => ({ ...item }))` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.state.accounts.find`, `user.passkeys.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.state.accounts.find`, `user.passkeys.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string
   * 输出 / Returns: `user.passkeys.map((item) => ({ ...item }))`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!user`; 异常 / errors `new AppError('账户不存在', 404)`.
   */
  registeredPasskeysFor(accountId: string) {
    const user = this.state.accounts.find((item) => item.id === accountId);
    if (!user) throw new AppError('账户不存在', 404);
    return user.passkeys.map((item) => ({ ...item }));
  }

  /**
   * 入口 / Entry: AccessControl.getPasskey.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `{ user, key }` / `null` 供上层消费（`AccessControl`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `AccessControl`; this entry produces `{ user, key }` / `null` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `user.passkeys.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `user.passkeys.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `key`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `{ user, key }`; `null`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  getPasskey(id: string) {
    for (const user of this.state.accounts) {
      const key = user.passkeys.find((item) => item.id === id);
      if (key) return { user, key };
    }
    return null;
  }

  /**
   * 入口 / Entry: AccessControl.serial.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `operation` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `operation` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `captureOperationCheck`, `this.pending.catch().then`, `this.pending.catch`, `operation.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `captureOperationCheck`, `this.pending.catch().then`, `this.pending.catch`, `operation.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `operation`.
   * 副作用 / Effects: 更新 / updates `this.pending`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const check = captureOperationCheck();
    const operation = this.pending.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('账户服务正在关闭', 503);
      await check();
      return work();
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  /**
   * 入口 / Entry: AccessControl.enable.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (this.state.enabled) throw new AppError('账户模式已启用', 409); const owner: Account = { id: randomUUID…` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { if (this.state.enabled) throw new AppError('账户模式已启用', 409); const owner: Account = { id: randomUUID…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessEnableInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessEnableInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { if (this.state.enabled) throw new AppError('账户模式已启用', 409); const owner: Account = { id: randomUUID…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async enable(input: unknown) {
    const value = accessEnableInput.parse(input);
    /**
     * 入口 / Entry: AccessControl.enable.callback@134.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.status()`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `this.state.enabled`; 异常 / errors `new AppError('账户模式已启用', 409)`.
     */
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
      this.revokeAll();
      return this.status();
    });
  }

  /**
   * 入口 / Entry: AccessControl.login.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (!this.state.enabled) rejectLogin(new AppError('账户模式未启用', 409)); const failed = this.failures.ge…` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { if (!this.state.enabled) rejectLogin(new AppError('账户模式未启用', 409)); const failed = this.failures.ge…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessLoginInput.parse`, `rejectLogin`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessLoginInput.parse`, `rejectLogin`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { if (!this.state.enabled) rejectLogin(new AppError('账户模式未启用', 409)); const failed = this.failures.ge…`.
   * 副作用 / Effects: 更新 / updates `value`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `rejectLogin(error as object);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `rejectLogin(error as object);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async login(input: unknown) {
    let value: z.infer<typeof accessLoginInput>;
    try { value = accessLoginInput.parse(input); }
    catch (error) { rejectLogin(error as object); }
    const generation = this.sessionGeneration;
    /**
     * 入口 / Entry: AccessControl.login.callback@154.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.issueSession(user!, generation)`; `rejectLogin(error as object)`.
     * 副作用 / Effects: `this.failures.set`; `this.failures.delete`; 更新 / updates `valid`.
     * 拒绝 / Refusals: 异常 / errors `error`.
     * 失败处理：catch 分支执行 `if (error !== null && typeof error === 'object') rejectLogin(error);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error !== null && typeof error === 'object') rejectLogin(error);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    return this.serial(async () => {
      if (!this.state.enabled) rejectLogin(new AppError('账户模式未启用', 409));
      const failed = this.failures.get(value.username);
      if (failed && failed.blockedUntil > this.now())
        rejectLogin(new AppError('尝试过多，请一分钟后重试', 429));
      const user = this.state.accounts.find((item) => item.username === value.username);
      let valid: boolean | undefined;
      try { valid = user && (!user.expiresAt || user.expiresAt > this.now()) &&
        await matches(value.password, user.credential); }
      catch (error) {
        // Credential derivation precedes the only requested effect: session issuance.
        if (error !== null && typeof error === 'object') rejectLogin(error);
        throw error;
      }
      if (!valid) {
        const count = (failed?.blockedUntil && failed.blockedUntil <= this.now() ? 0 : failed?.count || 0) + 1;
        this.failures.set(value.username, { count: Math.min(count, 5),
          blockedUntil: count >= 5 ? this.now() + 60_000 : 0 });
        rejectLogin(new AppError('账户或密码无效', 403));
      }
      this.failures.delete(value.username);
      try { return this.issueSession(user!, generation); }
      catch (error) { return rejectLogin(error as object); }
    });
  }

  /**
   * 入口 / Entry: AccessControl.requireSessionGeneration.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`AccessControl`）。
   * Purpose: Checks admission, input or resource ownership in `AccessControl`; the calls and state transitions below complete the operation. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 输入 / Inputs: generation: number
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `this.closed || generation !== this.sessionGeneration`; 异常 / errors `new AppError('账户会话状态已变化，请重新登录', 409, 'ACCESS_STATE_CHANGED')`.
   */
  private requireSessionGeneration(generation: number) {
    if (this.closed || generation !== this.sessionGeneration)
      throw new AppError('账户会话状态已变化，请重新登录', 409, 'ACCESS_STATE_CHANGED');
  }
  /**
   * 入口 / Entry: AccessControl.issueSession.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ token, principal: this.principal(user, expiresAt) }` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `{ token, principal: this.principal(user, expiresAt) }` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.requireSessionGeneration`, `this.now`, `randomBytes().toString`, `randomBytes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.requireSessionGeneration`, `this.now`, `randomBytes().toString`, `randomBytes`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: user: Account; generation: number; credentialId: string optional; notAfter: default=Number.MAX_SAFE_INTEGER
   * 输出 / Returns: `{ token, principal: this.principal(user, expiresAt) }`.
   * 副作用 / Effects: `this.sessions.set`.
   * 拒绝 / Refusals: 条件 / conditions `user.expiresAt !== null && user.expiresAt <= this.now()`; 异常 / errors `new AppError('账户已失效，请重新登录', 401)`.
   */
  private issueSession(user: Account, generation: number, credentialId?: string, notAfter = Number.MAX_SAFE_INTEGER) {
    this.requireSessionGeneration(generation);
    if (user.expiresAt !== null && user.expiresAt <= this.now())
      throw new AppError('账户已失效，请重新登录', 401);
    const expiresAt = Math.min(this.now() + (user.role === 'owner' ? 8 : 1) * 3_600_000,
      user.expiresAt ?? Number.MAX_SAFE_INTEGER, notAfter);
    const token = randomBytes(32).toString('hex');
    this.sessions.set(digest(token), { accountId: user.id, expiresAt, credentialId });
    return { token, principal: this.principal(user, expiresAt) };
  }
  /**
   * 入口 / Entry: AccessControl.completeFederatedLogin.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: accountId: string; credentialId: string
   * 输出 / Returns: `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); const user = this.state.accounts.find(…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async completeFederatedLogin(accountId: string, credentialId: string) {
    const generation = this.sessionGeneration;
    /**
     * 入口 / Entry: AccessControl.completeFederatedLogin.callback@196.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.issueSession(user, generation, credentialId)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `!this.state.enabled`; `!user || (user.expiresAt && user.expiresAt <= this.now())`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('关联账户已失效', 401)`.
     */
    return this.serial(async () => {
      if (!this.state.enabled) throw new AppError('账户模式未启用', 409);
      const user = this.state.accounts.find((item) => item.id === accountId);
      if (!user || (user.expiresAt && user.expiresAt <= this.now()))
        throw new AppError('关联账户已失效', 401);
      return this.issueSession(user, generation, credentialId);
    });
  }
  /**
   * 入口 / Entry: AccessControl.revokeFederatedCredential.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `removed` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `removed` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.sessions.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `session.credentialId === credentialId`.
   * 输入 / Inputs: credentialId: string
   * 输出 / Returns: `removed`.
   * 副作用 / Effects: `this.sessions.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revokeFederatedCredential(credentialId: string) {
    let removed = 0;
    for (const [token, session] of this.sessions)
      if (session.credentialId === credentialId) { this.sessions.delete(token); removed++; }
    return removed;
  }

  /**
   * 入口 / Entry: AccessControl.principal.
   * 功能：从当前输入或状态计算 `{ id: user.id, username: user.username, role: user.role, vmIds: [...user.vmIds], expiresAt }`，供调用方后续验证或使用。
   * Purpose: Computes `{ id: user.id, username: user.username, role: user.role, vmIds: [...user.vmIds], expiresAt }` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: user: Account; expiresAt: number
   * 输出 / Returns: Principal；结果来自 / values from `{ id: user.id, username: user.username, role: user.role, vmIds: [...user.vmIds], expiresAt }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  private principal(user: Account, expiresAt: number): Principal {
    return { id: user.id, username: user.username, role: user.role,
      vmIds: [...user.vmIds], expiresAt };
  }

  /**
   * 入口 / Entry: AccessControl.authorize.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，核对调用资格、输入或资源归属；本入口产生 `this.principal(user, session.expiresAt)` 供上层消费（`AccessControl`）。
   * Purpose: Checks admission, input or resource ownership in `AccessControl`; this entry produces `this.principal(user, session.expiresAt)` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `inline.test`, `digest`, `this.sessions.get`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.test`, `digest`, `this.sessions.get`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: Principal；结果来自 / values from `this.principal(user, session.expiresAt)`.
   * 副作用 / Effects: `this.sessions.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!this.state.enabled || typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)`; `!session || session.expiresAt <= this.now()`; `!user || (user.expiresAt && user.expiresAt <= this.now())`; 异常 / errors `new AppError('访问凭证无效，请重新登录', 401)`; `new AppError('访问凭证已过期，请重新登录', 401)`.
   */
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

  /**
   * 入口 / Entry: AccessControl.logout.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ok: true }` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `{ ok: true }` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `inline.test`, `digest`, `this.sessions.delete`, `this.handoffs.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.test`, `digest`, `this.sessions.delete`, `this.handoffs.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)`; `handoff.sessionKey === sessionKey`.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `{ ok: true }`.
   * 副作用 / Effects: `this.sessions.delete`; `this.handoffs.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  logout(value: unknown) {
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) {
      const sessionKey = digest(value);
      this.sessions.delete(sessionKey);
      for (const [key, handoff] of this.handoffs)
        if (handoff.sessionKey === sessionKey) this.handoffs.delete(key);
    }
    return { ok: true };
  }

  /**
   * 入口 / Entry: AccessControl.revokeAll.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; the calls and state transitions below complete the operation. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.sessions.clear`, `this.handoffs.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.sessions.clear`, `this.handoffs.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.sessions.clear`; `this.handoffs.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  revokeAll() { this.sessionGeneration++; this.sessions.clear(); this.handoffs.clear(); }

  /**
   * 入口 / Entry: AccessControl.createHandoff.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: sourceToken: unknown
   * 输出 / Returns: `this.serial(async () => { const principal = this.authorize(sourceToken); const sessionKey = digest(sourceToken as string); fo…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async createHandoff(sourceToken: unknown) {
    /**
     * 入口 / Entry: AccessControl.createHandoff.callback@246.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ code, expiresAt }`.
     * 副作用 / Effects: `this.handoffs.delete`; `this.handoffs.set`.
     * 拒绝 / Refusals: 条件 / conditions `this.handoffs.size >= 32`; 异常 / errors `new AppError('待接收的会话交接过多，请稍后重试', 429)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.cancelHandoff.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ cancelled: true }` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `{ cancelled: true }` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.authorize`, `digest`, `this.handoffs.delete` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.authorize`, `digest`, `this.handoffs.delete`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `handoff.sessionKey === sessionKey && handoff.accountId === principal.id`.
   * 输入 / Inputs: sourceToken: unknown
   * 输出 / Returns: `{ cancelled: true }`.
   * 副作用 / Effects: `this.handoffs.delete`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  cancelHandoff(sourceToken: unknown) {
    const principal = this.authorize(sourceToken);
    const sessionKey = digest(sourceToken as string);
    for (const [key, handoff] of this.handoffs)
      if (handoff.sessionKey === sessionKey && handoff.accountId === principal.id)
        this.handoffs.delete(key);
    return { cancelled: true };
  }

  /**
   * 入口 / Entry: AccessControl.redeemHandoff.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const key = digest(code); const handoff = this.handoffs.get(key); this.handoffs.delete(key); const …` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { const key = digest(code); const handoff = this.handoffs.get(key); this.handoffs.delete(key); const …` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessHandoffRedeem.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessHandoffRedeem.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { const key = digest(code); const handoff = this.handoffs.get(key); this.handoffs.delete(key); const …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async redeemHandoff(input: unknown) {
    const { code } = accessHandoffRedeem.parse(input);
    const generation = this.sessionGeneration;
    /**
     * 入口 / Entry: AccessControl.redeemHandoff.callback@273.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ...login, sourceToken: handoff.sourceToken }`.
     * 副作用 / Effects: `this.handoffs.delete`; `this.sessions.delete`.
     * 拒绝 / Refusals: 条件 / conditions `!handoff || handoff.expiresAt <= this.now() || !session || session.accountId !== handoff.accountId || session.expiresAt <= th…`; 异常 / errors `new AppError('交接码无效或已过期', 403)`.
     */
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
      const login = this.issueSession(user, generation, session.credentialId, session.expiresAt);
      return { ...login, sourceToken: handoff.sourceToken };
    });
  }

  /**
   * 入口 / Entry: AccessControl.createViewer.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (value.expiresAt < this.now() + 5 *…` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (value.expiresAt < this.now() + 5 *…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessViewerInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessViewerInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (value.expiresAt < this.now() + 5 *…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async createViewer(input: unknown) {
    const value = accessViewerInput.parse(input);
    /**
     * 入口 / Entry: AccessControl.createViewer.callback@291.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.users().find((item) => item.id === user.id)!`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!this.state.enabled`; `value.expiresAt < this.now() + 5 * 60_000 || value.expiresAt > this.now() + 30 * 86400_000`; `this.state.accounts.length >= 41`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('只读账户期限应在 5 分钟至 30 天之间')`.
     */
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

  /**
   * 入口 / Entry: AccessControl.createMember.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (this.state.accounts.length >= 41) …` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (this.state.accounts.length >= 41) …` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessMemberInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessMemberInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { if (!this.state.enabled) throw new AppError('账户模式未启用', 409); if (this.state.accounts.length >= 41) …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async createMember(input: unknown) {
    const value = accessMemberInput.parse(input);
    /**
     * 入口 / Entry: AccessControl.createMember.callback@312.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.users().find((item) => item.id === user.id)!`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!this.state.enabled`; `this.state.accounts.length >= 41`; `this.state.accounts.some((item) => item.username === value.username)`; 异常 / errors `new AppError('账户模式未启用', 409)`; `new AppError('最多保留 40 个非管理员账户', 409)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.removeViewer.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'viewer'); if (!use…` 供上层消费（`AccessControl`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AccessControl`; this entry produces `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'viewer'); if (!use…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'viewer'); if (!use…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async removeViewer(id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: AccessControl.removeViewer.callback@331.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ removed: id }`.
     * 副作用 / Effects: `writeStore`; `this.sessions.delete`; `this.handoffs.delete`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!user`; 异常 / errors `new AppError('只读账户不存在', 404)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.removeMember.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，结束、撤销或清理本次拥有的领域资源；本入口产生 `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'member'); if (!use…` 供上层消费（`AccessControl`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AccessControl`; this entry produces `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'member'); if (!use…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === id && item.role === 'member'); if (!use…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async removeMember(id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: AccessControl.removeMember.callback@347.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ removed: id }`.
     * 副作用 / Effects: `writeStore`; `this.sessions.delete`; `this.handoffs.delete`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!user`; 异常 / errors `new AppError('项目成员不存在', 404)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.addPasskey.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { if (this.getPasskey(key.id)) throw new AppError('通行密钥已登记', 409); const user = this.state.accounts.f…` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { if (this.getPasskey(key.id)) throw new AppError('通行密钥已登记', 409); const user = this.state.accounts.f…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `passkey.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `passkey.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: accountId: string; input: unknown
   * 输出 / Returns: `this.serial(async () => { if (this.getPasskey(key.id)) throw new AppError('通行密钥已登记', 409); const user = this.state.accounts.f…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async addPasskey(accountId: string, input: unknown) {
    const key = passkey.parse(input);
    /**
     * 入口 / Entry: AccessControl.addPasskey.callback@363.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.passkeysFor(accountId).find((item) => item.id === key.id)!`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `this.getPasskey(key.id)`; `!user || (user.expiresAt && user.expiresAt <= this.now())`; `user.passkeys.length >= 10`; 异常 / errors `new AppError('通行密钥已登记', 409)`; `new AppError('账户已失效', 401)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.removePasskey.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: accountId: string; id: string
   * 输出 / Returns: `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === accountId); if (!user?.passkeys.some((i…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async removePasskey(accountId: string, id: string) {
    /**
     * 入口 / Entry: AccessControl.removePasskey.callback@378.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ removed: id }`.
     * 副作用 / Effects: `writeStore`; `this.sessions.delete`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!user?.passkeys.some((item) => item.id === id)`; 异常 / errors `new AppError('通行密钥不存在', 404)`.
     */
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

  /**
   * 入口 / Entry: AccessControl.completePasskeyLogin.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: accountId: string; id: string; previousCounter: number; newCounter: number
   * 输出 / Returns: `this.serial(async () => { const user = this.state.accounts.find((item) => item.id === accountId); const key = user?.passkeys.…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async completePasskeyLogin(accountId: string, id: string,
    previousCounter: number, newCounter: number) {
    const generation = this.sessionGeneration;
    /**
     * 入口 / Entry: AccessControl.completePasskeyLogin.callback@396.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `this.issueSession(next.accounts.find((item) => item.id === accountId)!, generation, id)`.
     * 副作用 / Effects: 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!user || !key || (user.expiresAt && user.expiresAt <= this.now())`; `key.counter !== previousCounter || newCounter < previousCounter`; 异常 / errors `new AppError('账户或通行密钥已失效', 401)`; `new AppError('通行密钥计数器已变化，请重新验证', 409)`.
     */
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
      await withOperationCheck(async () => this.requireSessionGeneration(generation),
        () => writeStore(this.file, next));
      this.state = next;
      return this.issueSession(next.accounts.find((item) => item.id === accountId)!, generation, id);
    });
  }

  /**
   * 入口 / Entry: AccessControl.changeOwnerPassword.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const owner = this.state.accounts.find((item) => item.role === 'owner'); if (!owner || !await match…` 供上层消费（`AccessControl`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `AccessControl`; this entry produces `this.serial(async () => { const owner = this.state.accounts.find((item) => item.role === 'owner'); if (!owner || !await match…` for its caller. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `accessPasswordInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `accessPasswordInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.serial(async () => { const owner = this.state.accounts.find((item) => item.role === 'owner'); if (!owner || !await match…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async changeOwnerPassword(input: unknown) {
    const value = accessPasswordInput.parse(input);
    /**
     * 入口 / Entry: AccessControl.changeOwnerPassword.callback@416.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ changed: true }`.
     * 副作用 / Effects: `writeStore`; 更新 / updates `this.state`.
     * 拒绝 / Refusals: 条件 / conditions `!owner || !await matches(value.password, owner.credential)`; 异常 / errors `new AppError('管理员密码无效', 403)`.
     */
    return this.serial(async () => {
      const owner = this.state.accounts.find((item) => item.role === 'owner');
      if (!owner || !await matches(value.password, owner.credential))
        throw new AppError('管理员密码无效', 403);
      const replacement = await makeCredential(value.newPassword);
      const next: State = { ...this.state, accounts: this.state.accounts.map((item) => item.id === owner.id
        ? { ...item, credential: replacement } : item) };
      await writeStore(this.file, next);
      this.state = next;
      this.revokeAll();
      return { changed: true };
    });
  }

  /**
   * 入口 / Entry: AccessControl.close.
   * 功能：在管理本地账户、会话、成员与登录交接凭证中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`AccessControl`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `AccessControl`; the outcome is recorded in `this.closed`. Module context: Owns local accounts, sessions, members and login handoffs; authorization and revocation use current account state.
   * 处理：通过 `this.revokeAll` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.revokeAll`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async close() {
    this.closed = true;
    this.revokeAll();
    await this.pending;
  }
}

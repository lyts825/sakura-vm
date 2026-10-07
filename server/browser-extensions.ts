/**
 * 模块职责：管理浏览器扩展配对码和连接凭证；检查扩展来源、管理员身份与尝试频率。
 * Module purpose: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
 */
import type { AccessControlV1 } from './service-contracts/v1.ts';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { DATA } from './paths.ts';
import { readStore, writeStore } from './local-store.ts';

const originSchema = z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/);
const grant = z.object({ id: z.uuid(), origin: originSchema, ownerId: z.uuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(), lastSeenAt: z.number().int().positive().optional() }).strict();
const stateSchema = z.object({ version: z.literal(1), grants: z.array(grant).max(16) }).strict();
type Grant = z.infer<typeof grant>;
/**
 * 入口 / Entry: hash.
 * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `createHash('sha256').update(value).digest('hex')` 供上层消费（`browser-extensions.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `browser-extensions.ts`; this entry produces `createHash('sha256').update(value).digest('hex')` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
 * 处理：通过 `createHash().update().digest`, `createHash().update`, `createHash` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `createHash().update().digest`, `createHash().update`, `createHash`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: value: string
 * 输出 / Returns: `createHash('sha256').update(value).digest('hex')`.
 * 副作用 / Effects: `createHash().update().digest`; `createHash().update`; `createHash`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/**
 * 入口 / Entry: sameHash.
 * 功能：把本层请求转交 `timingSafeEqual`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `timingSafeEqual` and propagates the provider result or rejection.
 * 输入 / Inputs: left: string; right: string
 * 输出 / Returns: `timingSafeEqual( Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const sameHash = (left: string, right: string) => timingSafeEqual(
  Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
/**
 * 入口 / Entry: defaults.
 * 功能：从当前输入或状态计算 `({ version: 1 as const, grants: [] as Grant[] })`，供调用方后续验证或使用。
 * Purpose: Computes `({ version: 1 as const, grants: [] as Grant[] })` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
 * 输出 / Returns: `({ version: 1 as const, grants: [] as Grant[] })`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
const defaults = () => ({ version: 1 as const, grants: [] as Grant[] });

export const extensionCodeInput = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{12}$/),
}).strict();
/**
 * 入口 / Entry: extensionOrigin.
 * 功能：把本层请求转交 `originSchema.parse`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `originSchema.parse` and propagates the provider result or rejection.
 * 输入 / Inputs: value: unknown
 * 输出 / Returns: `originSchema.parse(value)`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export const extensionOrigin = (value: unknown) => originSchema.parse(value);

/** Owner-paired, read-only extension identities, independent of browser login sessions. */
export class BrowserExtensions {
  private grants: Grant[] = [];
  private pairing?: { codeHash: string; ownerId: string; expiresAt: number };
  private failures = new Map<string, { count: number; blockedUntil: number }>();
  private writes = Promise.resolve();
  private closed = false;

  /**
   * 入口 / Entry: BrowserExtensions.constructor.
   * 功能：建立 BrowserExtensions 的管理浏览器扩展配对码和连接凭证上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the BrowserExtensions context for this module's responsibility: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; file: default=join(DATA, 'browser-extensions.json'); now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   */
  constructor(private access: AccessControlV1,
    private file = join(DATA, 'browser-extensions.json'), private now = Date.now) {}

  /**
   * 入口 / Entry: BrowserExtensions.init.
   * 功能：在管理浏览器扩展配对码和连接凭证中，初始化并核对当前领域状态；处理结果记录到 `this.grants`（`BrowserExtensions`）。
   * Purpose: Initializes and verifies current domain state in `BrowserExtensions`; the outcome is recorded in `this.grants`. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `stateSchema.parse`, `readStore`, `this.grants.map` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `stateSchema.parse`, `readStore`, `this.grants.map`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.grants`.
   * 拒绝 / Refusals: 条件 / conditions `new Set(this.grants.map((item) => item.id)).size !== this.grants.length || new Set(this.grants.map((item) => item.origin)).si…`; 异常 / errors `new AppError('浏览器扩展目录包含重复连接', 503)`.
   */
  async init() {
    this.grants = stateSchema.parse(await readStore(this.file, defaults)).grants;
    if (new Set(this.grants.map((item) => item.id)).size !== this.grants.length ||
        new Set(this.grants.map((item) => item.origin)).size !== this.grants.length)
      throw new AppError('浏览器扩展目录包含重复连接', 503);
  }

  /**
   * 入口 / Entry: BrowserExtensions.serial.
   * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `task` 供上层消费（`BrowserExtensions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserExtensions`; this entry produces `task` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `this.writes.catch().then`, `this.writes.catch`, `task.then` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.writes.catch().then`, `this.writes.catch`, `task.then`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: work: () => Promise<T>
   * 输出 / Returns: `task`.
   * 副作用 / Effects: `this.writes.catch().then`; `this.writes.catch`; 更新 / updates `this.writes`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private serial<T>(work: () => Promise<T>) {
    const task = this.writes.catch(() => {}).then(async () => {
      if (this.closed) throw new AppError('浏览器扩展服务正在关闭', 503);
      return work();
    });
    this.writes = task.then(() => {}, () => {});
    return task;
  }

  /**
   * 入口 / Entry: BrowserExtensions.save.
   * 功能：在管理浏览器扩展配对码和连接凭证中，校验并提交领域状态变更；处理结果记录到 `this.grants`（`BrowserExtensions`）。
   * Purpose: Validates and commits a domain state change in `BrowserExtensions`; the outcome is recorded in `this.grants`. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `writeStore` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `writeStore`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: grants: Grant[]
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeStore`; 更新 / updates `this.grants`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async save(grants: Grant[]) {
    await writeStore(this.file, { version: 1, grants });
    this.grants = grants;
  }

  /**
   * 入口 / Entry: BrowserExtensions.liveOwner.
   * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`BrowserExtensions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserExtensions`; the calls and state transitions below complete the operation. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `this.access.users().some`, `this.access.users` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().some`, `this.access.users`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!this.access.enabled || !this.access.users().some((item) => item.id === id && item.role === 'owner')`; 异常 / errors `new AppError('管理员账户已失效', 403)`.
   */
  private liveOwner(id: string) {
    if (!this.access.enabled || !this.access.users().some((item) =>
      item.id === id && item.role === 'owner'))
      throw new AppError('管理员账户已失效', 403);
  }

  /**
   * 入口 / Entry: BrowserExtensions.list.
   * 功能：在管理浏览器扩展配对码和连接凭证中，读取或核对领域状态并构造调用方可消费的结果；本入口产生 `this.grants.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, connected: !!item.last…` 供上层消费（`BrowserExtensions`）。
   * Purpose: Reads/verifies domain state and constructs a caller-facing result in `BrowserExtensions`; this entry produces `this.grants.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, connected: !!item.last…` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `this.liveOwner`, `this.grants.filter().map`, `this.grants.filter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.liveOwner`, `this.grants.filter().map`, `this.grants.filter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: `this.grants.filter((item) => item.ownerId === ownerId) .map(({ tokenHash: _, ...item }) => ({ ...item, connected: !!item.last…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  list(ownerId: string) {
    this.liveOwner(ownerId);
    return this.grants.filter((item) => item.ownerId === ownerId)
      .map(({ tokenHash: _, ...item }) => ({ ...item,
        connected: !!item.lastSeenAt && item.lastSeenAt > this.now() - 2 * 60_000,
        expired: item.expiresAt <= this.now(), permissions: ['inventory:read'] }));
  }

  /**
   * 入口 / Entry: BrowserExtensions.createPairing.
   * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ code, expiresAt: this.pairing.expiresAt, permissions: ['inventory:read'] }` 供上层消费（`BrowserExtensions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserExtensions`; this entry produces `{ code, expiresAt: this.pairing.expiresAt, permissions: ['inventory:read'] }` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `this.liveOwner`, `randomBytes().toString`, `randomBytes`, `hash` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.liveOwner`, `randomBytes().toString`, `randomBytes`, `hash`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ownerId: string
   * 输出 / Returns: `{ code, expiresAt: this.pairing.expiresAt, permissions: ['inventory:read'] }`.
   * 副作用 / Effects: 更新 / updates `this.pairing`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  createPairing(ownerId: string) {
    this.liveOwner(ownerId);
    const code = randomBytes(9).toString('base64url');
    this.pairing = { codeHash: hash(code), ownerId, expiresAt: this.now() + 5 * 60_000 };
    return { code, expiresAt: this.pairing.expiresAt,
      permissions: ['inventory:read'] };
  }

  /**
   * 入口 / Entry: BrowserExtensions.connect.
   * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { const failed = this.failures.get(origin); if (failed && failed.blockedUntil > this.now()) throw new…` 供上层消费（`BrowserExtensions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserExtensions`; this entry produces `this.serial(async () => { const failed = this.failures.get(origin); if (failed && failed.blockedUntil > this.now()) throw new…` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `extensionOrigin`, `extensionCodeInput.parse`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `extensionOrigin`, `extensionCodeInput.parse`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: originValue: unknown; input: unknown
   * 输出 / Returns: `this.serial(async () => { const failed = this.failures.get(origin); if (failed && failed.blockedUntil > this.now()) throw new…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async connect(originValue: unknown, input: unknown) {
    const origin = extensionOrigin(originValue);
    const { code } = extensionCodeInput.parse(input);
    /**
     * 入口 / Entry: BrowserExtensions.connect.callback@85.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ token, id: item.id, expiresAt: item.expiresAt, permissions: ['inventory:read'] }`.
     * 副作用 / Effects: `this.failures.set`; `this.save`; `this.failures.delete`; 更新 / updates `this.pairing`.
     * 拒绝 / Refusals: 条件 / conditions `failed && failed.blockedUntil > this.now()`; `!valid`; `grants.length >= 16`; 异常 / errors `new AppError('尝试过多，请一分钟后重试', 429)`; `new AppError('配对码无效或已过期', 403)`.
     */
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

  /**
   * 入口 / Entry: BrowserExtensions.authorize.
   * 功能：在管理浏览器扩展配对码和连接凭证中，核对调用资格、输入或资源归属；本入口产生 `{ id: item.id, expiresAt: item.expiresAt, permissions: ['inventory:read'] }` 供上层消费（`BrowserExtensions`）。
   * Purpose: Checks admission, input or resource ownership in `BrowserExtensions`; this entry produces `{ id: item.id, expiresAt: item.expiresAt, permissions: ['inventory:read'] }` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `extensionOrigin`, `inline.test`, `hash`, `this.grants.find` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `extensionOrigin`, `inline.test`, `hash`, `this.grants.find`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!item.lastSeenAt || item.lastSeenAt <= this.now() - 60_000`.
   * 输入 / Inputs: originValue: unknown; token: unknown
   * 输出 / Returns: `{ id: item.id, expiresAt: item.expiresAt, permissions: ['inventory:read'] }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)`; `!item || item.expiresAt <= this.now()`; 异常 / errors `new AppError('浏览器扩展凭证无效', 401)`; `new AppError('浏览器扩展凭证已过期或撤销', 401)`.
   */
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

  /**
   * 入口 / Entry: BrowserExtensions.revoke.
   * 功能：在管理浏览器扩展配对码和连接凭证中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.serial(async () => { this.liveOwner(ownerId); if (!this.grants.some((item) => item.id === id && item.ownerId === ownerId…` 供上层消费（`BrowserExtensions`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `BrowserExtensions`; this entry produces `this.serial(async () => { this.liveOwner(ownerId); if (!this.grants.some((item) => item.id === id && item.ownerId === ownerId…` for its caller. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 处理：通过 `z.uuid().parse`, `z.uuid`, `this.serial` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `z.uuid().parse`, `z.uuid`, `this.serial`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: ownerId: string; id: string
   * 输出 / Returns: `this.serial(async () => { this.liveOwner(ownerId); if (!this.grants.some((item) => item.id === id && item.ownerId === ownerId…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revoke(ownerId: string, id: string) {
    z.uuid().parse(id);
    /**
     * 入口 / Entry: BrowserExtensions.revoke.callback@140.
     * 功能：处理传入串行或作用域入口的状态分支，返回值由该入口按自身契约消费（this.serial）。
     * Purpose: Processes the state branch supplied to a serialized/scoped entry, whose own contract determines consumption of its return value (this.serial).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ revoked: id }`.
     * 副作用 / Effects: `this.save`.
     * 拒绝 / Refusals: 条件 / conditions `!this.grants.some((item) => item.id === id && item.ownerId === ownerId)`; 异常 / errors `new AppError('浏览器扩展连接不存在', 404)`.
     */
    return this.serial(async () => {
      this.liveOwner(ownerId);
      if (!this.grants.some((item) => item.id === id && item.ownerId === ownerId))
        throw new AppError('浏览器扩展连接不存在', 404);
      await this.save(this.grants.filter((item) => item.id !== id));
      return { revoked: id };
    });
  }

  /**
   * 入口 / Entry: BrowserExtensions.revokeAll.
   * 功能：把本层请求转交 `this.serial`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.serial` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `this.serial(async () => { await this.save([]); this.pairing = undefined; })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async revokeAll() {
    return this.serial(async () => {
      await this.save([]);
      this.pairing = undefined;
    });
  }

  /**
   * 入口 / Entry: BrowserExtensions.close.
   * 功能：在管理浏览器扩展配对码和连接凭证中，结束、撤销或清理本次拥有的领域资源；处理结果记录到 `this.closed`（`BrowserExtensions`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `BrowserExtensions`; the outcome is recorded in `this.closed`. Module context: Owns extension pairing codes and credentials, checking origins, administrator identity and attempt rates.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 更新 / updates `this.closed`.
   */
  async close() { this.closed = true; await this.writes; }
}

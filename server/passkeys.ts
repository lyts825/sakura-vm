/**
 * 模块职责：管理 WebAuthn 注册、认证及解锁挑战，限制待处理请求并核对挑战有效期。
 * Module purpose: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
 */
import type { AccessControlV1 } from './service-contracts/v1.ts';
import { randomBytes } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { AccessControl, type Principal } from './access-control.ts';
import { AppError } from '../shared/errors.ts';
import { rejectOperationBeforeEffect } from './operation-execution.ts';

const ceremonyId = z.string().regex(/^[a-f0-9]{64}$/);
const browserCredential = z.object({ id: z.string().min(16).max(1024) }).passthrough();
export const passkeyRegisterStart = z.object({
  password: z.string().max(256), name: z.string().trim().min(1).max(64),
  platformOnly: z.boolean().default(false),
}).strict();
export const passkeyFinish = z.object({ ceremonyId, response: browserCredential }).strict();
export const passkeyRemove = z.object({ password: z.string().max(256) }).strict();

type Ceremony = { challenge: string; expiresAt: number; purpose: 'register' | 'login' | 'unlock';
  accountId?: string; name?: string; lockGeneration?: number };
const optionsOperations = ['core.access.passkeyLoginOptions', 'core.session.passkeyOptions'];
/**
 * 入口 / Entry: rejectOptions.
 * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`passkeys.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `passkeys.ts`; the calls and state transitions below complete the operation. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
 * 处理：通过 `rejectOperationBeforeEffect` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `rejectOperationBeforeEffect`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `error !== null && typeof error === 'object'`.
 * 输入 / Inputs: error: unknown
 * 输出 / Returns: never.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `error`.
 */
const rejectOptions = (error: unknown): never => {
  if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, optionsOperations);
  throw error;
};

/** Short-lived, one-use WebAuthn ceremonies bound to this local service process. */
export class Passkeys {
  private ceremonies = new Map<string, Ceremony>();
  private readonly rpID = 'localhost';
  private readonly origin: string;
  /**
   * 入口 / Entry: Passkeys.constructor.
   * 功能：建立 Passkeys 的管理 WebAuthn 注册、认证及解锁挑战上下文，绑定本实例使用的依赖、初始状态及下述字段。
   * Purpose: Constructs the Passkeys context for this module's responsibility: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds. Instance dependencies and initial fields are bound below.
   * 输入 / Inputs: access: AccessControlV1; port: number; now: default=Date.now
   * 输出 / Returns: 初始化后的实例 / initialized instance.
   * 副作用 / Effects: 更新 / updates `this.origin`.
   */
  constructor(private access: AccessControlV1, port: number, private now = Date.now) {
    this.origin = `http://localhost:${port}`;
  }

  /**
   * 入口 / Entry: Passkeys.remember.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `id` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `id` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `this.now`, `this.ceremonies.delete`, `rejectOptions`, `randomBytes().toString` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.now`, `this.ceremonies.delete`, `rejectOptions`, `randomBytes().toString`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `entry.expiresAt <= this.now()`; `this.ceremonies.size >= 128`.
   * 输入 / Inputs: ceremony: Ceremony
   * 输出 / Returns: `id`.
   * 副作用 / Effects: `this.ceremonies.delete`; `this.ceremonies.set`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private remember(ceremony: Ceremony) {
    for (const [id, entry] of this.ceremonies)
      if (entry.expiresAt <= this.now()) this.ceremonies.delete(id);
    if (this.ceremonies.size >= 128)
      rejectOptions(new AppError('通行密钥请求过多，请稍后重试', 429));
    const id = randomBytes(32).toString('hex');
    this.ceremonies.set(id, ceremony);
    return id;
  }

  /**
   * 入口 / Entry: Passkeys.take.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `entry` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `entry` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `this.ceremonies.get`, `ceremonyId.parse`, `this.ceremonies.delete`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ceremonies.get`, `ceremonyId.parse`, `this.ceremonies.delete`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: id: string; purpose: Ceremony['purpose']; accountId: string optional
   * 输出 / Returns: `entry`.
   * 副作用 / Effects: `this.ceremonies.delete`.
   * 拒绝 / Refusals: 条件 / conditions `!entry || entry.expiresAt <= this.now() || entry.accountId !== accountId || entry.purpose !== purpose`; 异常 / errors `new AppError('通行密钥请求已失效，请重新开始', 409)`.
   */
  private take(id: string, purpose: Ceremony['purpose'], accountId?: string) {
    const entry = this.ceremonies.get(ceremonyId.parse(id));
    this.ceremonies.delete(id);
    if (!entry || entry.expiresAt <= this.now() || entry.accountId !== accountId ||
        entry.purpose !== purpose)
      throw new AppError('通行密钥请求已失效，请重新开始', 409);
    return entry;
  }

  /**
   * 入口 / Entry: Passkeys.beginRegistration.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'register', accountI…` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'register', accountI…` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `passkeyRegisterStart.parse`, `this.access.login`, `this.access.logout`, `this.access.registeredPasskeysFor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `passkeyRegisterStart.parse`, `this.access.login`, `this.access.logout`, `this.access.registeredPasskeysFor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; input: unknown
   * 输出 / Returns: `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'register', accountI…`.
   * 副作用 / Effects: `this.access.registeredPasskeysFor`; `principal.id.replaceAll`.
   * 拒绝 / Refusals: 条件 / conditions `existing.length >= 10`; 异常 / errors `new AppError('每个账户最多登记 10 把通行密钥', 409)`.
   */
  async beginRegistration(principal: Principal, input: unknown) {
    const value = passkeyRegisterStart.parse(input);
    const proof = await this.access.login({ username: principal.username, password: value.password });
    this.access.logout(proof.token);
    const existing = this.access.registeredPasskeysFor(principal.id);
    if (existing.length >= 10) throw new AppError('每个账户最多登记 10 把通行密钥', 409);
    const options = await generateRegistrationOptions({
      rpName: 'Sakura', rpID: this.rpID, userName: principal.username,
      userDisplayName: principal.username,
      userID: Buffer.from(principal.id.replaceAll('-', ''), 'hex'),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required',
        ...(value.platformOnly ? { authenticatorAttachment: 'platform' as const } : {}) },
      supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: existing.map((item) => ({ id: item.id, transports: item.transports })),
    });
    return { ceremonyId: this.remember({ challenge: options.challenge,
      expiresAt: this.now() + 5 * 60_000, purpose: 'register',
      accountId: principal.id, name: value.name }), options };
  }

  /**
   * 入口 / Entry: Passkeys.finishRegistration.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `this.access.addPasskey(principal.id, { id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'), counter: key.…` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `this.access.addPasskey(principal.id, { id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'), counter: key.…` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `passkeyFinish.parse`, `this.take`, `verifyRegistrationResponse`, `this.access.addPasskey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `passkeyFinish.parse`, `this.take`, `verifyRegistrationResponse`, `this.access.addPasskey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: principal: Principal; input: unknown
   * 输出 / Returns: `this.access.addPasskey(principal.id, { id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'), counter: key.…`.
   * 副作用 / Effects: `this.access.addPasskey`; 更新 / updates `verified`.
   * 拒绝 / Refusals: 条件 / conditions `!verified.verified || verified.registrationInfo.credential.id !== value.response.id`; 异常 / errors `new AppError('通行密钥登记验证失败', 403)`.
   * 失败处理：catch 分支执行 `throw new AppError('通行密钥登记验证失败', 403);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('通行密钥登记验证失败', 403);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async finishRegistration(principal: Principal, input: unknown) {
    const value = passkeyFinish.parse(input);
    const ceremony = this.take(value.ceremonyId, 'register', principal.id);
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: value.response as unknown as RegistrationResponseJSON,
        expectedChallenge: ceremony.challenge, expectedOrigin: this.origin,
        expectedRPID: this.rpID, requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch { throw new AppError('通行密钥登记验证失败', 403); }
    if (!verified.verified || verified.registrationInfo.credential.id !== value.response.id)
      throw new AppError('通行密钥登记验证失败', 403);
    const key = verified.registrationInfo.credential;
    return this.access.addPasskey(principal.id, {
      id: key.id, publicKey: Buffer.from(key.publicKey).toString('base64url'),
      counter: key.counter, transports: key.transports || [],
      name: ceremony.name, createdAt: new Date(this.now()).toISOString(),
    });
  }

  /**
   * 入口 / Entry: Passkeys.beginAuthentication.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'login' }), options …` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'login' }), options …` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `generateAuthenticationOptions().catch`, `generateAuthenticationOptions`, `this.remember`, `this.now` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `generateAuthenticationOptions().catch`, `generateAuthenticationOptions`, `this.remember`, `this.now`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'login' }), options …`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async beginAuthentication() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID, userVerification: 'required',
    }).catch(rejectOptions);
    return { ceremonyId: this.remember({ challenge: options.challenge,
      expiresAt: this.now() + 5 * 60_000, purpose: 'login' }), options };
  }

  /**
   * 入口 / Entry: Passkeys.beginUnlock.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'unlock', lockGenera…` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'unlock', lockGenera…` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `this.access.users().find`, `this.access.users`, `this.access.registeredPasskeysFor().some`, `this.access.registeredPasskeysFor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.access.users().find`, `this.access.users`, `this.access.registeredPasskeysFor().some`, `this.access.registeredPasskeysFor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: lockGeneration: number
   * 输出 / Returns: `{ ceremonyId: this.remember({ challenge: options.challenge, expiresAt: this.now() + 5 * 60_000, purpose: 'unlock', lockGenera…`.
   * 副作用 / Effects: `this.access.registeredPasskeysFor().some`; `this.access.registeredPasskeysFor`.
   * 拒绝 / Refusals: 条件 / conditions `!owner || !this.access.registeredPasskeysFor(owner.id) .some((item) => item.transports.includes('internal'))`; 异常 / errors `new AppError('请先为管理员登记本机平台通行密钥', 409)`.
   * 失败处理：catch 分支执行 `rejectOptions(error);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `rejectOptions(error);`; these statements determine whether a failure is absorbed or rejected again.
   */
  async beginUnlock(lockGeneration: number) {
    try {
      const owner = this.access.users().find((item) => item.role === 'owner');
      if (!owner || !this.access.registeredPasskeysFor(owner.id)
        .some((item) => item.transports.includes('internal')))
        throw new AppError('请先为管理员登记本机平台通行密钥', 409);
    } catch (error) { rejectOptions(error); }
    const options = await generateAuthenticationOptions({
      rpID: this.rpID, userVerification: 'required',
    }).catch(rejectOptions);
    return { ceremonyId: this.remember({ challenge: options.challenge,
      expiresAt: this.now() + 5 * 60_000, purpose: 'unlock', lockGeneration }), options };
  }

  /**
   * 入口 / Entry: Passkeys.finish.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，执行此领域的具体处理步骤并返回其结果；本入口产生 `{ login, lockGeneration: ceremony.lockGeneration }` 供上层消费（`Passkeys`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `Passkeys`; this entry produces `{ login, lockGeneration: ceremony.lockGeneration }` for its caller. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `inline`, `this.access.completePasskeyLogin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline`, `this.access.completePasskeyLogin`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: input: unknown; purpose: 'login' | 'unlock'
   * 输出 / Returns: `{ login, lockGeneration: ceremony.lockGeneration }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  private async finish(input: unknown, purpose: 'login' | 'unlock') {
    // This stage consumes a one-use challenge but cannot write a credential
    // counter or issue a session. Only its failures are confirmed refusals.
    /**
     * 入口 / Entry: Passkeys.finish.callback@132.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（inline）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (inline).
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `{ ceremony, registered, verified }`.
     * 副作用 / Effects: `registered.key.transports.includes`; 更新 / updates `verified`.
     * 拒绝 / Refusals: 条件 / conditions `!registered`; `purpose === 'unlock' && (registered.user.role !== 'owner' || !registered.key.transports.includes('internal'))`; `!verified.verified`; 异常 / errors `new AppError('通行密钥验证失败', 403)`; `new AppError('需要管理员的本机平台通行密钥', 403)`.
     * 失败处理：catch 分支执行 `if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, ['core.access.passkeyLoginVerify', 'core.…`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, ['core.access.passkeyLoginVerify', 'core.…`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    const admission = await (async () => {
      try {
        const value = passkeyFinish.parse(input);
        const ceremony = this.take(value.ceremonyId, purpose);
        const registered = this.access.getPasskey(value.response.id);
        if (!registered) throw new AppError('通行密钥验证失败', 403);
        if (purpose === 'unlock' &&
            (registered.user.role !== 'owner' || !registered.key.transports.includes('internal')))
          throw new AppError('需要管理员的本机平台通行密钥', 403);
        let verified;
        try { verified = await verifyAuthenticationResponse({
        response: value.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: ceremony.challenge, expectedOrigin: this.origin,
        expectedRPID: this.rpID, requireUserVerification: true,
        credential: {
          id: registered.key.id,
          publicKey: new Uint8Array(Buffer.from(registered.key.publicKey, 'base64url')),
          counter: registered.key.counter, transports: registered.key.transports,
        },
        }); } catch { throw new AppError('通行密钥验证失败', 403); }
        if (!verified.verified) throw new AppError('通行密钥验证失败', 403);
        return { ceremony, registered, verified };
      } catch (error) {
        if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error,
          ['core.access.passkeyLoginVerify', 'core.session.passkeyVerify']);
        throw error;
      }
    })();
    const { ceremony, registered, verified } = admission;
    const login = await this.access.completePasskeyLogin(registered.user.id, registered.key.id,
      registered.key.counter, verified.authenticationInfo.newCounter);
    return { login, lockGeneration: ceremony.lockGeneration };
  }

  /**
   * 入口 / Entry: Passkeys.finishAuthentication.
   * 功能：从当前输入或状态计算 `(await this.finish(input, 'login')).login`，供调用方后续验证或使用。
   * Purpose: Computes `(await this.finish(input, 'login')).login` from current inputs/state for the caller to validate or consume.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `(await this.finish(input, 'login')).login`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  async finishAuthentication(input: unknown) {
    return (await this.finish(input, 'login')).login;
  }

  /**
   * 入口 / Entry: Passkeys.finishUnlock.
   * 功能：把本层请求转交 `this.finish`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `this.finish` and propagates the provider result or rejection.
   * 输入 / Inputs: input: unknown
   * 输出 / Returns: `this.finish(input, 'unlock')`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  finishUnlock(input: unknown) { return this.finish(input, 'unlock'); }

  /**
   * 入口 / Entry: Passkeys.close.
   * 功能：在管理 WebAuthn 注册、认证及解锁挑战中，结束、撤销或清理本次拥有的领域资源；完成下述调用及状态处理（`Passkeys`）。
   * Purpose: Ends, revokes or cleans resources owned by this domain action in `Passkeys`; the calls and state transitions below complete the operation. Module context: Owns WebAuthn registration/authentication/unlock challenges with pending-request and expiration bounds.
   * 处理：通过 `this.ceremonies.clear` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `this.ceremonies.clear`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `this.ceremonies.clear`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  close() { this.ceremonies.clear(); }
}

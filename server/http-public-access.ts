/**
 * 模块职责：处理认证与公开 API 入口，登录流程核对会话变化及请求方法。
 * Module purpose: Handles public/authentication entry points, checking session changes and allowed methods during login.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { PORT } from './paths.ts';
import { type SsoProvider } from './sso.ts';
import { noteOperationResultActor } from './operation-results.ts';
import { publicApiFailure } from './api-errors.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';
import { rejectOperationBeforeEffect } from './operation-execution.ts';
import type { SessionLockV1 } from './service-contracts/v1.ts';

/** Wrap only request admission, before any challenge, credential counter or
 * session is issued. Post-effect failures must retain their unknown outcome. */
/**
 * 入口 / Entry: authenticationInput.
 * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `await prepare()` 供上层消费（`http-public-access.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `await prepare()` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
 * 处理：通过 `prepare`, `rejectOperationBeforeEffect` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `prepare`, `rejectOperationBeforeEffect`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `error !== null && typeof error === 'object'`.
 * 输入 / Inputs: operationId: string; prepare: () => T | Promise<T>
 * 输出 / Returns: `await prepare()`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 拒绝 / Refusals: 异常 / errors `error`.
 * 失败处理：catch 分支执行 `if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, [operationId]);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
 * Failure handling: Catch paths execute `if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, [operationId]);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
 */
async function authenticationInput<T>(operationId: string, prepare: () => T | Promise<T>) {
  try { return await prepare(); }
  catch (error) {
    if (error !== null && typeof error === 'object') rejectOperationBeforeEffect(error, [operationId]);
    throw error;
  }
}

/** A body read or credential proof may span a complete lock/unlock transition. */
/**
 * 入口 / Entry: unlockedAuthenticationInput.
 * 功能：把本层请求转交 `authenticationInput`，沿用该实现的结果与失败路径。
 * Purpose: Delegates this request to `authenticationInput` and propagates the provider result or rejection.
 * 输入 / Inputs: operationId: string; session: Pick<SessionLockV1, 'requireUnlocked' | 'getGeneration'>; prepare: () => Promise<T>
 * 输出 / Returns: `authenticationInput(operationId, async () => { session.requireUnlocked(); const generation = session.getGeneration(); const c…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
async function unlockedAuthenticationInput<T>(operationId: string,
  session: Pick<SessionLockV1, 'requireUnlocked' | 'getGeneration'>, prepare: () => Promise<T>) {
  /**
   * 入口 / Entry: unlockedAuthenticationInput.callback@29.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（authenticationInput）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (authenticationInput).
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `{ input, check }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  return authenticationInput(operationId, async () => {
    session.requireUnlocked();
    const generation = session.getGeneration();
    /**
     * 入口 / Entry: unlockedAuthenticationInput.check.
     * 功能：在处理认证与公开 API 入口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`http-public-access.ts`）。
     * Purpose: Checks admission, input or resource ownership in `http-public-access.ts`; the calls and state transitions below complete the operation. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
     * 处理：通过 `session.requireUnlocked`, `session.getGeneration` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `session.requireUnlocked`, `session.getGeneration`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 拒绝 / Refusals: 条件 / conditions `generation !== session.getGeneration()`; 异常 / errors `new AppError('会话状态已变化，请重新登录', 409, 'SESSION_STATE_CHANGED')`.
     */
    const check = () => {
      session.requireUnlocked();
      if (generation !== session.getGeneration())
        throw new AppError('会话状态已变化，请重新登录', 409, 'SESSION_STATE_CHANGED');
    };
    const input = await prepare();
    check();
    return { input, check };
  });
}

/**
 * 入口 / Entry: publicAccessHandlers.
 * 功能：创建启动状态、认证、解锁及公开文档入口的 HTTP 处理器。
 * Purpose: Builds HTTP handlers for startup state, authentication, unlocking and public documents.
 * 设计：公开入口只省略其明确声明的控制器权限；挑战、令牌和锁代次仍核对当前状态，静态文档使用已验证快照。
 * Design: Public access omits only explicitly declared controller checks; challenges/tokens/lock generations remain current and documents use verified snapshots.
 * 输入 / Inputs: context: CoreHttpContext<'access' | 'session' | 'passkeys' | 'sso' | 'features' | 'token'>
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.access.status': accessStatusHandler, 'core.session.status': sessionStatusHandler, 'core.session.unlock': sessionUnloc…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function publicAccessHandlers(
  context: CoreHttpContext<'access' | 'session' | 'passkeys' | 'sso' | 'features' | 'token'>,
): CoreHttpHandlers {
  const {
    services,
    body,
    requirePasskeyOrigin,
    samlPost,
    sendSsoPage,
    terminateCredentialSockets,
  } = context;
  /**
   * 入口 / Entry: publicAccessHandlers.accessStatusHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...access.status(), session: session.view() })` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, { ...access.status(), session: session.view() })` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `send`, `access.status`, `session.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `access.status`, `session.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...access.status(), session: session.view() })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/status'`; `req.method !== 'GET'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessStatusHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    if (url.pathname === '/api/access/status') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, { ...access.status(), session: session.view() });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.sessionStatusHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, session.view())` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, session.view())` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `send`, `session.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `session.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, session.view())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/session'`; `req.method !== 'GET'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const sessionStatusHandler: HttpOperationHandler = async (req, res, url) => {
    const { session } = services;
    if (url.pathname === '/api/session') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, session.view());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.sessionUnlockHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await session.unlock(input))` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, await session.unlock(input))` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `authenticationInput`, `send`, `session.unlock` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authenticationInput`, `send`, `session.unlock`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/session/unlock'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await session.unlock(input))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const sessionUnlockHandler: HttpOperationHandler = async (req, res, url) => {
    const { session } = services;
    if (url.pathname === '/api/session/unlock') {
      const input = await authenticationInput('core.session.unlock', async () => {
        if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
        return body(req, 4096);
      });
      return send(res, await session.unlock(input));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.sessionPasskeyOptionsHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await passkeys.beginUnlock(session.getGeneration()))` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, await passkeys.beginUnlock(session.getGeneration()))` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `authenticationInput`, `send`, `passkeys.beginUnlock`, `session.getGeneration` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authenticationInput`, `send`, `passkeys.beginUnlock`, `session.getGeneration`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/session/unlock/passkey/options'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await passkeys.beginUnlock(session.getGeneration()))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const sessionPasskeyOptionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    if (url.pathname === '/api/session/unlock/passkey/options') {
      await authenticationInput('core.session.passkeyOptions', async () => {
        if (req.method !== 'POST' || !access.enabled || !session.view().locked)
          throw new AppError('控制面未启用通行密钥解锁', 409);
        requirePasskeyOrigin(req);
        z.object({}).strict().parse(await body(req, 4096));
      });
      return send(res, await passkeys.beginUnlock(session.getGeneration()));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.sessionPasskeyVerifyHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...login, session: unlocked })` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, { ...login, session: unlocked })` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `authenticationInput`, `passkeys.finishUnlock`, `noteOperationResultActor`, `session.unlockWithPasskey` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authenticationInput`, `passkeys.finishUnlock`, `noteOperationResultActor`, `session.unlockWithPasskey`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...login, session: unlocked })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/session/unlock/passkey/verify'`; 异常 / errors `error`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   * 失败处理：catch 分支执行 `access.logout(login.token);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `access.logout(login.token);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const sessionPasskeyVerifyHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    if (url.pathname === '/api/session/unlock/passkey/verify') {
      const input = await authenticationInput('core.session.passkeyVerify', async () => {
        if (req.method !== 'POST' || !access.enabled || !session.view().locked)
          throw new AppError('控制面未启用通行密钥解锁', 409);
        requirePasskeyOrigin(req);
        return body(req, 65536);
      });
      const { login, lockGeneration } = await passkeys.finishUnlock(input);
      noteOperationResultActor(login.principal.id);
      try {
        const unlocked = await session.unlockWithPasskey(lockGeneration!);
        return send(res, { ...login, session: unlocked });
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessSsoOidcCallbackHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `sendSsoPage(res, completed.origin, completed.state, completed.result)` / `sendSsoPage( res, origin, state, undefined, publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).dto.err…` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `sendSsoPage(res, completed.origin, completed.state, completed.result)` / `sendSsoPage( res, origin, state, undefined, publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).dto.err…` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `url.pathname.includes`, `samlPost`, `url.searchParams.get`, `sso.pendingOrigin` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `url.pathname.includes`, `samlPost`, `url.searchParams.get`, `sso.pendingOrigin`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `'principal' in completed.result`; `'binding' in completed.result`; `'token' in completed.result`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `sendSsoPage(res, completed.origin, completed.state, completed.result)`; `sendSsoPage( res, origin, state, undefined, publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).dto.err…`.
   * 副作用 / Effects: `sendSsoPage`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/sso/oidc/callback' || url.pathname === '/api/access/sso/saml/callback'`; `req.method !== (providerId === 'oidc' ? 'GET' : 'POST')`; 异常 / errors `new AppError('不支持此方法', 405)`; `error`.
   * 失败处理：catch 分支执行 `return sendSsoPage( res, origin, state, undefined, publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).…`; `if ('token' in completed.result) access.logout(completed.result.token);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return sendSsoPage( res, origin, state, undefined, publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).…`; `if ('token' in completed.result) access.logout(completed.result.token);`; these statements determine whether a failure is absorbed or rejected again.
   */
  const accessSsoOidcCallbackHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session, sso } = services;
    if (
      url.pathname === '/api/access/sso/oidc/callback' ||
      url.pathname === '/api/access/sso/saml/callback'
    ) {
      const providerId: SsoProvider = url.pathname.includes('/oidc/') ? 'oidc' : 'saml';
      if (req.method !== (providerId === 'oidc' ? 'GET' : 'POST')) throw new AppError('不支持此方法', 405);
      const post = providerId === 'saml' ? await samlPost(req) : undefined;
      const state = providerId === 'oidc' ? url.searchParams.get('state') || '' : post!.RelayState;
      const origin = sso.pendingOrigin(providerId, state);
      try {
        session.requireUnlocked();
        const completed =
          providerId === 'oidc'
            ? await sso.completeOidc(
                new URL(url.search, `http://localhost:${PORT}/api/access/sso/oidc/callback`),
              )
            : await sso.completeSaml(post!);
        if ('principal' in completed.result) noteOperationResultActor(completed.result.principal.id);
        else if ('binding' in completed.result) noteOperationResultActor(completed.result.binding.accountId);
        try {
          session.requireUnlocked();
        } catch (error) {
          if ('token' in completed.result) access.logout(completed.result.token);
          throw error;
        }
        return sendSsoPage(res, completed.origin, completed.state, completed.result);
      } catch (error) {
        return sendSsoPage(
          res,
          origin,
          state,
          undefined,
          publicApiFailure(error, String(res.getHeader('X-Sakura-Correlation-Id'))).dto.error,
        );
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessSsoProvidersHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, sso.providers())` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, sso.providers())` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `session.requireUnlocked`, `send`, `sso.providers` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.requireUnlocked`, `send`, `sso.providers`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, sso.providers())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/sso/providers'`; `req.method !== 'GET'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessSsoProvidersHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, sso, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/sso/providers') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, sso.providers());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessSsoStartHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, started)` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, started)` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `session.requireUnlocked`, `body`, `sso.begin`, `noteOperationResultActor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.requireUnlocked`, `body`, `sso.begin`, `noteOperationResultActor`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `typeof credential === 'string'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, started)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/sso/start'`; `req.method !== 'POST'`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
   * 失败处理：catch 分支执行 `sso.cancelPending();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `sso.cancelPending();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const accessSsoStartHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, session, sso } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/sso/start') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const input = await body(req, 4096);
      session.requireUnlocked();
      const credential = req.headers['x-sakura-token'];
      const started = await sso.begin(input, typeof credential === 'string' ? credential : undefined);
      if (typeof credential === 'string') noteOperationResultActor(access.authorize(credential).id);
      try {
        session.requireUnlocked();
      } catch (error) {
        sso.cancelPending();
        throw error;
      }
      return send(res, started);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessLoginHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, login)` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, login)` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `unlockedAuthenticationInput`, `access.login`, `noteOperationResultActor`, `check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `unlockedAuthenticationInput`, `access.login`, `noteOperationResultActor`, `check`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, login)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/login'`; 异常 / errors `error`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   * 失败处理：catch 分支执行 `access.logout(login.token);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `access.logout(login.token);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const accessLoginHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    if (url.pathname === '/api/access/login') {
      const { input, check } = await unlockedAuthenticationInput('core.access.login', session, async () => {
        if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
        return body(req, 4096);
      });
      const login = await access.login(input);
      noteOperationResultActor(login.principal.id);
      try {
        check();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessHandoffRedeemHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, login)` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, login)` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `session.requireUnlocked`, `access.redeemHandoff`, `body`, `noteOperationResultActor` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.requireUnlocked`, `access.redeemHandoff`, `body`, `noteOperationResultActor`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, login)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/handoff/redeem'`; `req.method !== 'POST' || !access.enabled`; 异常 / errors `new AppError('不支持此方法', 405)`; `error`.
   * 失败处理：catch 分支执行 `access.logout(login.token);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `access.logout(login.token);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const accessHandoffRedeemHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/handoff/redeem') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      const { sourceToken, ...login } = await access.redeemHandoff(await body(req, 4096));
      noteOperationResultActor(login.principal.id);
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      terminateCredentialSockets(sourceToken);
      return send(res, login);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessPasskeyLoginOptionsHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await passkeys.beginAuthentication())` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, await passkeys.beginAuthentication())` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `authenticationInput`, `send`, `passkeys.beginAuthentication` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authenticationInput`, `send`, `passkeys.beginAuthentication`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/access/passkeys/login/options'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await passkeys.beginAuthentication())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const accessPasskeyLoginOptionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    if (url.pathname === '/api/access/passkeys/login/options') {
      /**
       * 入口 / Entry: publicAccessHandlers.callback@225.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（authenticationInput / core.access.passkeyLoginOptions）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (authenticationInput / core.access.passkeyLoginOptions).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `req.method !== 'POST' || !access.enabled`; 异常 / errors `new AppError('不支持此方法', 405)`.
       */
      await authenticationInput('core.access.passkeyLoginOptions', async () => {
        session.requireUnlocked();
        if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
        requirePasskeyOrigin(req);
        z.object({}).strict().parse(await body(req, 4096));
      });
      return send(res, await passkeys.beginAuthentication());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.accessPasskeyLoginVerifyHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, login)` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, login)` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `unlockedAuthenticationInput`, `passkeys.finishAuthentication`, `noteOperationResultActor`, `check` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `unlockedAuthenticationInput`, `passkeys.finishAuthentication`, `noteOperationResultActor`, `check`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, login)`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/access/passkeys/login/verify'`; 异常 / errors `error`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   * 失败处理：catch 分支执行 `access.logout(login.token);`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `access.logout(login.token);`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const accessPasskeyLoginVerifyHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, passkeys, session } = services;
    if (url.pathname === '/api/access/passkeys/login/verify') {
      /**
       * 入口 / Entry: publicAccessHandlers.callback@238.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（unlockedAuthenticationInput / core.access.passkeyLoginVerify）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (unlockedAuthenticationInput / core.access.passkeyLoginVerify).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `body(req, 65536)`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 拒绝 / Refusals: 条件 / conditions `req.method !== 'POST' || !access.enabled`; `features.migration?.blocked`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('数据目录迁移维护中', 409)`.
       */
      const { input, check } = await unlockedAuthenticationInput('core.access.passkeyLoginVerify', session, async () => {
        if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
        requirePasskeyOrigin(req);
        if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
        return body(req, 65536);
      });
      const login = await passkeys.finishAuthentication(input);
      noteOperationResultActor(login.principal.id);
      try {
        check();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: publicAccessHandlers.bootstrapHandler.
   * 功能：在处理认证与公开 API 入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { token: services.token, session: session.view() })` 供上层消费（`http-public-access.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-public-access.ts`; this entry produces `send(res, { token: services.token, session: session.view() })` for its caller. Module context: Handles public/authentication entry points, checking session changes and allowed methods during login.
   * 处理：通过 `session.requireUnlocked`, `send`, `session.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.requireUnlocked`, `send`, `session.view`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { token: services.token, session: session.view() })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `req.method === 'GET' && url.pathname === '/api/bootstrap'`; `access.enabled`; 异常 / errors `new AppError('请登录账户后访问 Sakura', 401)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const bootstrapHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    session.requireUnlocked();
    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      if (access.enabled) throw new AppError('请登录账户后访问 Sakura', 401);
      return send(res, { token: services.token, session: session.view() });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.access.status': accessStatusHandler,
    'core.session.status': sessionStatusHandler,
    'core.session.unlock': sessionUnlockHandler,
    'core.session.passkeyOptions': sessionPasskeyOptionsHandler,
    'core.session.passkeyVerify': sessionPasskeyVerifyHandler,
    'core.access.ssoOidcCallback': accessSsoOidcCallbackHandler,
    'core.access.ssoSamlCallback': accessSsoOidcCallbackHandler,
    'core.access.ssoProviders': accessSsoProvidersHandler,
    'core.access.ssoStart': accessSsoStartHandler,
    'core.access.login': accessLoginHandler,
    'core.access.handoffRedeem': accessHandoffRedeemHandler,
    'core.access.passkeyLoginOptions': accessPasskeyLoginOptionsHandler,
    'core.access.passkeyLoginVerify': accessPasskeyLoginVerifyHandler,
    'core.bootstrap': bootstrapHandler,
  };
}

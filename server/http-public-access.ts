import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import { PORT } from './paths.ts';
import { type SsoProvider } from './sso.ts';
import { noteOperationResultActor } from './operation-results.ts';
import { publicApiFailure } from './api-errors.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

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
  const accessStatusHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    if (url.pathname === '/api/access/status') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, { ...access.status(), session: session.view() });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const sessionStatusHandler: HttpOperationHandler = async (req, res, url) => {
    const { session } = services;
    if (url.pathname === '/api/session') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, session.view());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const sessionUnlockHandler: HttpOperationHandler = async (req, res, url) => {
    const { session } = services;
    if (url.pathname === '/api/session/unlock') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      return send(res, await session.unlock(await body(req, 4096)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const sessionPasskeyOptionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    if (url.pathname === '/api/session/unlock/passkey/options') {
      if (req.method !== 'POST' || !access.enabled || !session.view().locked)
        throw new AppError('控制面未启用通行密钥解锁', 409);
      requirePasskeyOrigin(req);
      z.object({})
        .strict()
        .parse(await body(req, 4096));
      return send(res, await passkeys.beginUnlock(session.getGeneration()));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const sessionPasskeyVerifyHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    if (url.pathname === '/api/session/unlock/passkey/verify') {
      if (req.method !== 'POST' || !access.enabled || !session.view().locked)
        throw new AppError('控制面未启用通行密钥解锁', 409);
      requirePasskeyOrigin(req);
      const { login, lockGeneration } = await passkeys.finishUnlock(await body(req, 65536));
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
  const accessSsoProvidersHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, sso, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/sso/providers') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      return send(res, sso.providers());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const accessLoginHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/login') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const login = await access.login(await body(req, 4096));
      noteOperationResultActor(login.principal.id);
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const accessPasskeyLoginOptionsHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, passkeys, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/passkeys/login/options') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      z.object({})
        .strict()
        .parse(await body(req, 4096));
      return send(res, await passkeys.beginAuthentication());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const accessPasskeyLoginVerifyHandler: HttpOperationHandler = async (req, res, url) => {
    const { access, features, passkeys, session } = services;
    session.requireUnlocked();
    if (url.pathname === '/api/access/passkeys/login/verify') {
      if (req.method !== 'POST' || !access.enabled) throw new AppError('不支持此方法', 405);
      requirePasskeyOrigin(req);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const login = await passkeys.finishAuthentication(await body(req, 65536));
      noteOperationResultActor(login.principal.id);
      try {
        session.requireUnlocked();
      } catch (error) {
        access.logout(login.token);
        throw error;
      }
      return send(res, login);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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

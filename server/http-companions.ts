import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

export function companionHandlers(
  context: CoreHttpContext<
    'browserExtensions' | 'access' | 'features' | 'hostPeers' | 'mobileCompanion' | 'requireService'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
  const browserExtensionsListHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    const browserExtensions = services.requireService('browserExtensions');
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/browser-extensions') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理浏览器扩展', 403);
      if (req.method === 'GET')
        return send(res, { connections: browserExtensions.list(accountPrincipal.id) });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      z.object({})
        .strict()
        .parse(await authorizedBody(req, 4096));
      return send(res, browserExtensions.createPairing(accountPrincipal.id), 201);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const mobileCompanionGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, hostPeers, mobileCompanion, access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/mobile-companion') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理移动伴侣', 403);
      if (req.method === 'GET')
        return send(res, {
          ...mobileCompanion.view(accountPrincipal.id),
          listener: hostPeers.view().listener,
          fingerprint: hostPeers.view().fingerprint,
        });
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await mobileCompanion.action(accountPrincipal.id, await authorizedBody(req, 4096)));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const browserExtensionsRevokeHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, access } = services;
    const browserExtensions = services.requireService('browserExtensions');
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (/^\/api\/browser-extensions\/[a-f0-9-]{36}$/.test(url.pathname)) {
      if (req.method !== 'DELETE' || accountPrincipal?.role !== 'owner')
        throw new AppError('只有管理员可撤销浏览器扩展', 403);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await browserExtensions.revoke(accountPrincipal.id, url.pathname.split('/')[3]));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.browserExtensions.list': browserExtensionsListHandler,
    'core.browserExtensions.pair': browserExtensionsListHandler,
    'core.mobile-companion.get': mobileCompanionGetHandler,
    'core.mobile-companion.change': mobileCompanionGetHandler,
    'core.browserExtensions.revoke': browserExtensionsRevokeHandler,
  };
}

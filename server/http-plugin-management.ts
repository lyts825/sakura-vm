/**
 * 模块职责：处理插件启停、配置与清理重试请求，核对请求路径与声明操作一致性。
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

export function pluginManagementHandlers(
  context: CoreHttpContext<'machines' | 'features' | 'plugins'>,
): CoreHttpHandlers {
  const { services, authorizedBody, authorized } = context;
  const lockdownGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { machines } = services;
    const route = url.pathname.split('/').filter(Boolean);
    if (route[1] === 'vms' && route[2] && route[3] === 'lockdown' && route.length === 4) {
      machines.get(route[2]);
      if (req.method === 'GET') return send(res, { locked: machines.incidentLocked(route[2]) });
      if (req.method === 'POST') {
        const input = z
          .object({ locked: z.boolean() })
          .strict()
          .parse(await authorizedBody(req));
        return send(res, await machines.setIncidentLockdown(route[2], input.locked));
      }
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const pluginsListHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, plugins } = services;
    if (url.pathname === '/api/plugins') {
      if (req.method === 'GET') return send(res, plugins.view());
      if (req.method === 'PATCH') {
        const releaseMutation = features.operations.enter();
        try {
          const input = await authorizedBody(req);
          if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
          return send(res, await plugins.change(input));
        } finally {
          releaseMutation();
        }
      }
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const communityPluginsListHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, plugins } = services;
    const principal = authorized(req);
    if (url.pathname === '/api/community-plugins') {
      if (principal.role !== 'owner') throw new AppError('只有管理员可管理第三方插件', 403);
      if (req.method === 'GET') return send(res, plugins.community.view());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await plugins.community.action(await authorizedBody(req, 64 * 1024)));
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const communityPluginsExtensionHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, plugins } = services;
    const principal = authorized(req);
    const route = url.pathname.split('/').filter(Boolean);
    if (route[1] === 'community-plugins' && route[2] === 'extensions' && route.length === 5) {
      if (principal.role !== 'owner') throw new AppError('只有管理员可调用第三方插件', 403);
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(
          res,
          await plugins.community.invokeRoute(route[3], route[4], await authorizedBody(req, 32 * 1024)),
        );
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.lockdown.get': lockdownGetHandler,
    'core.lockdown.set': lockdownGetHandler,
    'core.plugins.list': pluginsListHandler,
    'core.plugins.change': pluginsListHandler,
    'core.community-plugins.list': communityPluginsListHandler,
    'core.community-plugins.change': communityPluginsListHandler,
    'core.community-plugins.extension': communityPluginsExtensionHandler,
  };
}

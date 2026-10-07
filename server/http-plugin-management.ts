/**
 * 模块职责：处理插件启停、配置与清理重试请求，核对请求路径与声明操作一致性。
 * Module purpose: Handles plugin enablement, configuration and cleanup retries, checking handler paths against declared operations.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: pluginManagementHandlers.
 * 功能：创建插件目录、配置、启停与清理恢复的 HTTP 处理器。
 * Purpose: Builds plugin directory/configuration/start-stop/cleanup-recovery HTTP handlers.
 * 设计：操作路径先核对，插件实例代次及清理资格由管理层复核；不能用旧处理器绕过撤销。
 * Design: Paths are checked first and management rechecks instance generations/cleanup eligibility; stale handlers cannot bypass revocation.
 * 输入 / Inputs: context: CoreHttpContext<'machines' | 'features' | 'plugins'>
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.lockdown.get': lockdownGetHandler, 'core.lockdown.set': lockdownGetHandler, 'core.plugins.list': pluginsListHandler, …`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function pluginManagementHandlers(
  context: CoreHttpContext<'machines' | 'features' | 'plugins'>,
): CoreHttpHandlers {
  const { services, authorizedBody, authorized } = context;
  /**
   * 入口 / Entry: pluginManagementHandlers.lockdownGetHandler.
   * 功能：在处理插件启停、配置与清理重试请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { locked: machines.incidentLocked(route[2]) })` / `send(res, await machines.setIncidentLockdown(route[2], input.locked))` 供上层消费（`http-plugin-management.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-plugin-management.ts`; this entry produces `send(res, { locked: machines.incidentLocked(route[2]) })` / `send(res, await machines.setIncidentLockdown(route[2], input.locked))` for its caller. Module context: Handles plugin enablement, configuration and cleanup retries, checking handler paths against declared operations.
   * 处理：通过 `url.pathname.split().filter`, `url.pathname.split`, `machines.get`, `send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `url.pathname.split().filter`, `url.pathname.split`, `machines.get`, `send`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { locked: machines.incidentLocked(route[2]) })`; `send(res, await machines.setIncidentLockdown(route[2], input.locked))`.
   * 副作用 / Effects: `send`; `machines.setIncidentLockdown`.
   * 拒绝 / Refusals: 条件 / conditions `route[1] === 'vms' && route[2] && route[3] === 'lockdown' && route.length === 4`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
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
  /**
   * 入口 / Entry: pluginManagementHandlers.pluginsListHandler.
   * 功能：在处理插件启停、配置与清理重试请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, plugins.view())` / `send(res, await plugins.change(input))` 供上层消费（`http-plugin-management.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-plugin-management.ts`; this entry produces `send(res, plugins.view())` / `send(res, await plugins.change(input))` for its caller. Module context: Handles plugin enablement, configuration and cleanup retries, checking handler paths against declared operations.
   * 处理：通过 `send`, `plugins.view`, `features.operations.enter`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `plugins.view`, `features.operations.enter`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, plugins.view())`; `send(res, await plugins.change(input))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/plugins'`; `req.method === 'PATCH'`; `features.migration?.blocked`; 异常 / errors `new AppError('数据目录迁移维护中', 409)`; `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: pluginManagementHandlers.communityPluginsListHandler.
   * 功能：在处理插件启停、配置与清理重试请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, plugins.community.view())` / `send(res, await plugins.community.action(await authorizedBody(req, 64 * 1024)))` 供上层消费（`http-plugin-management.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-plugin-management.ts`; this entry produces `send(res, plugins.community.view())` / `send(res, await plugins.community.action(await authorizedBody(req, 64 * 1024)))` for its caller. Module context: Handles plugin enablement, configuration and cleanup retries, checking handler paths against declared operations.
   * 处理：通过 `authorized`, `send`, `plugins.community.view`, `features.operations.enter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authorized`, `send`, `plugins.community.view`, `features.operations.enter`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, plugins.community.view())`; `send(res, await plugins.community.action(await authorizedBody(req, 64 * 1024)))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/community-plugins'`; `principal.role !== 'owner'`; `req.method !== 'POST'`; 异常 / errors `new AppError('只有管理员可管理第三方插件', 403)`; `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: pluginManagementHandlers.communityPluginsExtensionHandler.
   * 功能：在处理插件启停、配置与清理重试请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await plugins.community.invokeRoute(route[3], route[4], await authorizedBody(req, 32 * 1024)), )` 供上层消费（`http-plugin-management.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-plugin-management.ts`; this entry produces `send( res, await plugins.community.invokeRoute(route[3], route[4], await authorizedBody(req, 32 * 1024)), )` for its caller. Module context: Handles plugin enablement, configuration and cleanup retries, checking handler paths against declared operations.
   * 处理：通过 `authorized`, `url.pathname.split().filter`, `url.pathname.split`, `features.operations.enter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authorized`, `url.pathname.split().filter`, `url.pathname.split`, `features.operations.enter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, await plugins.community.invokeRoute(route[3], route[4], await authorizedBody(req, 32 * 1024)), )`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `route[1] === 'community-plugins' && route[2] === 'extensions' && route.length === 5`; `principal.role !== 'owner'`; `req.method !== 'POST'`; 异常 / errors `new AppError('只有管理员可调用第三方插件', 403)`; `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
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

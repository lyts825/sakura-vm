/**
 * 模块职责：处理浏览器扩展和移动伴侣请求，管理动作受管理员权限限制。
 * Module purpose: Handles extension and mobile-companion requests, restricting management effects to administrators.
 */
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { sendJson as send } from './http-response.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: companionHandlers.
 * 功能：从当前输入或状态计算 `{ 'core.browserExtensions.list': browserExtensionsListHandler, 'core.browserExtensions.pair': browserExtensionsListHandler, '…`，供调用方后续验证或使用。
 * Purpose: Computes `{ 'core.browserExtensions.list': browserExtensionsListHandler, 'core.browserExtensions.pair': browserExtensionsListHandler, '…` from current inputs/state for the caller to validate or consume.
 * 输入 / Inputs: context: CoreHttpContext< 'browserExtensions' | 'access' | 'features' | 'hostPeers' | 'mobileC…
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.browserExtensions.list': browserExtensionsListHandler, 'core.browserExtensions.pair': browserExtensionsListHandler, '…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function companionHandlers(
  context: CoreHttpContext<
    'browserExtensions' | 'access' | 'features' | 'hostPeers' | 'mobileCompanion' | 'requireService'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody } = context;
  /**
   * 入口 / Entry: companionHandlers.browserExtensionsListHandler.
   * 功能：在处理浏览器扩展和移动伴侣请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { connections: browserExtensions.list(accountPrincipal.id) })` / `send(res, browserExtensions.createPairing(accountPrincipal.id), 201)` 供上层消费（`http-companions.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-companions.ts`; this entry produces `send(res, { connections: browserExtensions.list(accountPrincipal.id) })` / `send(res, browserExtensions.createPairing(accountPrincipal.id), 201)` for its caller. Module context: Handles extension and mobile-companion requests, restricting management effects to administrators.
   * 处理：通过 `services.requireService`, `access.authorize`, `send`, `browserExtensions.list` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `access.authorize`, `send`, `browserExtensions.list`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { connections: browserExtensions.list(accountPrincipal.id) })`; `send(res, browserExtensions.createPairing(accountPrincipal.id), 201)`.
   * 副作用 / Effects: `send`; `browserExtensions.createPairing`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/browser-extensions'`; `accountPrincipal?.role !== 'owner'`; `req.method !== 'POST'`; 异常 / errors `new AppError('只有管理员可管理浏览器扩展', 403)`; `new AppError('不支持此方法', 405)`.
   */
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
  /**
   * 入口 / Entry: companionHandlers.mobileCompanionGetHandler.
   * 功能：在处理浏览器扩展和移动伴侣请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...mobileCompanion.view(accountPrincipal.id), listener: hostPeers.view().listener, fingerprint: hostPeers.view().…` / `send(res, await mobileCompanion.action(accountPrincipal.id, await authorizedBody(req, 4096)))` 供上层消费（`http-companions.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-companions.ts`; this entry produces `send(res, { ...mobileCompanion.view(accountPrincipal.id), listener: hostPeers.view().listener, fingerprint: hostPeers.view().…` / `send(res, await mobileCompanion.action(accountPrincipal.id, await authorizedBody(req, 4096)))` for its caller. Module context: Handles extension and mobile-companion requests, restricting management effects to administrators.
   * 处理：通过 `access.authorize`, `send`, `mobileCompanion.view`, `hostPeers.view` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `mobileCompanion.view`, `hostPeers.view`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...mobileCompanion.view(accountPrincipal.id), listener: hostPeers.view().listener, fingerprint: hostPeers.view().…`; `send(res, await mobileCompanion.action(accountPrincipal.id, await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/mobile-companion'`; `accountPrincipal?.role !== 'owner'`; `req.method !== 'POST'`; 异常 / errors `new AppError('只有管理员可管理移动伴侣', 403)`; `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
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
  /**
   * 入口 / Entry: companionHandlers.browserExtensionsRevokeHandler.
   * 功能：在处理浏览器扩展和移动伴侣请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await browserExtensions.revoke(accountPrincipal.id, url.pathname.split('/')[3]))` 供上层消费（`http-companions.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-companions.ts`; this entry produces `send(res, await browserExtensions.revoke(accountPrincipal.id, url.pathname.split('/')[3]))` for its caller. Module context: Handles extension and mobile-companion requests, restricting management effects to administrators.
   * 处理：通过 `services.requireService`, `access.authorize`, `inline.test`, `features.operations.enter` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `access.authorize`, `inline.test`, `features.operations.enter`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await browserExtensions.revoke(accountPrincipal.id, url.pathname.split('/')[3]))`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `/^\/api\/browser-extensions\/[a-f0-9-]{36}$/.test(url.pathname)`; `req.method !== 'DELETE' || accountPrincipal?.role !== 'owner'`; `features.migration?.blocked`; 异常 / errors `new AppError('只有管理员可撤销浏览器扩展', 403)`; `new AppError('数据目录迁移维护中', 409)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
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

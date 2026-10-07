/**
 * 模块职责：装配 HTTP、插件路由与升级请求入口；统一执行授权、审计和响应契约检查。
 * Module purpose: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
 */
import type { ResourceScopeV1 } from './service-contracts/v1.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { AppError } from '../shared/errors.ts';
import { closeSocket, socketContracts, SOCKET_CLIENT_BYTES, type SocketChannel } from '../shared/contracts/websocket.ts';

import type { ApplicationServices } from './application-services.ts';
import { attachApplicationWebSocket } from './application-websocket.ts';
import { extensionOrigin } from './browser-extensions.ts';

import { listenHttpServer } from './http-listener.ts';
import { createMachineApi } from './http-machines.ts';
import { coreHttpHandlers } from './core-http-handlers.ts';
import { sendJson as send, writeResponseHead } from './http-response.ts';
import { DocumentResponseCache } from './document-response-cache.ts';
import { readFormBody, readJsonBody, requestUrl } from './http.ts';

import { networkFor } from './network/index.ts';

import { createOperationAuthority } from './operation-authority.ts';
import { operationEntries, type OperationEntry } from './operation-catalog.ts';
import { matchOperationPath } from './plugins/registry.ts';

import {
  OperationGateway,
  currentOperation,
  validateOperationInput,
  operationPreflightFailure,
  type HttpOperationHandler,
} from './operation-gateway.ts';

import { PORT, ROOT } from './paths.ts';

import { guestInteropRequest } from './process-interop.ts';

import { projectSchema } from './project-config.ts';

import { sameOrigin, tokenMatches } from './security.ts';
import { ssoCallbackPage } from './sso.ts';

import { OperationResults, noteOperationBusinessResult } from './operation-results.ts';
import { prepareOperationInput, operationResultPool } from './operation-input.ts';
import type { OperationResult } from '../shared/contracts/operation-results.ts';
import { publicApiFailure } from './api-errors.ts';
import { stageOperationResponse } from './operation-response.ts';
import { resourceContext } from './host-runtime/context.ts';
import { runtimeTimings } from './runtime-timings.ts';
import { withAuditFailureObserver } from './operation-context.ts';
import { requestScope } from './operation-scope.ts';
import { pluginAuthority } from './plugin-authority.ts';
const { createHttpServer: createServer } = networkFor('core:application');
/**
 * 入口 / Entry: body.
 * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `validateOperationInput(await readJsonBody(req, limit, signal))` 供上层消费（`application-http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `validateOperationInput(await readJsonBody(req, limit, signal))` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
 * 处理：通过 `validateOperationInput`, `readJsonBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `validateOperationInput`, `readJsonBody`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: req: IncomingMessage; limit: number optional; signal: AbortSignal optional
 * 输出 / Returns: `validateOperationInput(await readJsonBody(req, limit, signal))`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
const body = async (req: IncomingMessage, limit?: number, signal?: AbortSignal) =>
  validateOperationInput(await readJsonBody(req, limit, signal));

/** Preflight reads retain the admitted generation's cancellation and queue accounting. */
/**
 * 入口 / Entry: prepareHttpOperationInput.
 * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`application-http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `void` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
 * 处理：通过 `requestScope`, `pluginAuthority`, `AbortSignal.any`, `instance.scope.run` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `requestScope`, `pluginAuthority`, `AbortSignal.any`, `instance.scope.run`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!entry.declaration.mutating || entry.requestContract?.kind !== 'json'`.
 * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; entry: OperationEntry
 * 输出 / Returns: `void`.
 * 副作用 / Effects: `requestScope`; `AbortSignal.any`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 * 收尾：退出 try 区域时始终执行 `scope.dispose();`；这些步骤也适用于异常退出。
 * Finalization: Leaving the try region always executes `scope.dispose();`; these steps also apply to exceptional exits.
 */
export async function prepareHttpOperationInput(
  req: IncomingMessage,
  res: ServerResponse,
  entry: OperationEntry,
) {
  if (!entry.declaration.mutating || entry.requestContract?.kind !== 'json') return;
  const scope = requestScope(req, res);
  const instance = pluginAuthority();
  const signal = instance ? AbortSignal.any([scope.signal, instance.signal]) : scope.signal;
  /**
   * 入口 / Entry: prepareHttpOperationInput.prepare.
   * 功能：把本层请求转交 `prepareOperationInput`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `prepareOperationInput` and propagates the provider result or rejection.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: `prepareOperationInput(req, entry, { signal })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const prepare = () => prepareOperationInput(req, entry, { signal });
  try {
    await (instance ? instance.scope.run(prepare) : prepare());
  } finally {
    scope.dispose();
  }
}

/** Rejections have no admitted operation context; never record credentials, query or body. */
/**
 * 入口 / Entry: rejectedRequestAuditEvent.
 * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `{ kind: 'request' as const, name: (method + ' ' + safePath).slice(0, 200), ...(entry ? { operationId: entry.declaration.id } …` 供上层消费（`application-http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `void` / `{ kind: 'request' as const, name: (method + ' ' + safePath).slice(0, 200), ...(entry ? { operationId: entry.declaration.id } …` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
 * 处理：通过 `inline.test`, `requestUrl`, `url.pathname.startsWith`, `entries.filter().sort` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `inline.test`, `requestUrl`, `url.pathname.startsWith`, `entries.filter().sort`; the branches below determine continuation, return or refusal.
 * 分支 / Branches: `!url?.pathname.startsWith('/api/')`; `['GET', 'HEAD', 'OPTIONS'].includes(method) && !entry?.declaration.mutating`.
 * 输入 / Inputs: req: Pick<IncomingMessage, 'method' | 'url'>; entries: default=operationEntries
 * 输出 / Returns: `void`; `{ kind: 'request' as const, name: (method + ' ' + safePath).slice(0, 200), ...(entry ? { operationId: entry.declaration.id } …`.
 * 副作用 / Effects: `requestUrl`; `url.pathname.startsWith`.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export function rejectedRequestAuditEvent(
  req: Pick<IncomingMessage, 'method' | 'url'>,
  entries = operationEntries,
) {
  const method = req.method && /^[A-Z]{1,16}$/.test(req.method) ? req.method : 'UNKNOWN';
  const url = requestUrl(req.url, PORT);
  if (!url?.pathname.startsWith('/api/')) return;
  const matches = entries
    .filter((entry) => matchOperationPath(entry.declaration.path, url.pathname))
    .sort(
      (a, b) =>
        (a.declaration.path.match(/\{/g)?.length || 0) - (b.declaration.path.match(/\{/g)?.length || 0),
    );
  const path = matches[0]?.declaration.path;
  const entry = matches.find(
    (candidate) => candidate.declaration.path === path && candidate.declaration.method === method,
  );
  if (['GET', 'HEAD', 'OPTIONS'].includes(method) && !entry?.declaration.mutating) return;
  const safePath =
    path ||
    (url.pathname.length > 180
      ? '/api/<redacted>'
      : url.pathname
          .split('/')
          .map((segment) => (!segment || /^[a-z][a-z-]{0,31}$/.test(segment) ? segment : '<redacted>'))
          .join('/'));
  return {
    kind: 'request' as const,
    name: (method + ' ' + safePath).slice(0, 200),
    ...(entry ? { operationId: entry.declaration.id } : {}),
  };
}

/** The rejection is already primary; a failed start/end audit must only add a diagnostic. */
/**
 * 入口 / Entry: auditRejectedRequest.
 * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
 * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
 * 处理：通过 `withAuditFailureObserver` 协调依赖；下列分支决定是否继续、返回或拒绝。
 * Processing: Coordinates its dependencies through `withAuditFailureObserver`; the branches below determine continuation, return or refusal.
 * 输入 / Inputs: audit: Pick<ApplicationServices['audit'], 'span'>; event: NonNullable<ReturnType<typeof rejectedRequestAuditEvent>>; error: unknown; onAuditFailure: () => void
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
 */
export async function auditRejectedRequest(
  audit: Pick<ApplicationServices['audit'], 'span'>,
  event: NonNullable<ReturnType<typeof rejectedRequestAuditEvent>>,
  error: unknown,
  onAuditFailure: () => void,
) {
  await withAuditFailureObserver(onAuditFailure, async () => {
    try {
      await audit.span(event, async () => {
        throw error;
      });
    } catch {
      /* The HTTP catch retains its exact original rejection, including primitive throws. */
    }
  });
}

/**
 * 入口 / Entry: startApplicationHttp.
 * 功能：装配核心与插件路由、认证回调和升级协议，在操作目录封存后开放 HTTP 监听。
 * Purpose: Assembles core/plugin routes, authentication callbacks and upgrades, opening HTTP only after the operation directory is sealed.
 * 设计：请求处理先绑定授权与目标身份；有限变更响应待审计和持久回执确认后才发布，断开连接会取消相关资源。
 * Design: Requests bind authority and target identity first; finite mutation responses publish after audit/receipt confirmation, and disconnects cancel associated work.
 * 输入 / Inputs: services: ApplicationServices; resources: ResourceScopeV1
 * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
 * 副作用 / Effects: `resources.defer`; `createOperationAuthority`; `createMachineApi`; `gateway.register`; `createServer`; 更新 / updates `services.connectionHooks.terminate`, `implementedHandlers[entry.declaration.id]`, `vite`.
 * 拒绝 / Refusals: 条件 / conditions `!entry`; 异常 / errors `new Error('处理器缺少操作声明，禁止发布：' + id)`.
 */
export async function startApplicationHttp(services: ApplicationServices, resources: ResourceScopeV1) {
  const { engine, usbHotplug, projectExecution } = services;
  const {
    access,
    assistant,
    audit,
    browserExtensions,
    dev,
    features,
    machines,
    native,
    passkeys,
    processInterop,
    projectPermissions,
    projectTerminals,
    retention,
    session,
    sso,
    terminalSharing,
    plugins,
  } = services;
  const ws = new WebSocketServer({ noServer: true, maxPayload: SOCKET_CLIENT_BYTES });
  resources.defer(
    'websockets',
    () => {
      for (const socket of ws.clients) socket.close();
      ws.close();
    },
    0,
  );
  const protectedResponses = new Set<ServerResponse>();
  /**
   * 入口 / Entry: startApplicationHttp.callback@163.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（services.onSessionChange）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (services.onSessionChange).
   * 输入 / Inputs: locked; transitioned
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `response.destroy`; `machines.emit`; 更新 / updates `services.token`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  services.onSessionChange((locked, transitioned) => {
    if (transitioned) services.token = randomBytes(32).toString('hex');
    if (locked) {
      access.revokeAll();
      sso.cancelPending();
      native?.revoke();
      assistant?.revoke();
      for (const client of ws.clients) client.terminate();
      for (const response of protectedResponses) response.destroy();
    }
    machines.emit('change');
  });
  /**
   * 入口 / Entry: startApplicationHttp.services.connectionHooks.terminate.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `client.terminate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `client.terminate`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  services.connectionHooks.terminate = () => {
    for (const client of ws.clients) client.terminate();
  };
  const socketVms = new WeakMap<WebSocket, string>();
  const socketPlugins = new WeakMap<
    WebSocket,
    { identity: string; generation: string; accountId?: string; vmId?: string; projectId?: string }
  >();
  const socketAccounts = new WeakMap<WebSocket, string>();
  const socketCredentials = new WeakMap<WebSocket, string>();
  const socketTerminalGrants = new WeakMap<WebSocket, string>();
  /**
   * 入口 / Entry: startApplicationHttp.terminateAccountSockets.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `socketAccounts.get`, `client.terminate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socketAccounts.get`, `client.terminate`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `socketAccounts.get(client) === id`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const terminateAccountSockets = (id: string) => {
    for (const client of ws.clients) if (socketAccounts.get(client) === id) client.terminate();
  };
  /**
   * 入口 / Entry: startApplicationHttp.terminateCredentialSockets.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `socketCredentials.get`, `client.terminate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socketCredentials.get`, `client.terminate`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `socketCredentials.get(client) === credential`.
   * 输入 / Inputs: credential: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const terminateCredentialSockets = (credential: string) => {
    for (const client of ws.clients) if (socketCredentials.get(client) === credential) client.terminate();
  };
  /**
   * 入口 / Entry: startApplicationHttp.terminateTerminalGrantSockets.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `socketTerminalGrants.get`, `client.terminate` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `socketTerminalGrants.get`, `client.terminate`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `socketTerminalGrants.get(client) === id`.
   * 输入 / Inputs: id: string
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const terminateTerminalGrantSockets = (id: string) => {
    for (const client of ws.clients) if (socketTerminalGrants.get(client) === id) client.terminate();
  };
  machines.on('incident-lockdown', (id: string) => {
    for (const store of features.jobStores())
      for (const job of store.list())
        if (job.vmId === id && job.status === 'running' && job.id) store.cancel(job.id);
    for (const socket of ws.clients)
      if (socketVms.get(socket) === id) closeSocket(socket, 'incidentLockdown');
  });
  let vite: Awaited<ReturnType<typeof import('vite').createServer>> | undefined;
  /**
   * 入口 / Entry: startApplicationHttp.equalToken.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `tokenMatches(value, services.token)` / `access.authorize(value).role === 'owner'` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `tokenMatches(value, services.token)` / `access.authorize(value).role === 'owner'` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `tokenMatches`, `access.authorize` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `tokenMatches`, `access.authorize`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!access.enabled`.
   * 输入 / Inputs: value: unknown
   * 输出 / Returns: `tokenMatches(value, services.token)`; `access.authorize(value).role === 'owner'`; `false`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return false;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return false;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const equalToken = (value: unknown) => {
    if (!access.enabled) return tokenMatches(value, services.token);
    try {
      return access.authorize(value).role === 'owner';
    } catch {
      return false;
    }
  };
  /**
   * 入口 / Entry: startApplicationHttp.socketAuthorization.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `equalToken(credential) ? { role: 'owner' as const } : null` / `null` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `equalToken(credential) ? { role: 'owner' as const } : null` / `null` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `equalToken`, `access.authorize`, `authentication.accountRoles.some`, `principal.vmIds.includes` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `equalToken`, `access.authorize`, `authentication.accountRoles.some`, `principal.vmIds.includes`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `!access.enabled`; `!authentication?.accountRoles.some(role => role === principal.role)`.
   * 输入 / Inputs: credential: string; mode: string; id: string; terminalSession: string | null optional; terminalProject: string | null optional
   * 输出 / Returns: `equalToken(credential) ? { role: 'owner' as const } : null`; `null`; `principal.role === 'owner' || (principal.role === 'viewer' && principal.vmIds.includes(id) && (authentication.viewerGrant ===…`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   * 失败处理：catch 分支执行 `return null;`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `return null;`; these statements determine whether a failure is absorbed or rejected again.
   */
  const socketAuthorization = (
    credential: string,
    mode: string,
    id: string,
    terminalSession?: string | null,
    terminalProject?: string | null,
  ) => {
    if (!access.enabled) return equalToken(credential) ? { role: 'owner' as const } : null;
    try {
      const principal = access.authorize(credential);
      const authentication = socketContracts[mode as SocketChannel]?.authentication;
      if (!authentication?.accountRoles.some(role => role === principal.role)) return null;
      return principal.role === 'owner' ||
        (principal.role === 'viewer' &&
          principal.vmIds.includes(id) &&
          (authentication.viewerGrant === 'vm' ||
            (authentication.viewerGrant === 'terminal' &&
              !!terminalSession &&
              !!terminalSharing?.find(principal.id, id, terminalSession, terminalProject))))
        ? principal
        : null;
    } catch {
      return null;
    }
  };
  /**
   * 入口 / Entry: startApplicationHttp.allowedRequest.
   * 功能：把本层请求转交 `sameOrigin`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `sameOrigin` and propagates the provider result or rejection.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: `sameOrigin(req.headers, PORT)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const allowedRequest = (req: IncomingMessage) => sameOrigin(req.headers, PORT);
  /**
   * 入口 / Entry: startApplicationHttp.requirePasskeyOrigin.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，核对调用资格、输入或资源归属；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Checks admission, input or resource ownership in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `req.headers.host !== `localhost:${PORT}``; 异常 / errors `new AppError('通行密钥需要在 localhost 页面使用', 400)`.
   */
  const requirePasskeyOrigin = (req: IncomingMessage) => {
    if (req.headers.host !== `localhost:${PORT}`)
      throw new AppError('通行密钥需要在 localhost 页面使用', 400);
  };
  /**
   * 入口 / Entry: startApplicationHttp.authorized.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，核对调用资格、输入或资源归属；本入口产生 `access.authorize(req.headers['x-sakura-token'])` / `{ role: 'owner' as const }` 供上层消费（`application-http.ts`）。
   * Purpose: Checks admission, input or resource ownership in `application-http.ts`; this entry produces `access.authorize(req.headers['x-sakura-token'])` / `{ role: 'owner' as const }` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `session.requireUnlocked`, `access.authorize`, `equalToken` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `session.requireUnlocked`, `access.authorize`, `equalToken`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `access.enabled`.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: `access.authorize(req.headers['x-sakura-token'])`; `{ role: 'owner' as const }`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `!equalToken(req.headers['x-sakura-token'])`; 异常 / errors `new AppError('访问凭证已过期，请刷新页面', 401)`.
   */
  const authorized = (req: IncomingMessage) => {
    session.requireUnlocked();
    if (access.enabled) return access.authorize(req.headers['x-sakura-token']);
    if (!equalToken(req.headers['x-sakura-token'])) throw new AppError('访问凭证已过期，请刷新页面', 401);
    return { role: 'owner' as const };
  };
  /**
   * 入口 / Entry: startApplicationHttp.authorizedBody.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，核对调用资格、输入或资源归属；本入口产生 `input` 供上层消费（`application-http.ts`）。
   * Purpose: Checks admission, input or resource ownership in `application-http.ts`; this entry produces `input` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `body`, `authorized` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `body`, `authorized`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req: IncomingMessage; limit: number optional; signal: AbortSignal optional
   * 输出 / Returns: `input`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const authorizedBody = async (req: IncomingMessage, limit?: number, signal?: AbortSignal) => {
    const input = await body(req, limit, signal);
    authorized(req);
    return input;
  };
  plugins.assertReady();
  const gateway = new OperationGateway({
    /**
     * 入口 / Entry: startApplicationHttp.enabled.
     * 功能：从当前输入或状态计算 `features.enabled`，供调用方后续验证或使用。
     * Purpose: Computes `features.enabled` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `features.enabled`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     */
    enabled: () => features.enabled,
    /**
     * 入口 / Entry: startApplicationHttp.owner.
     * 功能：从当前输入或状态计算 `entry.transport === 'websocket' ? (url.searchParams.has('session') ? entry.sessionOwner : undefined) || entry.executionOwner …`，供调用方后续验证或使用。
     * Purpose: Computes `entry.transport === 'websocket' ? (url.searchParams.has('session') ? entry.sessionOwner : undefined) || entry.executionOwner …` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: url; entry
     * 输出 / Returns: `entry.transport === 'websocket' ? (url.searchParams.has('session') ? entry.sessionOwner : undefined) || entry.executionOwner …`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    owner: (url, entry) =>
      entry.transport === 'websocket'
        ? (url.searchParams.has('session') ? entry.sessionOwner : undefined) ||
          entry.executionOwner ||
          entry.owner
        : entry.owner,
    /**
     * 入口 / Entry: startApplicationHttp.instance.
     * 功能：从当前输入或状态计算 `owner === 'core' ? plugins.system.caller : plugins.directory.get('official', owner)`，供调用方后续验证或使用。
     * Purpose: Computes `owner === 'core' ? plugins.system.caller : plugins.directory.get('official', owner)` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: owner
     * 输出 / Returns: `owner === 'core' ? plugins.system.caller : plugins.directory.get('official', owner)`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    instance: (owner) =>
      owner === 'core' ? plugins.system.caller : plugins.directory.get('official', owner),
    /**
     * 入口 / Entry: startApplicationHttp.catalogVersion.
     * 功能：从当前输入或状态计算 `plugins.directory.view().version`，供调用方后续验证或使用。
     * Purpose: Computes `plugins.directory.view().version` from current inputs/state for the caller to validate or consume.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `plugins.directory.view().version`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    catalogVersion: () => plugins.directory.view().version,
    bind: createOperationAuthority({
      machines,
      features,
      access,
      session,
      projectPermissions,
      browserExtensions: {
        /**
         * 入口 / Entry: startApplicationHttp.authorize.
         * 功能：在装配 HTTP、插件路由与升级请求入口中，核对调用资格、输入或资源归属；本入口产生 `services.requireService('browserExtensions').authorize(...args)` 供上层消费（`application-http.ts`）。
         * Purpose: Checks admission, input or resource ownership in `application-http.ts`; this entry produces `services.requireService('browserExtensions').authorize(...args)` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
         * 处理：通过 `services.requireService().authorize`, `services.requireService` 协调依赖；下列分支决定是否继续、返回或拒绝。
         * Processing: Coordinates its dependencies through `services.requireService().authorize`, `services.requireService`; the branches below determine continuation, return or refusal.
         * 输入 / Inputs: args
         * 输出 / Returns: `services.requireService('browserExtensions').authorize(...args)`.
         * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        authorize: (...args) => services.requireService('browserExtensions').authorize(...args),
      },
      equalToken,
      socketAuthorization,
    }),
  });
  const documentResponses = new DocumentResponseCache();
  const operationResults = new OperationResults();
  const receipts = new WeakMap<ServerResponse, OperationResult>();
  const queryableReceipts = new WeakSet<ServerResponse>();
  const auditFailedResponses = new WeakSet<ServerResponse>();
  const enteredHandlers = new WeakSet<ServerResponse>();
  /**
   * 入口 / Entry: startApplicationHttp.sendSsoPage.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `ssoCallbackPage`, `writeResponseHead`, `res.end` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `ssoCallbackPage`, `writeResponseHead`, `res.end`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: res: ServerResponse; origin: string | null; state: string; result: unknown optional; error: string optional
   * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
   * 副作用 / Effects: `writeResponseHead`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const sendSsoPage = (
    res: ServerResponse,
    origin: string | null,
    state: string,
    result?: unknown,
    error?: string,
  ) => {
    const { html, nonce } = ssoCallbackPage(origin, state, result, error);
    writeResponseHead(res, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
    });
    res.end(html);
  };
  /**
   * 入口 / Entry: startApplicationHttp.samlPost.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `validateOperationInput({ SAMLResponse: form.get('SAMLResponse')!, RelayState: form.get('RelayState')!, })` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `validateOperationInput({ SAMLResponse: form.get('SAMLResponse')!, RelayState: form.get('RelayState')!, })` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `readFormBody`, `form.getAll`, `validateOperationInput`, `form.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `readFormBody`, `form.getAll`, `validateOperationInput`, `form.get`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req: IncomingMessage
   * 输出 / Returns: `validateOperationInput({ SAMLResponse: form.get('SAMLResponse')!, RelayState: form.get('RelayState')!, })`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 条件 / conditions `form.getAll('SAMLResponse').length !== 1 || form.getAll('RelayState').length !== 1`; 异常 / errors `new AppError('SAML 响应缺少唯一的状态与断言', 400)`.
   */
  const samlPost = async (req: IncomingMessage) => {
    const form = await readFormBody(req, 1_500_000);
    if (form.getAll('SAMLResponse').length !== 1 || form.getAll('RelayState').length !== 1)
      throw new AppError('SAML 响应缺少唯一的状态与断言', 400);
    return validateOperationInput({
      SAMLResponse: form.get('SAMLResponse')!,
      RelayState: form.get('RelayState')!,
    });
  };
  /**
   * 入口 / Entry: startApplicationHttp.extensionApi.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201)` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `void` / `send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201)` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `inline.includes`, `extensionOrigin`, `res.setHeader`, `writeResponseHead` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.includes`, `extensionOrigin`, `res.setHeader`, `writeResponseHead`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'OPTIONS'`.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL
   * 输出 / Returns: `void`; `send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201)`; `send(res, { permissions: grant.permissions, expiresAt: grant.expiresAt, checkedAt: new Date().toISOString(), vms: vms.map(({ …`.
   * 副作用 / Effects: `res.setHeader`; `writeResponseHead`; `protectedResponses.add`; `send`; `browserExtensions.connect`; 更新 / updates `origin`.
   * 拒绝 / Refusals: 条件 / conditions `![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || '')`; `req.method !== 'OPTIONS' && req.headers['x-sakura-extension-origin'] !== origin`; `!access.enabled`; 异常 / errors `new AppError('仅接受本机扩展连接', 403)`; `new Error('扩展来源不一致')`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   * 失败处理：catch 分支执行 `throw new AppError('需要有效的浏览器扩展来源', 403);`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `throw new AppError('需要有效的浏览器扩展来源', 403);`; these statements determine whether a failure is absorbed or rejected again.
   */
  const extensionApi = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || ''))
      throw new AppError('仅接受本机扩展连接', 403);
    let origin: string;
    try {
      origin = extensionOrigin(
        req.headers.origin || (req.method === 'GET' ? req.headers['x-sakura-extension-origin'] : undefined),
      );
      if (req.method !== 'OPTIONS' && req.headers['x-sakura-extension-origin'] !== origin)
        throw new Error('扩展来源不一致');
    } catch {
      throw new AppError('需要有效的浏览器扩展来源', 403);
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin, X-Sakura-Extension-Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Sakura-Extension-Origin, X-Sakura-Extension-Token',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      writeResponseHead(res, 204, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    session.requireUnlocked();
    protectedResponses.add(res);
    /**
     * 入口 / Entry: startApplicationHttp.unprotect.
     * 功能：把本层请求转交 `protectedResponses.delete`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `protectedResponses.delete` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `protectedResponses.delete(res)`.
     * 副作用 / Effects: `protectedResponses.delete`.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    const unprotect = () => protectedResponses.delete(res);
    res.once('finish', unprotect);
    res.once('close', unprotect);
    if (!access.enabled) throw new AppError('请先启用账户模式', 409);
    const browserExtensions = services.requireService('browserExtensions');
    if (url.pathname === '/api/extension/connect') {
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      if (features.migration?.blocked) throw new AppError('数据目录迁移维护中', 409);
      const releaseMutation = features.operations.enter();
      try {
        return send(res, await browserExtensions.connect(origin, await body(req, 4096)), 201);
      } finally {
        releaseMutation();
      }
    }
    if (url.pathname === '/api/extension/inventory') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      const grant = browserExtensions.authorize(origin, req.headers['x-sakura-extension-token']);
      const vms = await Promise.all([...machines.records.keys()].map((id) => machines.view(id)));
      session.requireUnlocked();
      return send(res, {
        permissions: grant.permissions,
        expiresAt: grant.expiresAt,
        checkedAt: new Date().toISOString(),
        vms: vms.map(({ id, name, status, distro, cpus, memoryMiB, diskGiB }) => ({
          id,
          name,
          status,
          distro,
          cpus,
          memoryMiB,
          diskGiB,
        })),
      });
    }
    throw new AppError('接口不存在', 404);
  };
  const machineApi = createMachineApi({
    machines,
    features,
    /**
     * 入口 / Entry: startApplicationHttp.pluginRuntime.
     * 功能：把本层请求转交 `plugins.directory.view`，沿用该实现的结果与失败路径。
     * Purpose: Delegates this request to `plugins.directory.view` and propagates the provider result or rejection.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: `plugins.directory.view()`.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    pluginRuntime: () => plugins.directory.view(),
    engine,
    session,
    usbHotplug,
    projectPermissions,
    projectExecution,
    authorizedBody,
  });
  const context = {
    services,
    body,
    authorizedBody,
    authorized,
    requirePasskeyOrigin,
    terminateAccountSockets,
    terminateCredentialSockets,
    terminateTerminalGrantSockets,
    /**
     * 入口 / Entry: startApplicationHttp.terminateSockets.
     * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`application-http.ts`）。
     * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; the calls and state transitions below complete the operation. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
     * 处理：通过 `client.terminate` 协调依赖；下列分支决定是否继续、返回或拒绝。
     * Processing: Coordinates its dependencies through `client.terminate`; the branches below determine continuation, return or refusal.
     * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
     * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
     * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
     * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
     */
    terminateSockets: () => {
      for (const client of ws.clients) client.terminate();
    },
    samlPost,
    sendSsoPage,
    operationResults,
    gateway,
    documentResponses,
  };
  /**
   * 入口 / Entry: startApplicationHttp.pluginApi.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` / `features.workspaces.projects.with(vmId, projectId, async () => { const previous = await features.workspaces.config(vmId); ret…` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `void` / `features.workspaces.projects.with(vmId, projectId, async () => { const previous = await features.workspaces.config(vmId); ret…` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `features.downloads.route`, `authorized`, `access.authorize`, `currentOperation` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `features.downloads.route`, `authorized`, `access.authorize`, `currentOperation`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `await features.downloads?.route(req, res, url)`; `accountPrincipal?.role === 'member' && operation.approval === 'project-change'`; `req.method !== 'GET' && req.method !== 'HEAD' && route[1] === 'vms' && route[2] && route[3] !== 'sto…`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `void`; `features.workspaces.projects.with(vmId, projectId, async () => { const previous = await features.workspaces.config(vmId); ret…`.
   * 副作用 / Effects: `features.downloads.route`.
   * 拒绝 / Refusals: 条件 / conditions `!operation`; 异常 / errors `new AppError('HTTP 入口缺少操作准入', 403, 'OPERATION_NOT_ADMITTED')`; `new AppError('插件处理器与操作声明不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const pluginApi: HttpOperationHandler = async (req, res, url) => {
    if (await features.downloads?.route(req, res, url)) return;
    authorized(req);
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    const operation = currentOperation();
    if (!operation) throw new AppError('HTTP 入口缺少操作准入', 403, 'OPERATION_NOT_ADMITTED');
    if (accountPrincipal?.role === 'member' && operation.approval === 'project-change') {
      const { parameters } = gateway.resolve(req.method || 'GET', url.pathname);
      const vmId = parameters.vmId;
      const projectId = url.searchParams.get('project')!;
      const proposal = projectSchema.parse(await authorizedBody(req, 32768));
      return features.workspaces.projects.with(vmId, projectId, async () => {
        const previous = await features.workspaces.config(vmId);
        return send(res, await features.workspaces.save(vmId, proposal, previous.directory));
      });
    }
    const route = url.pathname.split('/').filter(Boolean);
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      route[1] === 'vms' &&
      route[2] &&
      route[3] !== 'stop' &&
      route[3] !== 'next-features'
    )
      machines.requireUnlocked(route[2]);
    if (
      await features.route(req, res, url, (request, signal, limit) => authorizedBody(request, limit, signal))
    )
      return;
    throw new AppError('插件处理器与操作声明不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: startApplicationHttp.machineHandler.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `void` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `void` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `url.pathname.split().filter`, `url.pathname.split`, `machines.requireUnlocked`, `machineApi` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `url.pathname.split().filter`, `url.pathname.split`, `machines.requireUnlocked`, `machineApi`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method !== 'GET' && req.method !== 'HEAD' && route[1] === 'vms' && route[2] && route[3] !== 'sto…`; `await machineApi(req, res, url)`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `void`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 拒绝 / Refusals: 异常 / errors `new AppError('实例处理器与操作声明不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const machineHandler: HttpOperationHandler = async (req, res, url) => {
    const route = url.pathname.split('/').filter(Boolean);
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      route[1] === 'vms' &&
      route[2] &&
      route[3] !== 'stop' &&
      route[3] !== 'next-features'
    )
      machines.requireUnlocked(route[2]);
    if (await machineApi(req, res, url)) return;
    throw new AppError('实例处理器与操作声明不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };

  /**
   * 入口 / Entry: startApplicationHttp.guestApi.
   * 功能：在装配 HTTP、插件路由与升级请求入口中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await processInterop.guest( input, Array.isArray(req.headers['x-sakura-guest-token']) ? undefined : req.headers['x…` 供上层消费（`application-http.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `application-http.ts`; this entry produces `send( res, await processInterop.guest( input, Array.isArray(req.headers['x-sakura-guest-token']) ? undefined : req.headers['x…` for its caller. Module context: Assembles HTTP routes and upgrade entry points, applying shared authorization, auditing and response contracts.
   * 处理：通过 `inline.includes`, `guestInteropRequest.parse`, `body`, `send` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `inline.includes`, `guestInteropRequest.parse`, `body`, `send`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse
   * 输出 / Returns: `send( res, await processInterop.guest( input, Array.isArray(req.headers['x-sakura-guest-token']) ? undefined : req.headers['x…`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') || ![`127.0.0.1:${PORT}`, `localhost:${POR…`; 异常 / errors `new AppError('仅接受本机客户机连接', 403)`.
   */
  const guestApi = async (req: IncomingMessage, res: ServerResponse) => {
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') ||
      ![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(req.headers.host || '') ||
      req.headers.origin ||
      req.headers['sec-fetch-site']
    )
      throw new AppError('仅接受本机客户机连接', 403);
    const input = guestInteropRequest.parse(await body(req, 4096));
    return send(
      res,
      await processInterop.guest(
        input,
        Array.isArray(req.headers['x-sakura-guest-token']) ? undefined : req.headers['x-sakura-guest-token'],
      ),
    );
  };
  const implementedHandlers = coreHttpHandlers(context, {
    machine: machineHandler,
    plugin: pluginApi,
    guest: guestApi,
    extension: extensionApi,
  });
  // Disabled declarations retain their explicit unavailable route without importing implementation code.
  // Enabled modules have already validated their exact handlers during activation; CI checks every module.
  for (const entry of operationEntries) {
    if (entry.declaration.owner !== 'core' && entry.declaration.method !== 'UPGRADE')
      implementedHandlers[entry.declaration.id] = pluginApi;
  }
  for (const [id, handler] of Object.entries(implementedHandlers)) {
    const entry = operationEntries.find((candidate) => candidate.declaration.id === id);
    if (!entry) throw new Error('处理器缺少操作声明，禁止发布：' + id);
    /**
     * 入口 / Entry: startApplicationHttp.callback@482.
     * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（gateway.register）。
     * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (gateway.register).
     * 输入 / Inputs: req; res; url
     * 输出 / Returns: `runtimeTimings.measure('http', 'execution', () => handler(req, res, url, entry))`; `result`.
     * 副作用 / Effects: `protectedResponses.add`; `enteredHandlers.add`; `staged.publish`; `operationResults.start`; `receipts.set`; 更新 / updates `receipt`.
     * 拒绝 / Refusals: 条件 / conditions `entry.declaration.id === 'core.operation-results.archive'`; `error instanceof AppError`; 异常 / errors `error`; `new AppError('操作结果存储暂不可用', 503, 'OPERATION_RESULT_UNAVAILABLE')`.
     * 失败处理：catch 分支执行 `staged.discard();`; `throw error;`，是否吞掉错误或重新拒绝由这些语句决定。
     * Failure handling: Catch paths execute `staged.discard();`; `throw error;`; these statements determine whether a failure is absorbed or rejected again.
     */
    gateway.register(entry, async (req, res, url) => {
      if (entry.declaration.access === 'controller') {
        authorized(req);
      }
      // A session lock must terminate protected streams, including ticket downloads,
      // while preserving its own response and public authentication/callback protocols.
      if (
        ['controller', 'download-ticket'].includes(entry.declaration.access) &&
        entry.declaration.id !== 'core.session.lock'
      ) {
        protectedResponses.add(res);
        /**
         * 入口 / Entry: startApplicationHttp.remove.
         * 功能：把本层请求转交 `protectedResponses.delete`，沿用该实现的结果与失败路径。
         * Purpose: Delegates this request to `protectedResponses.delete` and propagates the provider result or rejection.
         * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
         * 输出 / Returns: `protectedResponses.delete(res)`.
         * 副作用 / Effects: `protectedResponses.delete`.
         * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
         */
        const remove = () => protectedResponses.delete(res);
        res.once('finish', remove);
        res.once('close', remove);
      }
      if (!entry.declaration.mutating)
        return runtimeTimings.measure('http', 'execution', () => handler(req, res, url, entry));
      await prepareHttpOperationInput(req, res, entry);
      // Archival carries its own durable evidence and must remain reachable when every receipt pool is full.
      if (entry.declaration.id === 'core.operation-results.archive') {
        enteredHandlers.add(res);
        const staged = stageOperationResponse(res);
        try {
          const result = await withAuditFailureObserver(
            () => auditFailedResponses.add(res),
            () => audit.span(
              { kind: 'request', name: entry.declaration.id, operationId: entry.declaration.id },
              () => runtimeTimings.measure('http', 'execution', () => handler(req, res, url, entry)),
              () => res.statusCode,
            ),
          );
          staged.publish();
          return result;
        } catch (error) {
          staged.discard();
          throw error;
        }
      }
      let receipt: Awaited<ReturnType<OperationResults['start']>>;
      /**
       * 入口 / Entry: startApplicationHttp.callback@524.
       * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（audit.span）。
       * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (audit.span).
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `result`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      /**
       * 入口 / Entry: startApplicationHttp.invoke.
       * 功能：把本层请求转交 `audit.span`，沿用该实现的结果与失败路径。
       * Purpose: Delegates this request to `audit.span` and propagates the provider result or rejection.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: `audit.span( { kind: 'request', name: entry.declaration.id, operationId: entry.declaration.id }, async () => { await operation…`.
       * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const invoke = () =>
        audit.span(
          { kind: 'request', name: entry.declaration.id, operationId: entry.declaration.id },
          async () => {
            await operationResults.begin(receipt);
            const result = await runtimeTimings.measure('http', 'execution', () =>
              handler(req, res, url, entry),
            );
            noteOperationBusinessResult(res.statusCode);
            return result;
          },
          () => res.statusCode,
        );
      const correlationId = String(res.getHeader('X-Sakura-Correlation-Id'));
      const actorId = resourceContext()?.actorId;
      try {
        receipt = await operationResults.start(
          correlationId,
          entry.declaration.id,
          access.enabled ? (actorId ? 'account' : 'anonymous:' + correlationId) : 'local-owner',
          actorId,
          { pool: operationResultPool(entry.declaration.id) },
        );
      } catch (error) {
        receipts.set(res, {
          correlationId,
          operationId: entry.declaration.id,
          outcome: 'failed',
          executed: false,
          startedAt: new Date().toISOString(),
          responseValidated: false,
          auditRecorded: false,
          delivery: 'failed',
          errorCode: 'OPERATION_RESULT_UNAVAILABLE',
        });
        if (error instanceof AppError) throw error;
        throw new AppError('操作结果存储暂不可用', 503, 'OPERATION_RESULT_UNAVAILABLE');
      }
      const staged = ['json', 'text', 'empty'].includes(entry.responseContract?.kind || '')
        ? stageOperationResponse(res)
        : undefined;
      enteredHandlers.add(res);
      try {
        const result = await operationResults.run(receipt, invoke);
        receipts.set(res, await operationResults.finish(receipt, undefined, undefined, true));
        staged?.publish();
        await operationResults.finish(receipt, undefined, res.writableEnded);
        return result;
      } catch (error) {
        staged?.discard();
        if (operationResults.auditFailed(receipt)) auditFailedResponses.add(res);
        if (operationResults.queryable(receipt)) queryableReceipts.add(res);
        try {
          receipts.set(res, await operationResults.finish(receipt, error, res.writableEnded, false, true));
        } catch (receiptError) {
          console.error('Operation receipt publication failed', { correlationId, error: receiptError });
          receipts.set(res, {
            correlationId,
            operationId: entry.declaration.id,
            outcome: 'unknown',
            executed: receipt.executed,
            startedAt: receipt.startedAt,
            responseValidated: receipt.responseValidated,
            auditRecorded: false,
            delivery: 'unknown',
            errorCode: 'OPERATION_RESULT_UNAVAILABLE',
          });
        }
        throw error;
      }
    });
  }
  gateway.seal();
  /**
   * 入口 / Entry: startApplicationHttp.dispatchApi.
   * 功能：把本层请求转交 `gateway.dispatch`，沿用该实现的结果与失败路径。
   * Purpose: Delegates this request to `gateway.dispatch` and propagates the provider result or rejection.
   * 输入 / Inputs: req: IncomingMessage; res: ServerResponse; url: URL
   * 输出 / Returns: `gateway.dispatch(req, res, url)`.
   * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const dispatchApi = (req: IncomingMessage, res: ServerResponse, url: URL) =>
    gateway.dispatch(req, res, url);
  /**
   * 入口 / Entry: startApplicationHttp.callback@596.
   * 功能：处理注册方交给此闭包的异步分支，执行下述状态更新、结果构造或失败处理（createServer）。
   * Purpose: Handles the asynchronous branch supplied by its registrant, performing the state updates, result construction or failure handling below (createServer).
   * 输入 / Inputs: req; res
   * 输出 / Returns: `await dispatchApi(req, res, new URL(req.url, `http://localhost:${PORT}`))`; `await dispatchApi(req, res, extensionUrl)`; `await dispatchApi(req, res, url)`；另有分支返回 / additional branch-specific returns.
   * 副作用 / Effects: `res.setHeader`; `req.url.startsWith`; `requestUrl`; `url.pathname.startsWith`; `path.startsWith`; 更新 / updates `rejectedMutation`, `actorId`, `dto.operationResult`.
   * 拒绝 / Refusals: 条件 / conditions `!url`; `!allowedRequest(req) && !(ssoCallback && req.headers.host === `localhost:${PORT}`)`; `req.method !== 'GET' && req.method !== 'HEAD'`; 异常 / errors `new AppError('无效的请求地址', 400)`; `new AppError('仅接受本机同源访问', 403)`.
   * 失败处理：catch 分支执行 `let rejectedMutation = false;`; `if (!enteredHandlers.has(res) && !receipts.has(res)) { const event = rejectedRequestAuditEvent(req); if (event) { rejectedMut…`，是否吞掉错误或重新拒绝由这些语句决定。
   * Failure handling: Catch paths execute `let rejectedMutation = false;`; `if (!enteredHandlers.has(res) && !receipts.has(res)) { const event = rejectedRequestAuditEvent(req); if (event) { rejectedMut…`; these statements determine whether a failure is absorbed or rejected again.
   */
  const server = createServer(async (req, res) => {
    const correlationId = randomUUID();
    res.setHeader('X-Sakura-Correlation-Id', correlationId);
    try {
      if (req.url === '/api/guest/interop')
        return await dispatchApi(req, res, new URL(req.url, `http://localhost:${PORT}`));
      if (req.url?.startsWith('/api/extension/')) {
        const extensionUrl = requestUrl(req.url, PORT);
        if (
          extensionUrl &&
          ['/api/extension/connect', '/api/extension/inventory'].includes(extensionUrl.pathname)
        )
          return await dispatchApi(req, res, extensionUrl);
      }
      const url = requestUrl(req.url, PORT);
      if (!url) throw new AppError('无效的请求地址', 400);
      const ssoCallback =
        (req.url?.startsWith('/api/access/sso/oidc/callback?') &&
          url.pathname === '/api/access/sso/oidc/callback' &&
          req.method === 'GET') ||
        (req.url === '/api/access/sso/saml/callback' && req.method === 'POST');
      if (!allowedRequest(req) && !(ssoCallback && req.headers.host === `localhost:${PORT}`))
        throw new AppError('仅接受本机同源访问', 403);
      if (url.pathname.startsWith('/api/')) return await dispatchApi(req, res, url);
      if (vite) return vite.middlewares(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('不支持此方法', 405);
      const dist = join(ROOT, 'dist');
      const path = resolve(dist, '.' + decodeURIComponent(url.pathname));
      if (path !== dist && !path.startsWith(dist + sep)) throw new AppError('无效路径', 403);
      const candidate = (await stat(path).catch(() => null))?.isFile() ? path : join(dist, 'index.html');
      const data = await readFile(candidate);
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.woff2': 'font/woff2',
        '.png': 'image/png',
        '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(candidate)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control':
          candidate.endsWith('.html') || candidate.endsWith('sw.js') || candidate.endsWith('.webmanifest')
            ? 'no-cache'
            : 'public, max-age=3600',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*; img-src 'self' data: blob:; media-src 'self' blob:; object-src blob:; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error: unknown) {
      let rejectedMutation = false;
      if (!enteredHandlers.has(res) && !receipts.has(res)) {
        const event = rejectedRequestAuditEvent(req);
        if (event) {
          rejectedMutation = true;
          let actorId: string | undefined;
          try {
            if (access.enabled) actorId = access.authorize(req.headers['x-sakura-token']).id;
          } catch {
            /* Invalid credentials have no attributable account and are never logged. */
          }
          await auditRejectedRequest(audit, { ...event, ...(actorId ? { actorId } : {}) }, error, () =>
            auditFailedResponses.add(res),
          );
        }
      }
      if (res.destroyed) return;
      if (res.headersSent) {
        res.end();
        return;
      }
      const { status, dto } = publicApiFailure(error, correlationId, auditFailedResponses.has(res));
      const result = receipts.get(res);
      if (result)
        dto.operationResult = {
          correlationId,
          outcome: result.outcome,
          executed: result.executed,
          ...(!queryableReceipts.has(res) || result.errorCode === 'OPERATION_RESULT_UNAVAILABLE'
            ? {}
            : {
                query: '/api/operation-results/' + correlationId,
              }),
        };
      else if (rejectedMutation || operationPreflightFailure(error))
        dto.operationResult = { correlationId, outcome: 'failed', executed: false };
      send(res, { ...dto, ...(status === 423 ? { session: session.view() } : {}) }, status);
    }
  });

  resources.defer(
    'http',
    () => {
      server.close();
    },
    0,
  );
  attachApplicationWebSocket({
    allowedRequest,
    dev,
    features,
    gateway,
    machines,
    projectTerminals,
    server,
    session,
    socketAccounts,
    socketAuthorization,
    socketCredentials,
    socketPlugins,
    socketTerminalGrants,
    socketVms,
    terminalSharing,
    ws,
  });
  if (dev) {
    const { createServer } = await import('vite');
    vite = resources.own(
      'vite',
      await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'spa' }),
      410,
    );
  }
  services.acceptRequests();
  await listenHttpServer(server, PORT, '127.0.0.1');
}

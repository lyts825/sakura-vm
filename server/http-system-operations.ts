/**
 * 模块职责：处理系统状态、恢复及操作结果管理请求，结果归档仅允许管理员执行。
 * Module purpose: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
 */
import { AppError } from '../shared/errors.ts';
import { LOCAL_OWNER_ACTOR_ID } from './local-principal.ts';
import { graphqlInfo, graphqlLimits } from './graphql-api.ts';
import { hostRuntime } from './host-runtime/index.ts';
import { sendJson as send, sendDocumentJson } from './http-response.ts';
import { logRetentionRequest } from './log-retention.ts';
import { metadataQueueSnapshot } from './metadata-queue.ts';
import { monitorSnapshot } from './monitor.ts';
import { networkRuntime } from './network/index.ts';
import { apiDocument } from './openapi.ts';
import { PORT } from './paths.ts';
import { remoteAuditAction } from './remote-audit.ts';
import { scheduler } from './scheduler.ts';
import { generateSdk } from './sdk.ts';
import type { HttpOperationHandler } from './operation-gateway.ts';
import type { CoreHttpContext, CoreHttpHandlers } from './http-core-context.ts';

/**
 * 入口 / Entry: systemOperationHandlers.
 * 功能：创建恢复目录、诊断与操作结果查询和归档处理器。
 * Purpose: Builds recovery/diagnostic/receipt-query/archive handlers.
 * 设计：查询保留账户范围，归档和目录重建核对管理员及原摘要；恢复动作返回领域回执，不从文件缺失推断完成。
 * Design: Queries retain account scope and archives/rebuilds check administrator/original digests; domain receipts, not absence, confirm recovery.
 * 输入 / Inputs: context: CoreHttpContext< | 'recoveries' | 'access' | 'diagnostics' | 'graph' | 'features' | '…
 * 输出 / Returns: CoreHttpHandlers；结果来自 / values from `{ 'core.recoveries.list': recoveriesListHandler, 'core.recoveries.retry': recoveriesListHandler, 'core.recoveries.rebuild': r…`.
 * 副作用 / Effects: 此函数体没有直接状态赋值；所委派调用的 I/O 见其提供者契约 / no direct state assignment in this body; delegated I/O follows the provider contract.
 */
export function systemOperationHandlers(
  context: CoreHttpContext<
    | 'recoveries'
    | 'access'
    | 'diagnostics'
    | 'graph'
    | 'features'
    | 'machines'
    | 'audit'
    | 'remoteAudit'
    | 'retention'
    | 'requireService'
  >,
): CoreHttpHandlers {
  const { services, authorizedBody, operationResults, gateway, body, documentResponses } = context;
  /**
   * 入口 / Entry: systemOperationHandlers.recoveriesListHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { version: 1, records: await services.recoveries.refresh(), diagnostics: services.recoveries.diagnostics(), })` / `send(res, await services.recoveries.retry(await authorizedBody(req, 4096)))` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, { version: 1, records: await services.recoveries.refresh(), diagnostics: services.recoveries.diagnostics(), })` / `send(res, await services.recoveries.retry(await authorizedBody(req, 4096)))` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `services.recoveries.refresh`, `services.recoveries.diagnostics`, `services.recoveries.retry` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `services.recoveries.refresh`, `services.recoveries.diagnostics`, `services.recoveries.retry`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/recoveries'`; `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { version: 1, records: await services.recoveries.refresh(), diagnostics: services.recoveries.diagnostics(), })`; `send(res, await services.recoveries.retry(await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const recoveriesListHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/recoveries') {
      if (req.method === 'GET')
        return send(res, {
          version: 1,
          records: await services.recoveries.refresh(),
          diagnostics: services.recoveries.diagnostics(),
        });
      return send(res, await services.recoveries.retry(await authorizedBody(req, 4096)));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.recoveriesRebuildHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await services.recoveries.rebuild(await authorizedBody(req, 4096)))` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await services.recoveries.rebuild(await authorizedBody(req, 4096)))` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `services.recoveries.rebuild`, `authorizedBody` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `services.recoveries.rebuild`, `authorizedBody`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/recoveries/rebuild'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await services.recoveries.rebuild(await authorizedBody(req, 4096)))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const recoveriesRebuildHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/recoveries/rebuild')
      return send(res, await services.recoveries.rebuild(await authorizedBody(req, 4096)));
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.operationResultsGetHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send( res, await operationResults.get( resultId, access.enabled ? 'account' : 'local-owner', accountPrincipal?.id, ), )` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send( res, await operationResults.get( resultId, access.enabled ? 'account' : 'local-owner', accountPrincipal?.id, ), )` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `access.authorize`, `inline.exec`, `send`, `operationResults.get` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `inline.exec`, `send`, `operationResults.get`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `resultId`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send( res, await operationResults.get( resultId, access.enabled ? 'account' : 'local-owner', accountPrincipal?.id, ), )`.
   * 副作用 / Effects: `inline.exec`; `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const operationResultsGetHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    const resultId = /^\/api\/operation-results\/([a-f0-9-]{36})$/i.exec(url.pathname)?.[1];
    if (resultId)
      return send(
        res,
        await operationResults.get(
          resultId,
          access.enabled ? 'account' : 'local-owner',
          access.enabled ? accountPrincipal?.id : LOCAL_OWNER_ACTOR_ID,
        ),
      );
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.operationResultsListHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await operationResults.diagnostics())` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await operationResults.diagnostics())` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `operationResults.diagnostics` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `operationResults.diagnostics`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: _req; res
   * 输出 / Returns: `send(res, await operationResults.diagnostics())`.
   * 副作用 / Effects: `send`.
   * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
   */
  const operationResultsListHandler: HttpOperationHandler = async (_req, res) =>
    send(res, await operationResults.diagnostics());
  /**
   * 入口 / Entry: systemOperationHandlers.operationResultsArchiveHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await operationResults.archive(input, principal ? { role: 'owner', sessionKey: 'account', actorId: principal.id } :…` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await operationResults.archive(input, principal ? { role: 'owner', sessionKey: 'account', actorId: principal.id } :…` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `authorizedBody`, `access.authorize`, `send`, `operationResults.archive` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `authorizedBody`, `access.authorize`, `send`, `operationResults.archive`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res
   * 输出 / Returns: `send(res, await operationResults.archive(input, principal ? { role: 'owner', sessionKey: 'account', actorId: principal.id } :…`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `principal && principal.role !== 'owner'`; 异常 / errors `new AppError('仅管理员可归档操作结果', 403)`.
   */
  const operationResultsArchiveHandler: HttpOperationHandler = async (req, res) => {
    const input = await authorizedBody(req, 4096);
    const { access } = services;
    const principal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : undefined;
    if (principal && principal.role !== 'owner') throw new AppError('仅管理员可归档操作结果', 403);
    return send(res, await operationResults.archive(input, principal
      ? { role: 'owner', sessionKey: 'account', actorId: principal.id }
      : { role: 'owner', sessionKey: 'local-owner' }));
  };
  /**
   * 入口 / Entry: systemOperationHandlers.operationsHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { version: gateway.version, operations: gateway.directory() })` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, { version: gateway.version, operations: gateway.directory() })` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `gateway.directory` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `gateway.directory`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/operations'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { version: gateway.version, operations: gateway.directory() })`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const operationsHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/operations')
      return send(res, { version: gateway.version, operations: gateway.directory() });
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.hostRuntimeHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, { ...hostRuntime.snapshot(), diagnostics: services.diagnostics.snapshot(), schedules: scheduler.snapshot(), metadat…` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, { ...hostRuntime.snapshot(), diagnostics: services.diagnostics.snapshot(), schedules: scheduler.snapshot(), metadat…` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `access.authorize`, `send`, `hostRuntime.snapshot`, `services.diagnostics.snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `hostRuntime.snapshot`, `services.diagnostics.snapshot`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, { ...hostRuntime.snapshot(), diagnostics: services.diagnostics.snapshot(), schedules: scheduler.snapshot(), metadat…`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/host-runtime'`; `req.method !== 'GET'`; `access.enabled && accountPrincipal?.role !== 'owner'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('仅管理员可查看系统资源状态', 403)`.
   */
  const hostRuntimeHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/host-runtime') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      if (access.enabled && accountPrincipal?.role !== 'owner')
        throw new AppError('仅管理员可查看系统资源状态', 403);
      return send(res, {
        ...hostRuntime.snapshot(),
        diagnostics: services.diagnostics.snapshot(),
        schedules: scheduler.snapshot(),
        metadata: metadataQueueSnapshot(),
      });
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.networkRuntimeHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, networkRuntime.snapshot())` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, networkRuntime.snapshot())` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `access.authorize`, `send`, `networkRuntime.snapshot` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `networkRuntime.snapshot`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, networkRuntime.snapshot())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/network-runtime'`; `req.method !== 'GET'`; `access.enabled && accountPrincipal?.role !== 'owner'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('仅管理员可查看网络运行状态', 403)`.
   */
  const networkRuntimeHandler: HttpOperationHandler = async (req, res, url) => {
    const { access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/network-runtime') {
      if (req.method !== 'GET') throw new AppError('不支持此方法', 405);
      if (access.enabled && accountPrincipal?.role !== 'owner')
        throw new AppError('仅管理员可查看网络运行状态', 403);
      return send(res, networkRuntime.snapshot());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.graphqlSchemaHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, graphqlInfo())` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, graphqlInfo())` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `graphqlInfo` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `graphqlInfo`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, graphqlInfo())`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/graphql-schema'`; `req.method !== 'GET'`; 异常 / errors `new AppError('Schema 接口仅支持读取', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const graphqlSchemaHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/graphql-schema') {
      if (req.method !== 'GET') throw new AppError('Schema 接口仅支持读取', 405);
      return send(res, graphqlInfo());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.graphqlQueryHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, result.body, result.status, 'application/graphql-response+json')` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, result.body, result.status, 'application/graphql-response+json')` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `services.requireService`, `req.once`, `res.once`, `cancel` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `req.once`, `res.once`, `cancel`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.aborted || res.destroyed`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, result.body, result.status, 'application/graphql-response+json')`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/graphql'`; `req.method !== 'POST'`; 异常 / errors `new AppError('GraphQL 查询使用 POST JSON', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   * 收尾：退出 try 区域时始终执行 `req.off('aborted', cancel);`; `res.off('close', cancel);`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `req.off('aborted', cancel);`; `res.off('close', cancel);`; these steps also apply to exceptional exits.
   */
  const graphqlQueryHandler: HttpOperationHandler = async (req, res, url) => {
    const graph = services.requireService('graph');
    if (url.pathname === '/api/graphql') {
      if (req.method !== 'POST') throw new AppError('GraphQL 查询使用 POST JSON', 405);
      const abort = new AbortController();
      /**
       * 入口 / Entry: systemOperationHandlers.cancel.
       * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；完成下述调用及状态处理（`http-system-operations.ts`）。
       * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; the calls and state transitions below complete the operation. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
       * 处理：通过 `abort.abort` 协调依赖；下列分支决定是否继续、返回或拒绝。
       * Processing: Coordinates its dependencies through `abort.abort`; the branches below determine continuation, return or refusal.
       * 分支 / Branches: `!res.writableFinished`.
       * 输入 / Inputs: 无显式参数；可使用捕获状态 / no explicit parameters; may use captured state.
       * 输出 / Returns: 无显式返回值；异步实现成功时完成 Promise / no explicit value; async implementations resolve on success.
       * 副作用 / Effects: `abort.abort`.
       * 失败 / Failure: 无直接 throw；依赖调用仍可能抛出或拒绝，处理方式见本实现 / no direct throw; dependency calls may throw or reject as handled by this implementation.
       */
      const cancel = () => {
        if (!res.writableFinished) abort.abort();
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      if (req.aborted || res.destroyed) cancel();
      try {
        const result = await graph.query(
          await authorizedBody(req, graphqlLimits.requestBytes, abort.signal),
          abort.signal,
        );
        return send(res, result.body, result.status, 'application/graphql-response+json');
      } finally {
        req.off('aborted', cancel);
        res.off('close', cancel);
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.openapiHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `sendDocumentJson(res, snapshot)` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `sendDocumentJson(res, snapshot)` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `documentResponses.get`, `sendDocumentJson` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `documentResponses.get`, `sendDocumentJson`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `sendDocumentJson(res, snapshot)`.
   * 副作用 / Effects: `sendDocumentJson`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/openapi' || url.pathname === '/api/sdk'`; `req.method !== 'GET'`; 异常 / errors `new AppError('文档接口仅支持读取', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const openapiHandler: HttpOperationHandler = async (req, res, url) => {
    const { features } = services;
    if (url.pathname === '/api/openapi' || url.pathname === '/api/sdk') {
      if (req.method !== 'GET') throw new AppError('文档接口仅支持读取', 405);
      const kind = url.pathname === '/api/openapi' ? 'openapi' : 'sdk';
      const enabled = [...features.enabled],
        version = gateway.version;
      const snapshot = documentResponses.get(kind, version, enabled, PORT, () => {
        const specification = apiDocument(enabled, PORT, version);
        return kind === 'openapi'
          ? specification
          : { filename: 'sakura-client.mjs', mime: 'text/javascript', content: generateSdk(specification) };
      });
      return sendDocumentJson(res, snapshot);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.monitorHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await monitorSnapshot(machines, features.jobStores()))` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await monitorSnapshot(machines, features.jobStores()))` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `monitorSnapshot`, `features.jobStores` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `monitorSnapshot`, `features.jobStores`; the branches below determine continuation, return or refusal.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await monitorSnapshot(machines, features.jobStores()))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/monitor'`; `req.method !== 'GET'`; 异常 / errors `new AppError('监控接口仅支持读取', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const monitorHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, machines } = services;
    if (url.pathname === '/api/monitor') {
      if (req.method !== 'GET') throw new AppError('监控接口仅支持读取', 405);
      return send(res, await monitorSnapshot(machines, features.jobStores()));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.auditHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await audit.read(200))` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await audit.read(200))` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `send`, `audit.read` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `send`, `audit.read`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `url.pathname === '/api/audit' && req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await audit.read(200))`.
   * 副作用 / Effects: `send`.
   * 拒绝 / Refusals: 异常 / errors `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const auditHandler: HttpOperationHandler = async (req, res, url) => {
    const { audit } = services;
    if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, await audit.read(200));
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.auditRemoteStatusHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, await remoteAudit.status())` / `send( res, input.action === 'configure' ? await remoteAudit.configure(input.target) : input.action === 'disable' ? await remo…` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, await remoteAudit.status())` / `send( res, input.action === 'configure' ? await remoteAudit.configure(input.target) : input.action === 'disable' ? await remo…` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `access.authorize`, `send`, `remoteAudit.status`, `remoteAuditAction.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `access.authorize`, `send`, `remoteAudit.status`, `remoteAuditAction.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, await remoteAudit.status())`; `send( res, input.action === 'configure' ? await remoteAudit.configure(input.target) : input.action === 'disable' ? await remo…`.
   * 副作用 / Effects: `send`; `releaseMutation`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/audit/remote'`; `accountPrincipal?.role !== 'owner'`; `req.method !== 'POST'`; 异常 / errors `new AppError('只有管理员可管理远程审计', 403)`; `new AppError('不支持此方法', 405)`.
   * 收尾：退出 try 区域时始终执行 `releaseMutation();`；这些步骤也适用于异常退出。
   * Finalization: Leaving the try region always executes `releaseMutation();`; these steps also apply to exceptional exits.
   */
  const auditRemoteStatusHandler: HttpOperationHandler = async (req, res, url) => {
    const { audit, features, remoteAudit, access } = services;
    const accountPrincipal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : null;
    if (url.pathname === '/api/audit/remote') {
      if (accountPrincipal?.role !== 'owner') throw new AppError('只有管理员可管理远程审计', 403);
      if (req.method === 'GET') return send(res, await remoteAudit.status());
      if (req.method !== 'POST') throw new AppError('不支持此方法', 405);
      const input = remoteAuditAction.parse(await authorizedBody(req, 8192));
      const releaseMutation = features.operations.enter();
      try {
        return send(
          res,
          input.action === 'configure'
            ? await remoteAudit.configure(input.target)
            : input.action === 'disable'
              ? await remoteAudit.disable()
              : input.action === 'verify'
                ? await remoteAudit.verify()
                : await remoteAudit.sync(),
        );
      } finally {
        releaseMutation();
      }
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  /**
   * 入口 / Entry: systemOperationHandlers.logRetentionGetHandler.
   * 功能：在处理系统状态、恢复及操作结果管理请求中，执行此领域的具体处理步骤并返回其结果；本入口产生 `send(res, retention.view())` / `send( res, input.action === 'preview' ? retention.preview(input.policy) : await retention.save(input.policy, input.token), )` 供上层消费（`http-system-operations.ts`）。
   * Purpose: Executes the domain-specific processing steps and returns their outcome in `http-system-operations.ts`; this entry produces `send(res, retention.view())` / `send( res, input.action === 'preview' ? retention.preview(input.policy) : await retention.save(input.policy, input.token), )` for its caller. Module context: Handles status, recovery and operation-result management, restricting receipt archival to administrators.
   * 处理：通过 `services.requireService`, `send`, `retention.view`, `logRetentionRequest.parse` 协调依赖；下列分支决定是否继续、返回或拒绝。
   * Processing: Coordinates its dependencies through `services.requireService`, `send`, `retention.view`, `logRetentionRequest.parse`; the branches below determine continuation, return or refusal.
   * 分支 / Branches: `req.method === 'GET'`; `req.method === 'POST'`.
   * 输入 / Inputs: req; res; url
   * 输出 / Returns: `send(res, retention.view())`; `send( res, input.action === 'preview' ? retention.preview(input.policy) : await retention.save(input.policy, input.token), )`.
   * 副作用 / Effects: `send`; `retention.save`.
   * 拒绝 / Refusals: 条件 / conditions `url.pathname === '/api/log-retention'`; 异常 / errors `new AppError('不支持此方法', 405)`; `new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH')`.
   */
  const logRetentionGetHandler: HttpOperationHandler = async (req, res, url) => {
    const retention = services.requireService('retention');
    if (url.pathname === '/api/log-retention') {
      if (req.method === 'GET') return send(res, retention.view());
      if (req.method === 'POST') {
        const input = logRetentionRequest.parse(await authorizedBody(req));
        return send(
          res,
          input.action === 'preview'
            ? retention.preview(input.policy)
            : await retention.save(input.policy, input.token),
        );
      }
      throw new AppError('不支持此方法', 405);
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  return {
    'core.recoveries.list': recoveriesListHandler,
    'core.recoveries.retry': recoveriesListHandler,
    'core.recoveries.rebuild': recoveriesRebuildHandler,
    'core.operation-results.get': operationResultsGetHandler,
    'core.operation-results.list': operationResultsListHandler,
    'core.operation-results.archive': operationResultsArchiveHandler,
    'core.operations': operationsHandler,
    'core.host-runtime': hostRuntimeHandler,
    'core.network-runtime': networkRuntimeHandler,
    'core.graphql.schema': graphqlSchemaHandler,
    'core.graphql.query': graphqlQueryHandler,
    'core.openapi': openapiHandler,
    'core.sdk': openapiHandler,
    'core.monitor': monitorHandler,
    'core.audit': auditHandler,
    'core.audit.remoteStatus': auditRemoteStatusHandler,
    'core.audit.remoteAction': auditRemoteStatusHandler,
    'core.log-retention.get': logRetentionGetHandler,
    'core.log-retention.change': logRetentionGetHandler,
  };
}

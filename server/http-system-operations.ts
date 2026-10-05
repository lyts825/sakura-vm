import { AppError } from '../shared/errors.ts';
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
  const recoveriesRebuildHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/recoveries/rebuild')
      return send(res, await services.recoveries.rebuild(await authorizedBody(req, 4096)));
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
          accountPrincipal?.id,
        ),
      );
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const operationResultsListHandler: HttpOperationHandler = async (_req, res) =>
    send(res, await operationResults.diagnostics());
  const operationResultsArchiveHandler: HttpOperationHandler = async (req, res) => {
    const input = await authorizedBody(req, 4096);
    const { access } = services;
    const principal = access.enabled ? access.authorize(req.headers['x-sakura-token']) : undefined;
    if (principal && principal.role !== 'owner') throw new AppError('仅管理员可归档操作结果', 403);
    return send(res, await operationResults.archive(input, principal
      ? { role: 'owner', sessionKey: 'account', actorId: principal.id }
      : { role: 'owner', sessionKey: 'local-owner' }));
  };
  const operationsHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/operations')
      return send(res, { version: gateway.version, operations: gateway.directory() });
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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
  const graphqlSchemaHandler: HttpOperationHandler = async (req, res, url) => {
    if (url.pathname === '/api/graphql-schema') {
      if (req.method !== 'GET') throw new AppError('Schema 接口仅支持读取', 405);
      return send(res, graphqlInfo());
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const graphqlQueryHandler: HttpOperationHandler = async (req, res, url) => {
    const graph = services.requireService('graph');
    if (url.pathname === '/api/graphql') {
      if (req.method !== 'POST') throw new AppError('GraphQL 查询使用 POST JSON', 405);
      const abort = new AbortController();
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
  const monitorHandler: HttpOperationHandler = async (req, res, url) => {
    const { features, machines } = services;
    if (url.pathname === '/api/monitor') {
      if (req.method !== 'GET') throw new AppError('监控接口仅支持读取', 405);
      return send(res, await monitorSnapshot(machines, features.jobStores()));
    }
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
  const auditHandler: HttpOperationHandler = async (req, res, url) => {
    const { audit } = services;
    if (url.pathname === '/api/audit' && req.method === 'GET') return send(res, await audit.read(200));
    throw new AppError('处理器与操作路径不一致', 404, 'OPERATION_HANDLER_MISMATCH');
  };
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

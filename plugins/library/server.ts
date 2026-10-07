/**
 * 模块职责：“实例整理”插件服务端入口。激活时装配 Set，并处理声明的服务端操作。
 */
import { httpRouteRequests } from '../../server/http-route-requests.ts';
import { pluginResponseContracts } from '../../shared/contracts/plugin-route-responses.ts';
import { sendJson } from '../../server/http-response.ts';
import { publicApiFailure } from '../../server/api-errors.ts';

export { manifest } from './manifest.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginContext } from '../../server/plugin-api.ts';

export async function activate(host: PluginContext) {}
export async function route(
  this: PluginContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  body: (req: IncomingMessage, signal?: AbortSignal) => Promise<any>,
  signal: AbortSignal,
): Promise<boolean> {
  const parts = url.pathname.split('/').filter(Boolean);
  const send = (data: unknown, status = 200) => sendJson(res, data, status);
  if (parts[1] === 'vms' && parts[2] === 'batch' && parts.length === 3 && req.method === 'POST') {
    const { ids, action } = httpRouteRequests["library.legacy.post.vms.batch"]
      .parse(await body(req, signal));
    const results = [];
    for (const id of new Set(ids)) {
      signal.throwIfAborted();
      try {
        await this.vm[action](id);
        results.push({ id, ok: true });
      } catch (error) {
        const correlationId = res.getHeader?.('X-Sakura-Correlation-Id');
        const { dto } = publicApiFailure(error, typeof correlationId === 'string' ? correlationId : '');
        results.push({ id, ok: false, error: dto.error + (dto.correlationId ? `（关联 ID：${dto.correlationId}）` : '') });
      }
    }
    send({ results });
    return true;
  }
  if (parts[1] !== 'vms' || !parts[2]) return false;
  const id = parts[2],
    action = parts[3];
  this.vm.get(id);
  if (parts.length === 4) {
    if (action === 'organization' && req.method === 'PUT') {
      send(await this.vm.organize(id, await body(req, signal)));
      return true;
    }
  }
  return false;
}

/** Exact implemented HTTP operations; declarations alone never publish a handler. */
export const httpHandlers: Record<string, import('../../server/plugin-api.ts').PluginRoute> = {
  "legacy.post.vms.batch": route,
  "legacy.put.vms.vmId.organization": route,
};

/** Public response metadata is shared with publication, OpenAPI and runtime validation. */
export const responseContracts = pluginResponseContracts("library");

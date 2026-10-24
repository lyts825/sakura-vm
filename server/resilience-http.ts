/** 固定逐操作 HTTP 路由；schema 和 owner 策略由同一操作名称登记。
 * Explicit per-operation HTTP routes share names with strict schemas and owner policies. */
import type { PluginContext, PluginRoute } from './plugin-api.ts';
import { sendJson } from './http-response.ts';
import { resilienceRequests, resilienceResponses } from '../shared/contracts/resilience-lab.ts';
export type ResilienceDomain = keyof typeof resilienceRequests;
export const resilienceReads = new Set([
  'view',
  'get',
  'sources',
  'templates',
  'catalogue',
  'retention',
  'imports',
]);
export function resilienceHttp(
  domain: ResilienceDomain,
  resolve: (host: PluginContext) => Record<string, (input: any) => Promise<unknown>>,
) {
  const requests = resilienceRequests[domain] as Record<string, { parse: (v: unknown) => any }>,
    responses = resilienceResponses[domain] as Record<string, { parse: (v: unknown) => unknown }>;
  const route: PluginRoute = async function (req, res, url, body, signal) {
    const prefix = '/api/resilience-' + domain + '/';
    if (!url.pathname.startsWith(prefix)) return false;
    const operation = url.pathname.slice(prefix.length);
    if (
      !Object.hasOwn(requests, operation) ||
      req.method !== (resilienceReads.has(operation) ? 'GET' : 'POST')
    )
      return false;
    let raw: unknown;
    if (req.method === 'POST') raw = await body(req, signal, 200 * 1024 * 1024);
    else {
      const query: Record<string, unknown> = { scope: { workspaceId: url.searchParams.get('workspaceId') } };
      for (const field of ['id', 'runId'])
        if (url.searchParams.has(field)) query[field] = url.searchParams.get(field);
      if (url.searchParams.has('revision')) {
        query.ref = { id: url.searchParams.get('id'), revision: url.searchParams.get('revision') };
        delete query.id;
      }
      raw = query;
    }
    const input = requests[operation].parse(raw),
      handlers = resolve(this);
    if (!Object.hasOwn(handlers, operation)) throw new Error('演练操作缺少处理器');
    sendJson(res, responses[operation].parse(await handlers[operation](input)));
    return true;
  };
  return {
    route,
    httpHandlers: Object.fromEntries(Object.keys(requests).map((name) => [name, route])),
    responseContracts: responses,
  };
}

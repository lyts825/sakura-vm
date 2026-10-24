/** 每领域服务的显式方法路由与所有者准入。 Per-domain method routing and live owner admission. */
import type { PluginContext, PluginRoute } from './plugin-api.ts';
import type { ServiceRef } from './service-ref.ts';
import { captureOperationCheck } from './operation-context.ts';
import { resourceContext } from './host-runtime/context.ts';
import { fail } from './knowledge-store.ts';
import { sendJson } from './http-response.ts';
import { knowledgeHttpSchemas, type KnowledgeDomain } from '../shared/contracts/knowledge-http.ts';
export function knowledgeAuthorize(host: PluginContext) {
  return async () => {
    host.signal.throwIfAborted();
    await captureOperationCheck()();
    if (!resourceContext()?.actorId) fail('OWNER_REQUIRED', '知识工作台需要已认证的所有者身份', 403);
  };
}
/** 服务调用与 HTTP 共用逐方法校验，内部存储端口仍由各自实现校验。 Validate business service calls at both boundaries. */
export function knowledgeService<T extends object>(domain: KnowledgeDomain, implementation: T): T {
  const schemas = knowledgeHttpSchemas[domain] as Record<
    string,
    { request: import('zod').z.ZodType; response: import('zod').z.ZodType }
  >;
  const methods = new Map<string, unknown>();
  return new Proxy(implementation, {
    get(target, key, receiver) {
      if (typeof key !== 'string' || !Object.hasOwn(schemas, key)) return Reflect.get(target, key, receiver);
      if (!methods.has(key))
        methods.set(key, async (input: unknown, ...rest: unknown[]) => {
          const request = schemas[key].request.parse(input ?? {});
          const method = Reflect.get(target, key);
          if (typeof method !== 'function') throw new Error(`Knowledge ${domain}.${key} is unavailable`);
          const result = await Reflect.apply(method, target, [request, ...rest]);
          return schemas[key].response.parse(result);
        });
      return methods.get(key);
    },
  });
}
export function knowledgeRoute<T>(domain: KnowledgeDomain, service: ServiceRef<T>): PluginRoute {
  return async function (req, res, url, body, signal) {
    if (req.method !== 'POST') return false;
    const name = url.pathname.slice(`/api/knowledge-${domain}/`.length);
    if (
      url.pathname !== `/api/knowledge-${domain}/${name}` ||
      !Object.hasOwn(knowledgeHttpSchemas[domain], name)
    )
      return false;
    const schema = (
      knowledgeHttpSchemas[domain] as Record<
        string,
        { request: import('zod').z.ZodType; response: import('zod').z.ZodType }
      >
    )[name];
    const input = schema.request.parse(await body(req, signal, 32 * 1024 ** 2));
    const target = this.use(service) as Record<string, (input: unknown, signal?: AbortSignal) => unknown>;
    const result = await Reflect.apply(target[name], target, [input, signal]);
    await captureOperationCheck()();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendJson(res, schema.response.parse(result));
    return true;
  };
}

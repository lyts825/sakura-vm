/** 固定领域方法的所有者准入和线路校验；内部容量端口不对外路由。 */
import type { z } from 'zod';
import type { PluginContext, PluginRoute } from './plugin-api.ts';
import type { ServiceRef } from './service-ref.ts';
import { captureOperationCheck } from './operation-context.ts';
import { sendJson } from './http-response.ts';
import { suiteFail, suiteActor } from './suite-store.ts';
import { isSuiteJsonBounded } from '../shared/contracts/suite-common.ts';
export type SuiteMethods = Readonly<
  Record<string, { request: z.ZodType; response: z.ZodType; read: boolean }>
>;
export function suiteAuthorize(host: PluginContext) {
  return async () => {
    host.signal.throwIfAborted();
    await captureOperationCheck()();
    suiteActor();
  };
}
export function suiteService<T extends object>(schemas: SuiteMethods, implementation: T): T {
  const methods = new Map<string, unknown>();
  return new Proxy(implementation, {
    get(target, key, receiver) {
      if (typeof key !== 'string' || !Object.hasOwn(schemas, key)) return Reflect.get(target, key, receiver);
      if (!methods.has(key))
        methods.set(key, async (raw: unknown = {}) => {
          if (!isSuiteJsonBounded(raw)) suiteFail('SUITE_CONTENT_LIMIT', '请求结构超出限制', 413);
          const input = schemas[key].request.parse(raw);
          const method = Reflect.get(target, key);
          if (typeof method !== 'function') suiteFail('SUITE_METHOD_UNAVAILABLE', '领域方法不可用', 503);
          const result = await Reflect.apply(method, target, [input]);
          await captureOperationCheck()();
          return schemas[key].response.parse(result);
        });
      return methods.get(key);
    },
  });
}
export function suiteRoute<T>(pluginId: string, schemas: SuiteMethods, service: ServiceRef<T>, metadata: Readonly<Record<string, boolean>>): PluginRoute {
  if (Object.keys(metadata).length !== Object.keys(schemas).length || Object.entries(schemas).some(([method, schema]) => !Object.hasOwn(metadata, method) || metadata[method] !== schema.read))
    throw new Error(`领域路由读写策略与校验器不同步：${pluginId}`);
  const prefix = `/api/${pluginId}/`;
  const names = new Map(
    Object.keys(schemas).map((name) => [
      name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase()),
      name,
    ]),
  );
  if (names.size !== Object.keys(schemas).length) throw new Error('领域路由发生名称冲突');
  return async function (req, res, url, body, signal) {
    if (req.method !== 'POST' || !url.pathname.startsWith(prefix)) return false;
    const name = names.get(url.pathname.slice(prefix.length));
    if (!name) return false;
    const raw = await body(req, signal, 2 * 1024 ** 2);
    if (!isSuiteJsonBounded(raw)) suiteFail('SUITE_CONTENT_LIMIT', '请求结构超出限制', 413);
    const input = schemas[name].request.parse(raw);
    const target = this.use(service) as Record<string, (input: unknown) => unknown>;
    const result = await Reflect.apply(target[name], target, [input]);
    await captureOperationCheck()();
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendJson(res, schemas[name].response.parse(result));
    return true;
  };
}

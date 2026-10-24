/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceTargets } from '../../server/resilience-targets.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);

  const value = new ResilienceTargets(meta, authorize);

  host.provide(service, value);
}
const handlers = resilienceHttp('targets', (host) => {
  const s = host.use(service);
  return {
    view: (i) => s.view(i.scope),
    register: (i) => s.register(i.scope, i.input),
    get: (i) => s.get(i.scope, i.ref),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

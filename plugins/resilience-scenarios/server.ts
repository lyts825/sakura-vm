/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceScenarios } from '../../server/resilience-scenarios.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';
import { service as targets } from '../resilience-targets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);

  const value = new ResilienceScenarios(meta, host.use(targets), authorize);

  host.provide(service, value);
}
const handlers = resilienceHttp('scenarios', (host) => {
  const s = host.use(service);
  return {
    view: (i) => s.view(i.scope),
    templates: (i) => s.templates(i.scope),
    save: (i) => s.save(i.scope, i.input),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

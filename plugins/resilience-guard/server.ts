/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceGuard } from '../../server/resilience-guard.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';
import { service as fixtures } from '../resilience-fixtures/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);
  const supervision = host.system.optional('drillSupervision');
  if (!supervision) throw new Error('演练本体监管尚未装配');

  const value = new ResilienceGuard(meta, host.use(fixtures), supervision, authorize);

  host.provide(service, value);
}
const handlers = resilienceHttp('guard', (host) => {
  const s = host.use(service);
  return {
    view: (i) => s.view(i.scope),
    contain: (i) => s.contain(i.scope, i.runId),
    reconcile: (i) => s.reconcile(i.scope, i.runId),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

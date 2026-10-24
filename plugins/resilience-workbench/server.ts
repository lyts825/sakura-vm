/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceWorkbench } from '../../server/resilience-workbench.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';
import { service as targets } from '../resilience-targets/services.ts';
import { service as fixtures } from '../resilience-fixtures/services.ts';
import { service as guard } from '../resilience-guard/services.ts';
import { service as scenarios } from '../resilience-scenarios/services.ts';
import { service as runs } from '../resilience-runs/services.ts';
import { service as reports } from '../resilience-reports/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);

  const value = new ResilienceWorkbench(
    host.use(targets),
    host.use(fixtures),
    host.use(guard),
    host.use(runs),
    host.use(reports),
    host.use(scenarios),
    authorize,
  );

  host.provide(service, value);
}
const handlers = resilienceHttp('workbench', (host) => {
  const s = host.use(service);
  return { view: (i) => s.view(i.scope) };
});
export const { route, httpHandlers, responseContracts } = handlers;

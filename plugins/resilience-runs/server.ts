/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceRuns } from '../../server/resilience-runs.ts';
import { resilienceActions } from '../../server/delegated-resilience.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service, actionsService } from './services.ts';
import { service as targets } from '../resilience-targets/services.ts';
import { service as fixtures } from '../resilience-fixtures/services.ts';
import { service as guard } from '../resilience-guard/services.ts';
import { service as faults } from '../resilience-faults/services.ts';
import { service as probes } from '../resilience-probes/services.ts';
import { service as recovery } from '../resilience-recovery/services.ts';
import { service as scenarios } from '../resilience-scenarios/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);

  const value = new ResilienceRuns(
    meta,
    host.use(targets),
    host.use(fixtures),
    host.use(guard),
    host.use(faults),
    host.use(probes),
    host.use(recovery),
    host.use(scenarios),
    authorize,
  );
  await value.init();
  host.provide(service, value);
  const actions = resilienceActions(host.capabilities.metadata.reference('delegated-actions', () => null), value);
  host.onDispose(() => actions.close());
  await actions.init();
  host.provide(actionsService, actions);
  host.registerJobs(value.jobs, () => {
    throw new Error('请先核销原运行，再重新预览和批准');
  });
  host.onDispose(() => value.close());
}
const handlers = resilienceHttp('runs', (host) => {
  const s = host.use(service);
  return {
    view: (i) => s.view(i.scope),
    get: (i) => s.get(i.scope, i.id),
    preview: (i) => s.preview(i.scope, i.scenario),
    approve: (i) => s.approve(i.scope, i.id, i.digest),
    start: (i) => s.start(i.scope, i.id),
    cancel: (i) => s.cancel(i.scope, i.id),
    reconcile: (i) => s.reconcile(i.scope, i.id),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

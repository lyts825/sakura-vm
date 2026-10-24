/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceReports } from '../../server/resilience-reports.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';
import { service as fixtures } from '../resilience-fixtures/services.ts';
import { service as probes } from '../resilience-probes/services.ts';
import { service as runs } from '../resilience-runs/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);

  const value = new ResilienceReports(meta, host.use(runs), host.use(probes), host.use(fixtures), authorize);

  host.provide(service, value);
}
const handlers = resilienceHttp('reports', (host) => {
  const s = host.use(service);
  return {
    view: (i) => s.view(i.scope),
    imports: (i) => s.imports(i.scope),
    discardImport: (i) => s.discardImport(i.scope, i.id),
    retention: (i) => s.retention(i.scope),
    pin: (i) => s.pin(i.scope, i.id, i.pinned),
    archive: (i) => s.archive(i.scope, i.id),
    seal: (i) => s.seal(i.scope, i.runId),
    export: (i) => s.export(i.scope, i.id),
    import: (i) => s.import(i.scope, i.bundle),
    accept: (i) => s.accept(i.scope, i.id),
    compare: (i) => s.compare(i.scope, i.left, i.right),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

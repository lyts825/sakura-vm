/** 装配独立领域服务；每个消费者通过 broker 取得自己的能力。 Assemble independent domains through consumer-bound broker handles. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { ResilienceFixtures } from '../../server/resilience-fixtures.ts';
import { resilienceAuthorize } from '../../server/resilience-store.ts';
import { resilienceHttp } from '../../server/resilience-http.ts';
import { service } from './services.ts';
import { service as targets } from '../resilience-targets/services.ts';
import { services as projects } from '../projects/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = resilienceAuthorize(host.signal),
    meta = host.capabilities.metadata.reference('index', () => null);
  const supervision = host.system.optional('drillSupervision');
  if (!supervision) throw new Error('演练本体监管尚未装配');
  const assets = host.system.optional('imageAssets');
  if (!assets) throw new Error('镜像资产服务尚未装配');
  const value = new ResilienceFixtures(
    meta,
    host.use(targets),
    assets,
    host.vm,
    supervision,
    host.use(projects.workspaces),
    authorize,
  );

  host.provide(service, value);
}
const handlers = resilienceHttp('fixtures', (host) => {
  const s = host.use(service);
  return {
    prepareBuiltin: (i) => s.prepareBuiltin(i.scope, i.distro, i.architecture),
    beginImport: (i) => s.beginImport(i.scope, i.input),
    appendImport: (i) => s.appendImport(i.scope, i.id, i.offset, i.data),
    finishImport: (i) => s.finishImport(i.scope, i.id),
    view: (i) => s.view(i.scope),
    sources: (i) => s.sources(i.scope),
    prepare: (i) => s.prepare(i.scope, i.target, i.runId),
    cleanupPreview: (i) => s.cleanupPreview(i.scope, i.id),
    cleanup: (i) => s.cleanup(i.scope, i.plan),
  };
});
export const { route, httpHandlers, responseContracts } = handlers;

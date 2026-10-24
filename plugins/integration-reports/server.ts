/** 装配独立领域；跨插件只调用声明服务。 Assemble one domain using declared services. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { IntegrationReports } from '../../server/integration-reports.ts';
import { integrationRoute } from '../../server/integration-http.ts';
import { integrationResponseSchemas } from '../../shared/contracts/integration-http.ts';
import { services } from './services.ts';
import { services as specsServices } from '../integration-specs/services.ts';
import { services as assertionsServices } from '../integration-assertions/services.ts';
import { services as loadServices } from '../integration-load/services.ts';
import { services as runnersServices } from '../integration-runners/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const deps = {
    specs: host.use(specsServices.specs),
    assertions: host.use(assertionsServices.assertions),
    load: host.use(loadServices.load),
    runners: host.use(runnersServices.runners),
  };
  const service = new IntegrationReports(
    meta('reports'),
    deps.specs,
    deps.assertions,
    deps.runners,
    deps.load,
  );

  host.provide(services.reports, service);

  host.onDispose(() => service.close());
}
export const route = integrationRoute('reports', (host) => host.use(services.reports));
export const httpHandlers = { view: route, act: route };
export const responseContracts = Object.fromEntries(
  Object.entries(integrationResponseSchemas.reports).map(([id, schema]) => [
    id,
    { kind: 'json' as const, statuses: [200], media: 'application/json', schema },
  ]),
);

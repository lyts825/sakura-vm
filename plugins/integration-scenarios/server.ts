/** 装配独立领域；跨插件只调用声明服务。 Assemble one domain using declared services. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { IntegrationScenarios } from '../../server/integration-scenarios.ts';
import { integrationRoute } from '../../server/integration-http.ts';
import { integrationResponseSchemas } from '../../shared/contracts/integration-http.ts';
import { services } from './services.ts';
import { services as specsServices } from '../integration-specs/services.ts';
import { services as fixturesServices } from '../integration-fixtures/services.ts';
import { services as environmentsServices } from '../integration-environments/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const deps = {
    specs: host.use(specsServices.specs),
    fixtures: host.use(fixturesServices.fixtures),
    environments: host.use(environmentsServices.environments),
  };
  const service = new IntegrationScenarios(meta('scenarios'), deps.specs, deps.fixtures, deps.environments);

  host.provide(services.scenarios, service);

  host.onDispose(() => service.close());
}
export const route = integrationRoute('scenarios', (host) => host.use(services.scenarios));
export const httpHandlers = { view: route, act: route };
export const responseContracts = Object.fromEntries(
  Object.entries(integrationResponseSchemas.scenarios).map(([id, schema]) => [
    id,
    { kind: 'json' as const, statuses: [200], media: 'application/json', schema },
  ]),
);

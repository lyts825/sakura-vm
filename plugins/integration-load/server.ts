/** 装配独立领域；跨插件只调用声明服务。 Assemble one domain using declared services. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { IntegrationLoad } from '../../server/integration-load.ts';
import { integrationRoute } from '../../server/integration-http.ts';
import { integrationResponseSchemas } from '../../shared/contracts/integration-http.ts';
import { services } from './services.ts';
import { services as specsServices } from '../integration-specs/services.ts';
import { services as runnersServices } from '../integration-runners/services.ts';
import { services as scenariosServices } from '../integration-scenarios/services.ts';
import { services as environmentsServices } from '../integration-environments/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const deps = {
    specs: host.use(specsServices.specs),
    runners: host.use(runnersServices.runners),
    scenarios: host.use(scenariosServices.scenarios),
    environments: host.use(environmentsServices.environments),
  };
  const service = new IntegrationLoad(
    meta('profiles'),
    deps.specs,
    deps.runners,
    deps.scenarios,
    deps.environments,
  );

  host.provide(services.load, service);

  host.onDispose(() => service.close());
}
export const route = integrationRoute('load', (host) => host.use(services.load));
export const httpHandlers = { view: route, act: route };
export const responseContracts = Object.fromEntries(
  Object.entries(integrationResponseSchemas.load).map(([id, schema]) => [
    id,
    { kind: 'json' as const, statuses: [200], media: 'application/json', schema },
  ]),
);

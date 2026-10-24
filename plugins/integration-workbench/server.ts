/** 装配独立领域；跨插件只调用声明服务。 Assemble one domain using declared services. */
import type { PluginContext } from '../../server/plugin-api.ts';
import { IntegrationWorkbench } from '../../server/integration-workbench.ts';
import { integrationRoute } from '../../server/integration-http.ts';
import { integrationResponseSchemas } from '../../shared/contracts/integration-http.ts';
import { services } from './services.ts';
import { services as specsServices } from '../integration-specs/services.ts';
import { services as environmentsServices } from '../integration-environments/services.ts';
import { services as fixturesServices } from '../integration-fixtures/services.ts';
import { services as mocksServices } from '../integration-mocks/services.ts';
import { services as scenariosServices } from '../integration-scenarios/services.ts';
import { services as runnersServices } from '../integration-runners/services.ts';
import { services as assertionsServices } from '../integration-assertions/services.ts';
import { services as loadServices } from '../integration-load/services.ts';
import { services as reportsServices } from '../integration-reports/services.ts';
import { services as exchangeServices } from '../integration-exchange/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const meta = (name: string) => host.capabilities.metadata.reference(name, () => []);
  const deps = {
    specs: host.use(specsServices.specs),
    environments: host.use(environmentsServices.environments),
    fixtures: host.use(fixturesServices.fixtures),
    mocks: host.use(mocksServices.mocks),
    scenarios: host.use(scenariosServices.scenarios),
    runners: host.use(runnersServices.runners),
    assertions: host.use(assertionsServices.assertions),
    load: host.use(loadServices.load),
    reports: host.use(reportsServices.reports),
    exchange: host.use(exchangeServices.exchange),
  };
  const service = new IntegrationWorkbench(meta('workbench'), deps);

  host.provide(services.workbench, service);

  host.onDispose(() => service.close());
}
export const route = integrationRoute('workbench', (host) => host.use(services.workbench));
export const httpHandlers = { view: route, act: route };
export const responseContracts = Object.fromEntries(
  Object.entries(integrationResponseSchemas.workbench).map(([id, schema]) => [
    id,
    { kind: 'json' as const, statuses: [200], media: 'application/json', schema },
  ]),
);

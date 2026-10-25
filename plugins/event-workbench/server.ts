import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventWorkbench } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
import { services as fixturesServices } from '../event-fixtures/services.ts';
import { services as producersServices } from '../event-producers/services.ts';
import { services as consumersServices } from '../event-consumers/services.ts';
import { services as scenariosServices } from '../event-scenarios/services.ts';
import { services as brokersServices } from '../event-brokers/services.ts';
import { services as runsServices } from '../event-runs/services.ts';
import { services as assertionsServices } from '../event-assertions/services.ts';
import { services as reportsServices } from '../event-reports/services.ts';
import { services as exchangeServices } from '../event-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventWorkbench(
    meta('state'),
    authorize,
    host.use(contractsServices.contracts),
    host.use(fixturesServices.fixtures),
    host.use(producersServices.producers),
    host.use(consumersServices.consumers),
    host.use(scenariosServices.scenarios),
    host.use(brokersServices.brokers),
    {
      'event-contracts': host.use(contractsServices.contracts),
      'event-fixtures': host.use(fixturesServices.fixtures),
      'event-producers': host.use(producersServices.producers),
      'event-consumers': host.use(consumersServices.consumers),
      'event-scenarios': host.use(scenariosServices.scenarios),
      'event-brokers': host.use(brokersServices.brokers),
      'event-runs': host.use(runsServices.runs),
      'event-assertions': host.use(assertionsServices.assertions),
      'event-reports': host.use(reportsServices.reports),
      'event-exchange': host.use(exchangeServices.exchange),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(eventHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'event-workbench',
  eventHttpSchemas.workbench,
  services.workbench,
  eventRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

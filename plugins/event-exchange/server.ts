import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventExchange } from '../../server/suite-event-exchange.ts';
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
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventExchange(
    meta('state'),
    meta('bytes'),
    meta('uploads'),
    authorize,
    host.use(contractsServices.contracts),
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
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(eventHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'event-exchange',
  eventHttpSchemas.exchange,
  services.exchange,
  eventRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

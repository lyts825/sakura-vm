import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventScenarios } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
import { services as fixturesServices } from '../event-fixtures/services.ts';
import { services as producersServices } from '../event-producers/services.ts';
import { services as consumersServices } from '../event-consumers/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventScenarios(
    meta('state'),
    authorize,
    host.use(contractsServices.contracts),
    host.use(fixturesServices.fixtures),
    host.use(producersServices.producers),
    host.use(consumersServices.consumers),
  );
  host.onDispose(() => service.close());
  host.provide(services.scenarios, suiteService(eventHttpSchemas.scenarios, service));
}
export const route = suiteRoute(
  'event-scenarios',
  eventHttpSchemas.scenarios,
  services.scenarios,
  eventRouteMetadata.scenarios,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.scenarios).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.scenarios).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventAssertions } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
import { services as runsServices } from '../event-runs/services.ts';
import { services as brokersServices } from '../event-brokers/services.ts';
import { services as scenariosServices } from '../event-scenarios/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventAssertions(
    meta('state'),
    authorize,
    host.use(contractsServices.contracts),
    host.use(runsServices.runs),
    host.use(brokersServices.brokers),
    host.use(scenariosServices.scenarios),
  );
  host.onDispose(() => service.close());
  host.provide(services.assertions, suiteService(eventHttpSchemas.assertions, service));
}
export const route = suiteRoute(
  'event-assertions',
  eventHttpSchemas.assertions,
  services.assertions,
  eventRouteMetadata.assertions,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.assertions).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.assertions).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

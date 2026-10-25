import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventFixtures } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventFixtures(meta('state'), authorize, host.use(contractsServices.contracts));
  host.onDispose(() => service.close());
  host.provide(services.fixtures, suiteService(eventHttpSchemas.fixtures, service));
}
export const route = suiteRoute(
  'event-fixtures',
  eventHttpSchemas.fixtures,
  services.fixtures,
  eventRouteMetadata.fixtures,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.fixtures).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.fixtures).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

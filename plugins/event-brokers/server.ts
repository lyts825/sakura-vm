import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventBrokers } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
import { services as scenariosServices } from '../event-scenarios/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventBrokers(
    meta('state'),
    authorize,
    host.use(contractsServices.contracts),
    host.use(scenariosServices.scenarios),
    () => host.system.optional('eventSessions')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.brokers, suiteService(eventHttpSchemas.brokers, service));
}
export const route = suiteRoute(
  'event-brokers',
  eventHttpSchemas.brokers,
  services.brokers,
  eventRouteMetadata.brokers,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.brokers).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.brokers).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

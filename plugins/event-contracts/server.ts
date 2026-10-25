import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventContracts } from '../../server/suite-event.ts';
import { services } from './services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventContracts(
    meta('state'),
    meta('uploads'),
    authorize,
    host.system.optional('imageAssets')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.contracts, suiteService(eventHttpSchemas.contracts, service));
}
export const route = suiteRoute(
  'event-contracts',
  eventHttpSchemas.contracts,
  services.contracts,
  eventRouteMetadata.contracts,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.contracts).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.contracts).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

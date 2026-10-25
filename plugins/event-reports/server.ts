import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { eventHttpSchemas } from '../../shared/contracts/event-http.ts';
import { eventRouteMetadata } from '../../shared/contracts/event-routes.generated.ts';
import { EventReports } from '../../server/suite-event.ts';
import { services } from './services.ts';
import { services as contractsServices } from '../event-contracts/services.ts';
import { services as runsServices } from '../event-runs/services.ts';
import { services as assertionsServices } from '../event-assertions/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EventReports(
    meta('state'),
    authorize,
    host.use(contractsServices.contracts),
    host.use(runsServices.runs),
    host.use(assertionsServices.assertions),
  );
  host.onDispose(() => service.close());
  host.provide(services.reports, suiteService(eventHttpSchemas.reports, service));
}
export const route = suiteRoute(
  'event-reports',
  eventHttpSchemas.reports,
  services.reports,
  eventRouteMetadata.reports,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(eventHttpSchemas.reports).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(eventHttpSchemas.reports).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

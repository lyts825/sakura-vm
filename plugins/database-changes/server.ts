import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseChanges } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as schemasServices } from '../database-schemas/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseChanges(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(schemasServices.schemas),
  );
  host.onDispose(() => service.close());
  host.provide(services.changes, suiteService(databaseHttpSchemas.changes, service));
}
export const route = suiteRoute(
  'database-changes',
  databaseHttpSchemas.changes,
  services.changes,
  databaseRouteMetadata.changes,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.changes).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.changes).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

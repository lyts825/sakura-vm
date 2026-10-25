import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseSchemas } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseSchemas(meta('state'), authorize, host.use(sourcesServices.sources));
  host.onDispose(() => service.close());
  host.provide(services.schemas, suiteService(databaseHttpSchemas.schemas, service));
}
export const route = suiteRoute(
  'database-schemas',
  databaseHttpSchemas.schemas,
  services.schemas,
  databaseRouteMetadata.schemas,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.schemas).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.schemas).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

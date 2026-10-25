import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseSources } from '../../server/suite-database.ts';
import { services } from './services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseSources(meta('state'), meta('uploads'), authorize);
  host.onDispose(() => service.close());
  host.provide(services.sources, suiteService(databaseHttpSchemas.sources, service));
}
export const route = suiteRoute(
  'database-sources',
  databaseHttpSchemas.sources,
  services.sources,
  databaseRouteMetadata.sources,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.sources).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.sources).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

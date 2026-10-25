import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseFixtures } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as changesServices } from '../database-changes/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseFixtures(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(changesServices.changes),
    () => host.system.optional('databaseRehearsal')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.fixtures, suiteService(databaseHttpSchemas.fixtures, service));
}
export const route = suiteRoute(
  'database-fixtures',
  databaseHttpSchemas.fixtures,
  services.fixtures,
  databaseRouteMetadata.fixtures,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.fixtures).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.fixtures).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseRunners } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as fixturesServices } from '../database-fixtures/services.ts';
import { services as changesServices } from '../database-changes/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseRunners(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(fixturesServices.fixtures),
    host.use(changesServices.changes),
  );
  host.onDispose(() => service.close());
  host.provide(services.runners, suiteService(databaseHttpSchemas.runners, service));
}
export const route = suiteRoute(
  'database-runners',
  databaseHttpSchemas.runners,
  services.runners,
  databaseRouteMetadata.runners,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.runners).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.runners).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

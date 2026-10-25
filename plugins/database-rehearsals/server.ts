import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseRehearsals } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as runnersServices } from '../database-runners/services.ts';
import { services as checksServices } from '../database-checks/services.ts';
import { services as fixturesServices } from '../database-fixtures/services.ts';
import { services as changesServices } from '../database-changes/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseRehearsals(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(runnersServices.runners),
    host.use(checksServices.checks),
    host.use(fixturesServices.fixtures),
    host.use(changesServices.changes),
  );
  host.onDispose(() => service.close());
  host.provide(services.rehearsals, suiteService(databaseHttpSchemas.rehearsals, service));
}
export const route = suiteRoute(
  'database-rehearsals',
  databaseHttpSchemas.rehearsals,
  services.rehearsals,
  databaseRouteMetadata.rehearsals,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.rehearsals).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.rehearsals).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

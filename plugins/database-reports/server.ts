import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseReports } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as runnersServices } from '../database-runners/services.ts';
import { services as checksServices } from '../database-checks/services.ts';
import { services as rehearsalsServices } from '../database-rehearsals/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseReports(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(runnersServices.runners),
    host.use(checksServices.checks),
    host.use(rehearsalsServices.rehearsals),
  );
  host.onDispose(() => service.close());
  host.provide(services.reports, suiteService(databaseHttpSchemas.reports, service));
}
export const route = suiteRoute(
  'database-reports',
  databaseHttpSchemas.reports,
  services.reports,
  databaseRouteMetadata.reports,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.reports).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.reports).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

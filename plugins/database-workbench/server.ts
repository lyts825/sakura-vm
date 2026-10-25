import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseWorkbench } from '../../server/suite-database.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as schemasServices } from '../database-schemas/services.ts';
import { services as changesServices } from '../database-changes/services.ts';
import { services as fixturesServices } from '../database-fixtures/services.ts';
import { services as runnersServices } from '../database-runners/services.ts';
import { services as checksServices } from '../database-checks/services.ts';
import { services as rehearsalsServices } from '../database-rehearsals/services.ts';
import { services as reportsServices } from '../database-reports/services.ts';
import { services as exchangeServices } from '../database-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseWorkbench(meta('state'), authorize, host.use(sourcesServices.sources), {
    sources: host.use(sourcesServices.sources),
    schemas: host.use(schemasServices.schemas),
    changes: host.use(changesServices.changes),
    fixtures: host.use(fixturesServices.fixtures),
    runners: host.use(runnersServices.runners),
    checks: host.use(checksServices.checks),
    rehearsals: host.use(rehearsalsServices.rehearsals),
    reports: host.use(reportsServices.reports),
    exchange: host.use(exchangeServices.exchange),
  });
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(databaseHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'database-workbench',
  databaseHttpSchemas.workbench,
  services.workbench,
  databaseRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

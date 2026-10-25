import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { databaseHttpSchemas } from '../../shared/contracts/database-http.ts';
import { databaseRouteMetadata } from '../../shared/contracts/database-routes.generated.ts';
import { DatabaseExchange } from '../../server/suite-database-exchange.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../database-sources/services.ts';
import { services as schemasServices } from '../database-schemas/services.ts';
import { services as changesServices } from '../database-changes/services.ts';
import { services as fixturesServices } from '../database-fixtures/services.ts';
import { services as runnersServices } from '../database-runners/services.ts';
import { services as checksServices } from '../database-checks/services.ts';
import { services as rehearsalsServices } from '../database-rehearsals/services.ts';
import { services as reportsServices } from '../database-reports/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new DatabaseExchange(
    meta('state'),
    meta('bytes'),
    meta('uploads'),
    authorize,
    host.use(sourcesServices.sources),
    {
      'database-sources': host.use(sourcesServices.sources),
      'database-schemas': host.use(schemasServices.schemas),
      'database-changes': host.use(changesServices.changes),
      'database-fixtures': host.use(fixturesServices.fixtures),
      'database-runners': host.use(runnersServices.runners),
      'database-checks': host.use(checksServices.checks),
      'database-rehearsals': host.use(rehearsalsServices.rehearsals),
      'database-reports': host.use(reportsServices.reports),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(databaseHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'database-exchange',
  databaseHttpSchemas.exchange,
  services.exchange,
  databaseRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(databaseHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(databaseHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

/** 装配本插件拥有的领域对象，经宿主代理保留实际消费者及来源授权。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { incidentHttpSchemas } from '../../shared/contracts/incident-http.ts';
import { incidentRouteMetadata } from '../../shared/contracts/incident-routes.generated.ts';
import { IncidentRunbooks } from '../../server/suite-incident.ts';
import { services } from './services.ts';
import { services as casesServices } from '../incident-cases/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new IncidentRunbooks(meta('state'), authorize, host.use(casesServices.cases));
  host.onDispose(() => service.close());
  host.provide(services.runbooks, suiteService(incidentHttpSchemas.runbooks, service));
}
export const route = suiteRoute(
  'incident-runbooks',
  incidentHttpSchemas.runbooks,
  services.runbooks,
  incidentRouteMetadata.runbooks,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(incidentHttpSchemas.runbooks).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(incidentHttpSchemas.runbooks).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

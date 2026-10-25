/** 装配本插件拥有的领域对象，经宿主代理保留实际消费者及来源授权。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { incidentHttpSchemas } from '../../shared/contracts/incident-http.ts';
import { incidentRouteMetadata } from '../../shared/contracts/incident-routes.generated.ts';
import { IncidentEvidence } from '../../server/suite-incident-evidence.ts';
import { services } from './services.ts';
import { services as casesServices } from '../incident-cases/services.ts';
import { services as metricsServices } from '../metrics/services.ts';
import { services as healthServices } from '../service-health/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new IncidentEvidence(
    meta('state'),
    meta('uploads'),
    authorize,
    host.use(casesServices.cases),
    (kind) =>
      kind === 'metrics' ? host.optional(metricsServices.snapshots) : host.optional(healthServices.snapshots),
  );
  host.onDispose(() => service.close());
  host.provide(services.evidence, suiteService(incidentHttpSchemas.evidence, service));
}
export const route = suiteRoute(
  'incident-evidence',
  incidentHttpSchemas.evidence,
  services.evidence,
  incidentRouteMetadata.evidence,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(incidentHttpSchemas.evidence).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(incidentHttpSchemas.evidence).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

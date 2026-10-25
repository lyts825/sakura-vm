/** 装配本插件拥有的领域对象，经宿主代理保留实际消费者及来源授权。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { incidentHttpSchemas } from '../../shared/contracts/incident-http.ts';
import { incidentRouteMetadata } from '../../shared/contracts/incident-routes.generated.ts';
import { IncidentReviews } from '../../server/suite-incident-reviews.ts';
import { services } from './services.ts';
import { services as casesServices } from '../incident-cases/services.ts';
import { services as evidenceServices } from '../incident-evidence/services.ts';
import { services as timelineServices } from '../incident-timeline/services.ts';
import { services as hypothesesServices } from '../incident-hypotheses/services.ts';
import { services as actionsServices } from '../incident-actions/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new IncidentReviews(
    meta('state'),
    authorize,
    host.use(casesServices.cases),
    host.use(evidenceServices.evidence),
    host.use(timelineServices.timeline),
    host.use(hypothesesServices.hypotheses),
    host.use(actionsServices.actions),
  );
  host.onDispose(() => service.close());
  host.provide(services.reviews, suiteService(incidentHttpSchemas.reviews, service));
}
export const route = suiteRoute(
  'incident-reviews',
  incidentHttpSchemas.reviews,
  services.reviews,
  incidentRouteMetadata.reviews,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(incidentHttpSchemas.reviews).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(incidentHttpSchemas.reviews).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

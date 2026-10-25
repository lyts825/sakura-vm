/** 装配本插件拥有的领域对象，经宿主代理保留实际消费者及来源授权。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { incidentHttpSchemas } from '../../shared/contracts/incident-http.ts';
import { incidentRouteMetadata } from '../../shared/contracts/incident-routes.generated.ts';
import { IncidentExchange } from '../../server/suite-incident-exchange.ts';
import { services } from './services.ts';
import { services as casesServices } from '../incident-cases/services.ts';
import { services as evidenceServices } from '../incident-evidence/services.ts';
import { services as timelineServices } from '../incident-timeline/services.ts';
import { services as hypothesesServices } from '../incident-hypotheses/services.ts';
import { services as runbooksServices } from '../incident-runbooks/services.ts';
import { services as actionsServices } from '../incident-actions/services.ts';
import { services as reviewsServices } from '../incident-reviews/services.ts';
import { services as reportsServices } from '../incident-reports/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new IncidentExchange(
    meta('state'),
    meta('bytes'),
    meta('uploads'),
    authorize,
    host.use(casesServices.cases),
    host.use(evidenceServices.evidence),
    {
      'incident-cases': host.use(casesServices.cases),
      'incident-evidence': host.use(evidenceServices.evidence),
      'incident-timeline': host.use(timelineServices.timeline),
      'incident-hypotheses': host.use(hypothesesServices.hypotheses),
      'incident-runbooks': host.use(runbooksServices.runbooks),
      'incident-actions': host.use(actionsServices.actions),
      'incident-reviews': host.use(reviewsServices.reviews),
      'incident-reports': host.use(reportsServices.reports),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(incidentHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'incident-exchange',
  incidentHttpSchemas.exchange,
  services.exchange,
  incidentRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(incidentHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(incidentHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

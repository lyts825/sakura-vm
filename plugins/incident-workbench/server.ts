/** 装配本插件拥有的领域对象，经宿主代理保留实际消费者及来源授权。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { incidentHttpSchemas } from '../../shared/contracts/incident-http.ts';
import { incidentRouteMetadata } from '../../shared/contracts/incident-routes.generated.ts';
import { IncidentWorkbench } from '../../server/suite-incident-workbench.ts';
import { services } from './services.ts';
import { services as casesServices } from '../incident-cases/services.ts';
import { services as evidenceServices } from '../incident-evidence/services.ts';
import { services as timelineServices } from '../incident-timeline/services.ts';
import { services as hypothesesServices } from '../incident-hypotheses/services.ts';
import { services as runbooksServices } from '../incident-runbooks/services.ts';
import { services as actionsServices } from '../incident-actions/services.ts';
import { services as reviewsServices } from '../incident-reviews/services.ts';
import { services as reportsServices } from '../incident-reports/services.ts';
import { services as exchangeServices } from '../incident-exchange/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new IncidentWorkbench(meta('state'), authorize, {
    cases: host.use(casesServices.cases),
    evidence: host.use(evidenceServices.evidence),
    timeline: host.use(timelineServices.timeline),
    hypotheses: host.use(hypothesesServices.hypotheses),
    runbooks: host.use(runbooksServices.runbooks),
    actions: host.use(actionsServices.actions),
    reviews: host.use(reviewsServices.reviews),
    reports: host.use(reportsServices.reports),
    exchange: host.use(exchangeServices.exchange),
  });
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(incidentHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'incident-workbench',
  incidentHttpSchemas.workbench,
  services.workbench,
  incidentRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(incidentHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(incidentHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationWorkbench } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
import { services as promptsServices } from '../evaluation-prompts/services.ts';
import { services as endpointsServices } from '../evaluation-endpoints/services.ts';
import { services as runnersServices } from '../evaluation-runners/services.ts';
import { services as scorersServices } from '../evaluation-scorers/services.ts';
import { services as comparisonsServices } from '../evaluation-comparisons/services.ts';
import { services as reviewsServices } from '../evaluation-reviews/services.ts';
import { services as reportsServices } from '../evaluation-reports/services.ts';
import { services as exchangeServices } from '../evaluation-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationWorkbench(meta('state'), authorize, host.use(datasetsServices.datasets), {
    'evaluation-datasets': host.use(datasetsServices.datasets),
    'evaluation-prompts': host.use(promptsServices.prompts),
    'evaluation-endpoints': host.use(endpointsServices.endpoints),
    'evaluation-runners': host.use(runnersServices.runners),
    'evaluation-scorers': host.use(scorersServices.scorers),
    'evaluation-comparisons': host.use(comparisonsServices.comparisons),
    'evaluation-reviews': host.use(reviewsServices.reviews),
    'evaluation-reports': host.use(reportsServices.reports),
    'evaluation-exchange': host.use(exchangeServices.exchange),
  });
  host.provide(services.workbench, suiteService(evaluationHttpSchemas.workbench, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-workbench',
  evaluationHttpSchemas.workbench,
  services.workbench,
  evaluationRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

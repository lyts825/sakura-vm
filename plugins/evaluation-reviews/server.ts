import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationReviews } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
import { services as comparisonsServices } from '../evaluation-comparisons/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationReviews(meta('state'), authorize, host.use(datasetsServices.datasets), {
    'evaluation-datasets': host.use(datasetsServices.datasets),
    'evaluation-comparisons': host.use(comparisonsServices.comparisons),
  });
  host.provide(services.reviews, suiteService(evaluationHttpSchemas.reviews, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-reviews',
  evaluationHttpSchemas.reviews,
  services.reviews,
  evaluationRouteMetadata.reviews,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.reviews).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.reviews).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

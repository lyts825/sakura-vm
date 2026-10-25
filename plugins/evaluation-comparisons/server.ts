import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationComparisons } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
import { services as promptsServices } from '../evaluation-prompts/services.ts';
import { services as runnersServices } from '../evaluation-runners/services.ts';
import { services as scorersServices } from '../evaluation-scorers/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationComparisons(meta('state'), authorize, host.use(datasetsServices.datasets), {
    'evaluation-datasets': host.use(datasetsServices.datasets),
    'evaluation-prompts': host.use(promptsServices.prompts),
    'evaluation-runners': host.use(runnersServices.runners),
    'evaluation-scorers': host.use(scorersServices.scorers),
  });
  host.provide(services.comparisons, suiteService(evaluationHttpSchemas.comparisons, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-comparisons',
  evaluationHttpSchemas.comparisons,
  services.comparisons,
  evaluationRouteMetadata.comparisons,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.comparisons).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.comparisons).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

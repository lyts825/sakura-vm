import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationRunners } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
import { services as promptsServices } from '../evaluation-prompts/services.ts';
import { services as endpointsServices } from '../evaluation-endpoints/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationRunners(
    meta('state'),
    authorize,
    host.use(datasetsServices.datasets),
    {
      'evaluation-datasets': host.use(datasetsServices.datasets),
      'evaluation-prompts': host.use(promptsServices.prompts),
      'evaluation-endpoints': host.use(endpointsServices.endpoints),
    },
    host.use(endpointsServices.endpoints),
    host.system.optional('evaluationCalls')!,
  );
  host.provide(services.runners, suiteService(evaluationHttpSchemas.runners, service));
  host.registerJobs(service.jobs, () => {
    throw new Error('原评测或判分调用不能重放，请创建新计划');
  });
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-runners',
  evaluationHttpSchemas.runners,
  services.runners,
  evaluationRouteMetadata.runners,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.runners).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.runners).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

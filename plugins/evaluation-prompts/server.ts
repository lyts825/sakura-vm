import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationPrompts } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationPrompts(meta('state'), authorize, host.use(datasetsServices.datasets), {
    'evaluation-datasets': host.use(datasetsServices.datasets),
  });
  host.provide(services.prompts, suiteService(evaluationHttpSchemas.prompts, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-prompts',
  evaluationHttpSchemas.prompts,
  services.prompts,
  evaluationRouteMetadata.prompts,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.prompts).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.prompts).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

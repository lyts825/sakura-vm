import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationEndpoints } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
import { services as datasetsServices } from '../evaluation-datasets/services.ts';
import { services as secretsServices } from '../secrets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationEndpoints(
    meta('state'),
    authorize,
    host.use(datasetsServices.datasets),
    host.use(secretsServices.secrets),
    host.system.optional('evaluationCalls')!,
  );
  host.provide(services.endpoints, suiteService(evaluationHttpSchemas.endpoints, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-endpoints',
  evaluationHttpSchemas.endpoints,
  services.endpoints,
  evaluationRouteMetadata.endpoints,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.endpoints).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.endpoints).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

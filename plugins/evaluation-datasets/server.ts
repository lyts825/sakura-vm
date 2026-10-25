import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { evaluationHttpSchemas } from '../../shared/contracts/evaluation-http.ts';
import { evaluationRouteMetadata } from '../../shared/contracts/evaluation-routes.generated.ts';
import { EvaluationDatasets } from '../../server/evaluation-studio.ts';
import { services } from './services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new EvaluationDatasets(meta('state'), meta('uploads'), authorize);
  host.provide(services.datasets, suiteService(evaluationHttpSchemas.datasets, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'evaluation-datasets',
  evaluationHttpSchemas.datasets,
  services.datasets,
  evaluationRouteMetadata.datasets,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(evaluationHttpSchemas.datasets).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(evaluationHttpSchemas.datasets).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

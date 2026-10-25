import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowDefinitions } from '../../server/flow-studio.ts';
import { services } from './services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowDefinitions(meta('state'), authorize);
  host.provide(services.definitions, suiteService(flowHttpSchemas.definitions, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-definitions',
  flowHttpSchemas.definitions,
  services.definitions,
  flowRouteMetadata.definitions,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.definitions).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.definitions).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

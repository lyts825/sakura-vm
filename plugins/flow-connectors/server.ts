import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowConnectors } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';
import { services as integrationServices } from '../integration-runners/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowConnectors(
    meta('state'),
    authorize,
    host.use(definitionsServices.definitions),
    () => host.system.optional('delegatedActions'),
    () => host.optional(integrationServices.runners),
  );
  host.provide(services.connectors, suiteService(flowHttpSchemas.connectors, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-connectors',
  flowHttpSchemas.connectors,
  services.connectors,
  flowRouteMetadata.connectors,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.connectors).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.connectors).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

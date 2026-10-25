import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowInputs } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowInputs(
    meta('state'),
    meta('uploads'),
    authorize,
    host.use(definitionsServices.definitions),
  );
  host.provide(services.inputs, suiteService(flowHttpSchemas.inputs, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-inputs',
  flowHttpSchemas.inputs,
  services.inputs,
  flowRouteMetadata.inputs,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.inputs).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.inputs).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

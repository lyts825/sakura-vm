import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowPlans } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';
import { services as inputsServices } from '../flow-inputs/services.ts';
import { services as connectorsServices } from '../flow-connectors/services.ts';
import { services as journalServices } from '../flow-journal/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowPlans(
    meta('state'),
    authorize,
    host.use(definitionsServices.definitions),
    {
      'flow-definitions': host.use(definitionsServices.definitions),
      'flow-inputs': host.use(inputsServices.inputs),
      'flow-connectors': host.use(connectorsServices.connectors),
      'flow-journal': host.use(journalServices.journal),
    },
    host.use(connectorsServices.connectors),
  );
  host.provide(services.plans, suiteService(flowHttpSchemas.plans, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('flow-plans', flowHttpSchemas.plans, services.plans, flowRouteMetadata.plans);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.plans).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.plans).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowApprovals } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';
import { services as plansServices } from '../flow-plans/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowApprovals(
    meta('state'),
    authorize,
    host.use(definitionsServices.definitions),
    host.use(plansServices.plans),
  );
  host.provide(services.approvals, suiteService(flowHttpSchemas.approvals, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-approvals',
  flowHttpSchemas.approvals,
  services.approvals,
  flowRouteMetadata.approvals,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.approvals).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.approvals).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

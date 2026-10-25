import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowWorkbench } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';
import { services as inputsServices } from '../flow-inputs/services.ts';
import { services as connectorsServices } from '../flow-connectors/services.ts';
import { services as plansServices } from '../flow-plans/services.ts';
import { services as approvalsServices } from '../flow-approvals/services.ts';
import { services as journalServices } from '../flow-journal/services.ts';
import { services as runsServices } from '../flow-runs/services.ts';
import { services as timersServices } from '../flow-timers/services.ts';
import { services as exchangeServices } from '../flow-exchange/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowWorkbench(meta('state'), authorize, host.use(definitionsServices.definitions), {
    'flow-definitions': host.use(definitionsServices.definitions),
    'flow-inputs': host.use(inputsServices.inputs),
    'flow-connectors': host.use(connectorsServices.connectors),
    'flow-plans': host.use(plansServices.plans),
    'flow-approvals': host.use(approvalsServices.approvals),
    'flow-journal': host.use(journalServices.journal),
    'flow-runs': host.use(runsServices.runs),
    'flow-timers': host.use(timersServices.timers),
    'flow-exchange': host.use(exchangeServices.exchange),
  });
  host.provide(services.workbench, suiteService(flowHttpSchemas.workbench, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-workbench',
  flowHttpSchemas.workbench,
  services.workbench,
  flowRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

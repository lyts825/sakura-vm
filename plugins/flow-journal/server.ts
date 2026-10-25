import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { flowHttpSchemas } from '../../shared/contracts/flow-http.ts';
import { flowRouteMetadata } from '../../shared/contracts/flow-routes.generated.ts';
import { FlowJournal } from '../../server/flow-studio.ts';
import { services } from './services.ts';
import { services as definitionsServices } from '../flow-definitions/services.ts';
import { services as inputsServices } from '../flow-inputs/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new FlowJournal(meta('state'), authorize, host.use(definitionsServices.definitions), {
    'flow-definitions': host.use(definitionsServices.definitions),
    'flow-inputs': host.use(inputsServices.inputs),
  });
  host.provide(services.journal, suiteService(flowHttpSchemas.journal, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute(
  'flow-journal',
  flowHttpSchemas.journal,
  services.journal,
  flowRouteMetadata.journal,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(flowHttpSchemas.journal).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(flowHttpSchemas.journal).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

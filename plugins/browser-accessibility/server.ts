import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserAccessibility } from '../../server/suite-browser.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as runnersServices } from '../browser-runners/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserAccessibility(
    'browser-accessibility',
    meta('state'),
    authorize,
    host.use(targetsServices.targets),
    {
      'browser-targets': host.use(targetsServices.targets),
      'browser-journeys': host.use(journeysServices.journeys),
      'browser-runners': host.use(runnersServices.runners),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.accessibility, suiteService(browserHttpSchemas.accessibility, service));
}
export const route = suiteRoute(
  'browser-accessibility',
  browserHttpSchemas.accessibility,
  services.accessibility,
  browserRouteMetadata.accessibility,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.accessibility).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.accessibility).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

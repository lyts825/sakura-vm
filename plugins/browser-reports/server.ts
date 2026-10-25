import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserReports } from '../../server/suite-browser.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as runnersServices } from '../browser-runners/services.ts';
import { services as assertionsServices } from '../browser-assertions/services.ts';
import { services as visualServices } from '../browser-visual/services.ts';
import { services as accessibilityServices } from '../browser-accessibility/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserReports(
    'browser-reports',
    meta('state'),
    authorize,
    host.use(targetsServices.targets),
    {
      'browser-targets': host.use(targetsServices.targets),
      'browser-journeys': host.use(journeysServices.journeys),
      'browser-runners': host.use(runnersServices.runners),
      'browser-assertions': host.use(assertionsServices.assertions),
      'browser-visual': host.use(visualServices.visual),
      'browser-accessibility': host.use(accessibilityServices.accessibility),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.reports, suiteService(browserHttpSchemas.reports, service));
}
export const route = suiteRoute(
  'browser-reports',
  browserHttpSchemas.reports,
  services.reports,
  browserRouteMetadata.reports,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.reports).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.reports).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserExchange } from '../../server/suite-browser-exchange.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as fixturesServices } from '../browser-fixtures/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as runnersServices } from '../browser-runners/services.ts';
import { services as assertionsServices } from '../browser-assertions/services.ts';
import { services as visualServices } from '../browser-visual/services.ts';
import { services as accessibilityServices } from '../browser-accessibility/services.ts';
import { services as reportsServices } from '../browser-reports/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserExchange(
    meta('state'),
    meta('blobs'),
    meta('uploads'),
    authorize,
    host.use(targetsServices.targets),
    {
      'browser-targets': host.use(targetsServices.targets),
      'browser-fixtures': host.use(fixturesServices.fixtures),
      'browser-journeys': host.use(journeysServices.journeys),
      'browser-runners': host.use(runnersServices.runners),
      'browser-assertions': host.use(assertionsServices.assertions),
      'browser-visual': host.use(visualServices.visual),
      'browser-accessibility': host.use(accessibilityServices.accessibility),
      'browser-reports': host.use(reportsServices.reports),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(browserHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'browser-exchange',
  browserHttpSchemas.exchange,
  services.exchange,
  browserRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

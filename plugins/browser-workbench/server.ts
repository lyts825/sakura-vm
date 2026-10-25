import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserWorkbench } from '../../server/suite-browser-workbench.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as fixturesServices } from '../browser-fixtures/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as runnersServices } from '../browser-runners/services.ts';
import { services as assertionsServices } from '../browser-assertions/services.ts';
import { services as visualServices } from '../browser-visual/services.ts';
import { services as accessibilityServices } from '../browser-accessibility/services.ts';
import { services as reportsServices } from '../browser-reports/services.ts';
import { services as exchangeServices } from '../browser-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserWorkbench(meta('state'), authorize, {
    targets: host.use(targetsServices.targets),
    fixtures: host.use(fixturesServices.fixtures),
    journeys: host.use(journeysServices.journeys),
    runners: host.use(runnersServices.runners),
    assertions: host.use(assertionsServices.assertions),
    visual: host.use(visualServices.visual),
    accessibility: host.use(accessibilityServices.accessibility),
    reports: host.use(reportsServices.reports),
    exchange: host.use(exchangeServices.exchange),
  });
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(browserHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'browser-workbench',
  browserHttpSchemas.workbench,
  services.workbench,
  browserRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

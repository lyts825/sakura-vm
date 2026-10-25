import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserVisual } from '../../server/suite-browser.ts';
import { suiteFail } from '../../server/suite-store.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as runnersServices } from '../browser-runners/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserVisual(meta('state'), authorize, host.use(targetsServices.targets), {
    'browser-targets': host.use(targetsServices.targets),
    'browser-journeys': host.use(journeysServices.journeys),
    get 'browser-runners'() {
      return host.optional(runnersServices.runners) ?? suiteFail('BROWSER_RUNNER_UNAVAILABLE');
    },
  });
  host.onDispose(() => service.close());
  host.provide(services.visual, suiteService(browserHttpSchemas.visual, service));
}
export const route = suiteRoute(
  'browser-visual',
  browserHttpSchemas.visual,
  services.visual,
  browserRouteMetadata.visual,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.visual).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.visual).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

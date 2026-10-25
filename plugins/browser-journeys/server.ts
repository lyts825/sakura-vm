import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserJourneys } from '../../server/suite-browser.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as fixturesServices } from '../browser-fixtures/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserJourneys(
    'browser-journeys',
    meta('state'),
    authorize,
    host.use(targetsServices.targets),
    {
      'browser-targets': host.use(targetsServices.targets),
      'browser-fixtures': host.use(fixturesServices.fixtures),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.journeys, suiteService(browserHttpSchemas.journeys, service));
}
export const route = suiteRoute(
  'browser-journeys',
  browserHttpSchemas.journeys,
  services.journeys,
  browserRouteMetadata.journeys,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.journeys).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.journeys).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

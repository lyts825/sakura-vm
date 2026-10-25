import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserRunners } from '../../server/suite-browser-runners.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
import { services as fixturesServices } from '../browser-fixtures/services.ts';
import { services as journeysServices } from '../browser-journeys/services.ts';
import { services as visualServices } from '../browser-visual/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserRunners(
    meta('state'),
    authorize,
    host.use(targetsServices.targets),
    {
      'browser-targets': host.use(targetsServices.targets),
      'browser-fixtures': host.use(fixturesServices.fixtures),
      'browser-journeys': host.use(journeysServices.journeys),
      'browser-visual': host.use(visualServices.visual),
    },
    host.system.optional('browserSessions')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.runners, suiteService(browserHttpSchemas.runners, service));
}
export const route = suiteRoute(
  'browser-runners',
  browserHttpSchemas.runners,
  services.runners,
  browserRouteMetadata.runners,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.runners).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.runners).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

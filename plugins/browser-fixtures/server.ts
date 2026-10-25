import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserFixtures } from '../../server/suite-browser.ts';
import { services } from './services.ts';
import { services as targetsServices } from '../browser-targets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserFixtures(
    'browser-fixtures',
    meta('state'),
    authorize,
    host.use(targetsServices.targets),
    { 'browser-targets': host.use(targetsServices.targets) },
  );
  host.onDispose(() => service.close());
  host.provide(services.fixtures, suiteService(browserHttpSchemas.fixtures, service));
}
export const route = suiteRoute(
  'browser-fixtures',
  browserHttpSchemas.fixtures,
  services.fixtures,
  browserRouteMetadata.fixtures,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.fixtures).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.fixtures).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

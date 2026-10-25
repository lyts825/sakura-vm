import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { browserHttpSchemas } from '../../shared/contracts/browser-http.ts';
import { browserRouteMetadata } from '../../shared/contracts/browser-routes.generated.ts';
import { BrowserTargets } from '../../server/suite-browser.ts';
import { services } from './services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new BrowserTargets(
    meta('state'),
    meta('uploads'),
    authorize,
    host.system.optional('imageAssets')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.targets, suiteService(browserHttpSchemas.targets, service));
}
export const route = suiteRoute(
  'browser-targets',
  browserHttpSchemas.targets,
  services.targets,
  browserRouteMetadata.targets,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(browserHttpSchemas.targets).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(browserHttpSchemas.targets).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

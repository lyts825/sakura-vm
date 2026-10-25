import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaWorkers } from '../../server/suite-media.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as inspectServices } from '../media-inspect/services.ts';
import { services as recipesServices } from '../media-recipes/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaWorkers(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(inspectServices.inspect),
    host.use(recipesServices.recipes),
    () => host.system.optional('mediaTasks')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.workers, suiteService(mediaHttpSchemas.workers, service));
}
export const route = suiteRoute(
  'media-workers',
  mediaHttpSchemas.workers,
  services.workers,
  mediaRouteMetadata.workers,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.workers).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.workers).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

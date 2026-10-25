import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaCollections } from '../../server/suite-media.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as workersServices } from '../media-workers/services.ts';
import { services as captionsServices } from '../media-captions/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaCollections(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(workersServices.workers),
    host.use(captionsServices.captions),
  );
  host.onDispose(() => service.close());
  host.provide(services.collections, suiteService(mediaHttpSchemas.collections, service));
}
export const route = suiteRoute(
  'media-collections',
  mediaHttpSchemas.collections,
  services.collections,
  mediaRouteMetadata.collections,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.collections).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.collections).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaExchange } from '../../server/suite-media-exchange.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as inspectServices } from '../media-inspect/services.ts';
import { services as recipesServices } from '../media-recipes/services.ts';
import { services as workersServices } from '../media-workers/services.ts';
import { services as captionsServices } from '../media-captions/services.ts';
import { services as collectionsServices } from '../media-collections/services.ts';
import { services as reviewsServices } from '../media-reviews/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaExchange(
    meta('state'),
    meta('blobs'),
    meta('uploads'),
    authorize,
    host.use(sourcesServices.sources),
    {
      'media-sources': host.use(sourcesServices.sources),
      'media-inspect': host.use(inspectServices.inspect),
      'media-recipes': host.use(recipesServices.recipes),
      'media-workers': host.use(workersServices.workers),
      'media-captions': host.use(captionsServices.captions),
      'media-collections': host.use(collectionsServices.collections),
      'media-reviews': host.use(reviewsServices.reviews),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(mediaHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'media-exchange',
  mediaHttpSchemas.exchange,
  services.exchange,
  mediaRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaReviews } from '../../server/suite-media.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as collectionsServices } from '../media-collections/services.ts';
import { services as inspectServices } from '../media-inspect/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaReviews(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(collectionsServices.collections),
    host.use(inspectServices.inspect),
  );
  host.onDispose(() => service.close());
  host.provide(services.reviews, suiteService(mediaHttpSchemas.reviews, service));
}
export const route = suiteRoute(
  'media-reviews',
  mediaHttpSchemas.reviews,
  services.reviews,
  mediaRouteMetadata.reviews,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.reviews).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.reviews).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

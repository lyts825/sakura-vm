import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaWorkbench } from '../../server/suite-media.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as inspectServices } from '../media-inspect/services.ts';
import { services as recipesServices } from '../media-recipes/services.ts';
import { services as workersServices } from '../media-workers/services.ts';
import { services as captionsServices } from '../media-captions/services.ts';
import { services as collectionsServices } from '../media-collections/services.ts';
import { services as reviewsServices } from '../media-reviews/services.ts';
import { services as exchangeServices } from '../media-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaWorkbench(meta('state'), authorize, host.use(sourcesServices.sources), {
    'media-sources': host.use(sourcesServices.sources),
    'media-inspect': host.use(inspectServices.inspect),
    'media-recipes': host.use(recipesServices.recipes),
    'media-workers': host.use(workersServices.workers),
    'media-captions': host.use(captionsServices.captions),
    'media-collections': host.use(collectionsServices.collections),
    'media-reviews': host.use(reviewsServices.reviews),
    'media-exchange': host.use(exchangeServices.exchange),
  });
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(mediaHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'media-workbench',
  mediaHttpSchemas.workbench,
  services.workbench,
  mediaRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

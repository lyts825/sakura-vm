import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { mediaHttpSchemas } from '../../shared/contracts/media-http.ts';
import { mediaRouteMetadata } from '../../shared/contracts/media-routes.generated.ts';
import { MediaCaptions } from '../../server/suite-media.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../media-sources/services.ts';
import { services as workersServices } from '../media-workers/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new MediaCaptions(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(workersServices.workers),
  );
  host.onDispose(() => service.close());
  host.provide(services.captions, suiteService(mediaHttpSchemas.captions, service));
}
export const route = suiteRoute(
  'media-captions',
  mediaHttpSchemas.captions,
  services.captions,
  mediaRouteMetadata.captions,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(mediaHttpSchemas.captions).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(mediaHttpSchemas.captions).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

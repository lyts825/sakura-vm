import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningAssets } from '../../server/suite-learning.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningAssets(
    meta('state'),
    meta('uploads'),
    authorize,
    host.use(coursesServices.courses),
    host.system.optional('imageAssets')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.assets, suiteService(learningHttpSchemas.assets, service));
}
export const route = suiteRoute(
  'learning-assets',
  learningHttpSchemas.assets,
  services.assets,
  learningRouteMetadata.assets,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.assets).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.assets).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

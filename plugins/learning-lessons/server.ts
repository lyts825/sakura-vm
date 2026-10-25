import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningLessons } from '../../server/suite-learning.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as assetsServices } from '../learning-assets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningLessons(
    'learning-lessons',
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-assets': host.use(assetsServices.assets),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.lessons, suiteService(learningHttpSchemas.lessons, service));
}
export const route = suiteRoute(
  'learning-lessons',
  learningHttpSchemas.lessons,
  services.lessons,
  learningRouteMetadata.lessons,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.lessons).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.lessons).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

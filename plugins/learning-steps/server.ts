import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningSteps } from '../../server/suite-learning.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
import { services as assetsServices } from '../learning-assets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningSteps(
    'learning-steps',
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-lessons': host.use(lessonsServices.lessons),
      'learning-assets': host.use(assetsServices.assets),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.steps, suiteService(learningHttpSchemas.steps, service));
}
export const route = suiteRoute(
  'learning-steps',
  learningHttpSchemas.steps,
  services.steps,
  learningRouteMetadata.steps,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.steps).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.steps).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

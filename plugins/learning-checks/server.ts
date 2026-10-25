import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningChecks } from '../../server/suite-learning.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningChecks(
    'learning-checks',
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-lessons': host.use(lessonsServices.lessons),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.checks, suiteService(learningHttpSchemas.checks, service));
}
export const route = suiteRoute(
  'learning-checks',
  learningHttpSchemas.checks,
  services.checks,
  learningRouteMetadata.checks,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.checks).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.checks).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningCourses } from '../../server/suite-learning.ts';
import { suiteFail } from '../../server/suite-store.ts';
import { services } from './services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningCourses(
    meta('state'),
    authorize,
    () => host.optional(lessonsServices.lessons) ?? suiteFail('LEARNING_LESSONS_UNAVAILABLE'),
  );
  host.onDispose(() => service.close());
  host.provide(services.courses, suiteService(learningHttpSchemas.courses, service));
}
export const route = suiteRoute(
  'learning-courses',
  learningHttpSchemas.courses,
  services.courses,
  learningRouteMetadata.courses,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.courses).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.courses).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

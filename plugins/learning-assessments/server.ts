import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningAssessments } from '../../server/suite-learning.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as sessionsServices } from '../learning-sessions/services.ts';
import { services as checksServices } from '../learning-checks/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningAssessments(
    'learning-assessments',
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-sessions': host.use(sessionsServices.sessions),
      'learning-checks': host.use(checksServices.checks),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.assessments, suiteService(learningHttpSchemas.assessments, service));
}
export const route = suiteRoute(
  'learning-assessments',
  learningHttpSchemas.assessments,
  services.assessments,
  learningRouteMetadata.assessments,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.assessments).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.assessments).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningSessions } from '../../server/suite-learning-sessions.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as environmentsServices } from '../learning-environments/services.ts';
import { services as stepsServices } from '../learning-steps/services.ts';
import { services as checksServices } from '../learning-checks/services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
import { services as assetsServices } from '../learning-assets/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningSessions(
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-environments': host.use(environmentsServices.environments),
      'learning-steps': host.use(stepsServices.steps),
      'learning-checks': host.use(checksServices.checks),
      'learning-lessons': host.use(lessonsServices.lessons),
      'learning-assets': host.use(assetsServices.assets),
    },
    host.system.optional('learningToolSessions')!,
  );
  host.onDispose(() => service.close());
  host.provide(services.sessions, suiteService(learningHttpSchemas.sessions, service));
}
export const route = suiteRoute(
  'learning-sessions',
  learningHttpSchemas.sessions,
  services.sessions,
  learningRouteMetadata.sessions,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.sessions).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.sessions).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

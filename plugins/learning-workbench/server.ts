import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningWorkbench } from '../../server/suite-learning-workbench.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as assetsServices } from '../learning-assets/services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
import { services as environmentsServices } from '../learning-environments/services.ts';
import { services as stepsServices } from '../learning-steps/services.ts';
import { services as checksServices } from '../learning-checks/services.ts';
import { services as sessionsServices } from '../learning-sessions/services.ts';
import { services as progressServices } from '../learning-progress/services.ts';
import { services as assessmentsServices } from '../learning-assessments/services.ts';
import { services as exchangeServices } from '../learning-exchange/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningWorkbench(meta('state'), authorize, {
    courses: host.use(coursesServices.courses),
    assets: host.use(assetsServices.assets),
    lessons: host.use(lessonsServices.lessons),
    environments: host.use(environmentsServices.environments),
    steps: host.use(stepsServices.steps),
    checks: host.use(checksServices.checks),
    sessions: host.use(sessionsServices.sessions),
    progress: host.use(progressServices.progress),
    assessments: host.use(assessmentsServices.assessments),
    exchange: host.use(exchangeServices.exchange),
  });
  host.onDispose(() => service.close());
  host.provide(services.workbench, suiteService(learningHttpSchemas.workbench, service));
}
export const route = suiteRoute(
  'learning-workbench',
  learningHttpSchemas.workbench,
  services.workbench,
  learningRouteMetadata.workbench,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

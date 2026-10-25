import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningExchange } from '../../server/suite-learning-exchange.ts';
import { suiteMaterialsPort } from '../../server/suite-materials-port.ts';
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
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningExchange(
    meta('state'),
    meta('blobs'),
    meta('uploads'),
    authorize,
    suiteMaterialsPort(host.use(coursesServices.courses), host.use(assetsServices.assets)),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-assets': host.use(assetsServices.assets),
      'learning-lessons': host.use(lessonsServices.lessons),
      'learning-environments': host.use(environmentsServices.environments),
      'learning-steps': host.use(stepsServices.steps),
      'learning-checks': host.use(checksServices.checks),
      'learning-sessions': host.use(sessionsServices.sessions),
      'learning-progress': host.use(progressServices.progress),
      'learning-assessments': host.use(assessmentsServices.assessments),
    },
  );
  host.onDispose(() => service.close());
  host.provide(services.exchange, suiteService(learningHttpSchemas.exchange, service));
}
export const route = suiteRoute(
  'learning-exchange',
  learningHttpSchemas.exchange,
  services.exchange,
  learningRouteMetadata.exchange,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { learningHttpSchemas } from '../../shared/contracts/learning-http.ts';
import { learningRouteMetadata } from '../../shared/contracts/learning-routes.generated.ts';
import { LearningEnvironments } from '../../server/suite-learning.ts';
import { suiteFail } from '../../server/suite-store.ts';
import { services } from './services.ts';
import { services as coursesServices } from '../learning-courses/services.ts';
import { services as assetsServices } from '../learning-assets/services.ts';
import { services as lessonsServices } from '../learning-lessons/services.ts';
import { services as sessionsServices } from '../learning-sessions/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new LearningEnvironments(
    meta('state'),
    authorize,
    host.use(coursesServices.courses),
    {
      'learning-courses': host.use(coursesServices.courses),
      'learning-assets': host.use(assetsServices.assets),
      'learning-lessons': host.use(lessonsServices.lessons),
      get 'learning-sessions'() {
        return host.optional(sessionsServices.sessions) ?? suiteFail('LEARNING_PEER_UNAVAILABLE');
      },
    },
    host.use(assetsServices.assets),
  );
  host.onDispose(() => service.close());
  host.provide(services.environments, suiteService(learningHttpSchemas.environments, service));
}
export const route = suiteRoute(
  'learning-environments',
  learningHttpSchemas.environments,
  services.environments,
  learningRouteMetadata.environments,
);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(learningHttpSchemas.environments).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(learningHttpSchemas.environments).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

/** 装配独立持久领域服务，停用时核销原任务。 Compose one persistent domain and drain owned work. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { knowledgeAuthorize, knowledgeRoute, knowledgeService } from '../../server/knowledge-http.ts';
import { knowledgeHttpSchemas } from '../../shared/contracts/knowledge-http.ts';
import { KnowledgePublish } from '../../server/knowledge-publish.ts';
import { services } from './services.ts';
import { services as sources } from '../knowledge-sources/services.ts';
import { services as evidence } from '../knowledge-evidence/services.ts';
import { services as entries } from '../knowledge-entries/services.ts';
import { services as documents } from '../knowledge-documents/services.ts';
import { services as reviews } from '../knowledge-reviews/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = knowledgeAuthorize(host),
    meta = (name: string, fallback: unknown = []) =>
      host.capabilities.metadata.reference(name, () => fallback);
  const service = new KnowledgePublish(
    meta('publications'),
    meta('plans'),
    host.use(sources.sources),
    host.use(documents.documents),
    host.use(entries.entries),
    host.use(evidence.evidence),
    host.use(reviews.reviews),
    authorize,
  );
  host.provide(services.publish, knowledgeService('publish', service));
  host.onDispose(() => service.close());
}
export const route = knowledgeRoute('publish', services.publish);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(knowledgeHttpSchemas.publish).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(knowledgeHttpSchemas.publish).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

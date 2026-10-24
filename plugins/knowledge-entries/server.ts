/** 装配独立持久领域服务，停用时核销原任务。 Compose one persistent domain and drain owned work. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { knowledgeAuthorize, knowledgeRoute, knowledgeService } from '../../server/knowledge-http.ts';
import { knowledgeHttpSchemas } from '../../shared/contracts/knowledge-http.ts';
import { KnowledgeEntries } from '../../server/knowledge-entries.ts';
import { services } from './services.ts';
import { services as sources } from '../knowledge-sources/services.ts';
import { services as evidence } from '../knowledge-evidence/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = knowledgeAuthorize(host),
    meta = (name: string, fallback: unknown = []) =>
      host.capabilities.metadata.reference(name, () => fallback);
  const service = new KnowledgeEntries(
    meta('entries'),
    host.use(sources.sources),
    host.use(evidence.evidence),
    authorize,
  );
  host.provide(services.entries, knowledgeService('entries', service));
  host.onDispose(() => service.close());
}
export const route = knowledgeRoute('entries', services.entries);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(knowledgeHttpSchemas.entries).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(knowledgeHttpSchemas.entries).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

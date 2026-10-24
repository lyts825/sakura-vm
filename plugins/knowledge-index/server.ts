/** 装配独立持久领域服务，停用时核销原任务。 Compose one persistent domain and drain owned work. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { knowledgeAuthorize, knowledgeRoute, knowledgeService } from '../../server/knowledge-http.ts';
import { knowledgeHttpSchemas } from '../../shared/contracts/knowledge-http.ts';
import { KnowledgeIndex } from '../../server/knowledge-index.ts';
import { services } from './services.ts';
import { services as sources } from '../knowledge-sources/services.ts';
import { services as extract } from '../knowledge-extract/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = knowledgeAuthorize(host),
    meta = (name: string, fallback: unknown = []) =>
      host.capabilities.metadata.reference(name, () => fallback);
  const service = new KnowledgeIndex(
    meta('generations'),
    meta('plans'),
    meta('jobs'),
    host.use(sources.sources),
    host.use(extract.extract),
    authorize,
  );
  host.provide(services.index, knowledgeService('index', service));
  host.onDispose(() => service.close());
}
export const route = knowledgeRoute('index', services.index);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(knowledgeHttpSchemas.index).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(knowledgeHttpSchemas.index).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

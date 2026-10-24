/** 装配独立持久领域服务，停用时核销原任务。 Compose one persistent domain and drain owned work. */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { knowledgeAuthorize, knowledgeRoute, knowledgeService } from '../../server/knowledge-http.ts';
import { knowledgeHttpSchemas } from '../../shared/contracts/knowledge-http.ts';
import { KnowledgeExtract } from '../../server/knowledge-extract.ts';
import { services } from './services.ts';
import { services as sources } from '../knowledge-sources/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = knowledgeAuthorize(host),
    meta = (name: string, fallback: unknown = []) =>
      host.capabilities.metadata.reference(name, () => fallback);
  const service = new KnowledgeExtract(
    meta('extractions'),
    meta('plans'),
    meta('jobs'),
    host.use(sources.sources),
    authorize,
  );
  host.provide(services.extract, knowledgeService('extract', service));
  host.onDispose(() => service.close());
}
export const route = knowledgeRoute('extract', services.extract);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(knowledgeHttpSchemas.extract).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(knowledgeHttpSchemas.extract).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

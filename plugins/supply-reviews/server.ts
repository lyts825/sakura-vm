/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { SupplyReviews } from '../../server/suite-supply.ts';
import { services } from './services.ts';
import { services as policiesServices } from '../supply-policies/services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplyReviews(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(policiesServices.policies),
  );
  host.provide(services.reviews, suiteService(supplyHttpSchemas.reviews, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-reviews', supplyHttpSchemas.reviews, services.reviews);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.reviews).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.reviews).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { supplyRouteMetadata } from '../../shared/contracts/supply-routes.generated.ts';
import { SupplyInventory } from '../../server/suite-supply.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplyInventory(meta('state'), authorize, host.use(sourcesServices.sources));
  host.provide(services.inventory, suiteService(supplyHttpSchemas.inventory, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-inventory', supplyHttpSchemas.inventory, services.inventory, supplyRouteMetadata.inventory);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.inventory).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.inventory).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

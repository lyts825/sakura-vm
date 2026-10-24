/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { supplyRouteMetadata } from '../../shared/contracts/supply-routes.generated.ts';
import { SupplyProvenance } from '../../server/suite-supply.ts';
import { services } from './services.ts';
import { services as inventoryServices } from '../supply-inventory/services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplyProvenance(
    meta('state'),
    authorize,
    host.use(sourcesServices.sources),
    host.use(inventoryServices.inventory),
  );
  host.provide(services.provenance, suiteService(supplyHttpSchemas.provenance, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-provenance', supplyHttpSchemas.provenance, services.provenance, supplyRouteMetadata.provenance);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.provenance).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.provenance).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

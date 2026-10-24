/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { supplyRouteMetadata } from '../../shared/contracts/supply-routes.generated.ts';
import { SupplyPolicies } from '../../server/suite-supply.ts';
import { services } from './services.ts';
import { services as inventoryServices } from '../supply-inventory/services.ts';
import { services as advisoriesServices } from '../supply-advisories/services.ts';
import { services as licensesServices } from '../supply-licenses/services.ts';
import { services as provenanceServices } from '../supply-provenance/services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplyPolicies(meta('state'), authorize, host.use(sourcesServices.sources), {
    'supply-inventory': host.use(inventoryServices.inventory),
    'supply-advisories': host.use(advisoriesServices.advisories),
    'supply-licenses': host.use(licensesServices.licenses),
    'supply-provenance': host.use(provenanceServices.provenance),
  });
  host.provide(services.policies, suiteService(supplyHttpSchemas.policies, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-policies', supplyHttpSchemas.policies, services.policies, supplyRouteMetadata.policies);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.policies).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.policies).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

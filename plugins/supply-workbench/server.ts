/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { supplyRouteMetadata } from '../../shared/contracts/supply-routes.generated.ts';
import { SupplyWorkbench } from '../../server/suite-supply.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';
import { services as inventoryServices } from '../supply-inventory/services.ts';
import { services as advisoriesServices } from '../supply-advisories/services.ts';
import { services as licensesServices } from '../supply-licenses/services.ts';
import { services as provenanceServices } from '../supply-provenance/services.ts';
import { services as policiesServices } from '../supply-policies/services.ts';
import { services as reviewsServices } from '../supply-reviews/services.ts';
import { services as reportsServices } from '../supply-reports/services.ts';
import { services as exchangeServices } from '../supply-exchange/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplyWorkbench(meta('state'), authorize, {
    sources: host.use(sourcesServices.sources),
    inventory: host.use(inventoryServices.inventory),
    advisories: host.use(advisoriesServices.advisories),
    licenses: host.use(licensesServices.licenses),
    provenance: host.use(provenanceServices.provenance),
    policies: host.use(policiesServices.policies),
    reviews: host.use(reviewsServices.reviews),
    reports: host.use(reportsServices.reports),
    exchange: host.use(exchangeServices.exchange),
  });
  host.provide(services.workbench, suiteService(supplyHttpSchemas.workbench, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-workbench', supplyHttpSchemas.workbench, services.workbench, supplyRouteMetadata.workbench);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.workbench).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.workbench).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

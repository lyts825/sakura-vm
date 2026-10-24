/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { SuiteExchange } from '../../server/suite-exchange.ts';
import { supplyTrust } from '../../shared/contracts/supply-audit.ts';
import { services } from './services.ts';
import { services as sourcesServices } from '../supply-sources/services.ts';
import { services as inventoryServices } from '../supply-inventory/services.ts';
import { services as advisoriesServices } from '../supply-advisories/services.ts';
import { services as licensesServices } from '../supply-licenses/services.ts';
import { services as provenanceServices } from '../supply-provenance/services.ts';
import { services as policiesServices } from '../supply-policies/services.ts';
import { services as reviewsServices } from '../supply-reviews/services.ts';
import { services as reportsServices } from '../supply-reports/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SuiteExchange(
    'supply-exchange',
    meta('state'),
    meta('bytes'),
    meta('uploads'),
    authorize,
    host.use(sourcesServices.sources),
    {
      'supply-sources': host.use(sourcesServices.sources),
      'supply-inventory': host.use(inventoryServices.inventory),
      'supply-advisories': host.use(advisoriesServices.advisories),
      'supply-licenses': host.use(licensesServices.licenses),
      'supply-provenance': host.use(provenanceServices.provenance),
      'supply-policies': host.use(policiesServices.policies),
      'supply-reviews': host.use(reviewsServices.reviews),
      'supply-reports': host.use(reportsServices.reports),
    },
    'sakura-supply-audit/1',
    (domain, kind, content) => {
      if (domain === 'supply-provenance' && kind === 'definition') {
        const trust = supplyTrust.parse(content);
        return { publishers: trust.publishers.map((p) => ({ ...p, trusted: false })) };
      }
      return content;
    },
  );
  host.provide(services.exchange, suiteService(supplyHttpSchemas.exchange, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-exchange', supplyHttpSchemas.exchange, services.exchange);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.exchange).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.exchange).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

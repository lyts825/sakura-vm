/** 装配独立存储并注册明确的业务方法。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { supplyHttpSchemas } from '../../shared/contracts/supply-http.ts';
import { SupplySources } from '../../server/suite-supply.ts';
import { services } from './services.ts';

import { services as filesServices } from '../files/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
  const authorize = suiteAuthorize(host),
    meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
  const service = new SupplySources(
    meta('state'),
    meta('uploads'),
    authorize,
    host.optional(filesServices.capture),
  );
  host.provide(services.sources, suiteService(supplyHttpSchemas.sources, service));
  host.onDispose(() => service.close());
}
export const route = suiteRoute('supply-sources', supplyHttpSchemas.sources, services.sources);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(
  Object.keys(supplyHttpSchemas.sources).map((id) => [id, route]),
);
export const responseContracts = Object.fromEntries(
  Object.entries(supplyHttpSchemas.sources).map(([id, { response }]) => [
    id,
    { kind: 'json' as const, statuses: [200], schema: response },
  ]),
);

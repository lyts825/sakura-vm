/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleCatalogs } from '../../server/suite-locale.ts';
import { services } from './services.ts';

import { services as filesServices } from '../files/services.ts';
export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleCatalogs(meta('state'), meta('uploads'), authorize, host.optional(filesServices.capture));
host.provide(services.catalogs, suiteService(localeHttpSchemas.catalogs, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-catalogs', localeHttpSchemas.catalogs, services.catalogs, localeRouteMetadata.catalogs);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.catalogs).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.catalogs).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

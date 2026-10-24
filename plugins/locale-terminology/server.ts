/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleTerminology } from '../../server/suite-locale.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleTerminology(meta('state'), authorize, host.use(catalogsServices.catalogs));
host.provide(services.terminology, suiteService(localeHttpSchemas.terminology, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-terminology', localeHttpSchemas.terminology, services.terminology, localeRouteMetadata.terminology);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.terminology).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.terminology).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

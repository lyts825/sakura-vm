/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleChecks } from '../../server/suite-locale.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';
import { services as translationsServices } from '../locale-translations/services.ts';
import { services as terminologyServices } from '../locale-terminology/services.ts';
import { services as contextsServices } from '../locale-contexts/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleChecks(meta('state'), authorize, host.use(catalogsServices.catalogs), {'locale-catalogs': host.use(catalogsServices.catalogs), 'locale-translations': host.use(translationsServices.translations), 'locale-terminology': host.use(terminologyServices.terminology), 'locale-contexts': host.use(contextsServices.contexts)});
host.provide(services.checks, suiteService(localeHttpSchemas.checks, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-checks', localeHttpSchemas.checks, services.checks, localeRouteMetadata.checks);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.checks).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.checks).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

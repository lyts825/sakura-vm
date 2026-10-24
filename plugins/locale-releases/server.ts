/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleReleases } from '../../server/suite-locale.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';
import { services as translationsServices } from '../locale-translations/services.ts';
import { services as checksServices } from '../locale-checks/services.ts';
import { services as reviewsServices } from '../locale-reviews/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleReleases(meta('state'), authorize, host.use(catalogsServices.catalogs), {'locale-catalogs': host.use(catalogsServices.catalogs), 'locale-translations': host.use(translationsServices.translations), 'locale-checks': host.use(checksServices.checks), 'locale-reviews': host.use(reviewsServices.reviews)}, host.use(reviewsServices.reviews));
host.provide(services.releases, suiteService(localeHttpSchemas.releases, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-releases', localeHttpSchemas.releases, services.releases, localeRouteMetadata.releases);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.releases).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.releases).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

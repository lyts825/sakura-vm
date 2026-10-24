/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleReviews } from '../../server/suite-locale.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';
import { services as checksServices } from '../locale-checks/services.ts';
import { services as previewsServices } from '../locale-previews/services.ts';
import { services as translationsServices } from '../locale-translations/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleReviews(meta('state'), authorize, host.use(catalogsServices.catalogs), {'locale-catalogs': host.use(catalogsServices.catalogs), 'locale-checks': host.use(checksServices.checks), 'locale-previews': host.use(previewsServices.previews), 'locale-translations': host.use(translationsServices.translations)}, host.use(translationsServices.translations));
host.provide(services.reviews, suiteService(localeHttpSchemas.reviews, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-reviews', localeHttpSchemas.reviews, services.reviews, localeRouteMetadata.reviews);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.reviews).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.reviews).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

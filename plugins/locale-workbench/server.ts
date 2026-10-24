/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { LocaleWorkbench } from '../../server/suite-locale.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';
import { services as contextsServices } from '../locale-contexts/services.ts';
import { services as terminologyServices } from '../locale-terminology/services.ts';
import { services as translationsServices } from '../locale-translations/services.ts';
import { services as checksServices } from '../locale-checks/services.ts';
import { services as previewsServices } from '../locale-previews/services.ts';
import { services as reviewsServices } from '../locale-reviews/services.ts';
import { services as releasesServices } from '../locale-releases/services.ts';
import { services as exchangeServices } from '../locale-exchange/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new LocaleWorkbench(meta('state'), authorize, {catalogs: host.use(catalogsServices.catalogs), contexts: host.use(contextsServices.contexts), terminology: host.use(terminologyServices.terminology), translations: host.use(translationsServices.translations), checks: host.use(checksServices.checks), previews: host.use(previewsServices.previews), reviews: host.use(reviewsServices.reviews), releases: host.use(releasesServices.releases), exchange: host.use(exchangeServices.exchange)});
host.provide(services.workbench, suiteService(localeHttpSchemas.workbench, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-workbench', localeHttpSchemas.workbench, services.workbench, localeRouteMetadata.workbench);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.workbench).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.workbench).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

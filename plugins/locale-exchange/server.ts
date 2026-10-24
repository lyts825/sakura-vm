/** 装配本插件拥有的材料与公开业务服务。 */
import type { PluginContext, PluginRoute } from '../../server/plugin-api.ts';
import { suiteAuthorize, suiteRoute, suiteService } from '../../server/suite-http.ts';
import { localeHttpSchemas } from '../../shared/contracts/locale-http.ts';
import { localeRouteMetadata } from '../../shared/contracts/locale-routes.generated.ts';
import { SuiteExchange } from '../../server/suite-exchange.ts';
import { services } from './services.ts';
import { services as catalogsServices } from '../locale-catalogs/services.ts';
import { services as contextsServices } from '../locale-contexts/services.ts';
import { services as terminologyServices } from '../locale-terminology/services.ts';
import { services as translationsServices } from '../locale-translations/services.ts';
import { services as checksServices } from '../locale-checks/services.ts';
import { services as previewsServices } from '../locale-previews/services.ts';
import { services as reviewsServices } from '../locale-reviews/services.ts';
import { services as releasesServices } from '../locale-releases/services.ts';

export { manifest } from './manifest.ts';
export async function activate(host: PluginContext) {
const authorize = suiteAuthorize(host), meta = (name: string) => host.capabilities.metadata.reference(name, () => null);
const service = new SuiteExchange('locale-exchange', meta('state'), meta('bytes'), meta('uploads'), authorize, host.use(catalogsServices.catalogs), {'locale-catalogs': host.use(catalogsServices.catalogs), 'locale-contexts': host.use(contextsServices.contexts), 'locale-terminology': host.use(terminologyServices.terminology), 'locale-translations': host.use(translationsServices.translations), 'locale-checks': host.use(checksServices.checks), 'locale-previews': host.use(previewsServices.previews), 'locale-reviews': host.use(reviewsServices.reviews), 'locale-releases': host.use(releasesServices.releases)}, 'sakura-localization-studio/1', (_domain, _kind, content) => content, { sourceDomain: 'locale-catalogs', receivedName: '接收的本地化档案' });
host.provide(services.exchange, suiteService(localeHttpSchemas.exchange, service));host.onDispose(() => service.close());
}
export const route = suiteRoute('locale-exchange', localeHttpSchemas.exchange, services.exchange, localeRouteMetadata.exchange);
export const httpHandlers: Record<string, PluginRoute> = Object.fromEntries(Object.keys(localeHttpSchemas.exchange).map(id => [id, route]));
export const responseContracts = Object.fromEntries(Object.entries(localeHttpSchemas.exchange).map(([id, {response}]) => [id, {kind: 'json' as const, statuses: [200], schema: response}]));

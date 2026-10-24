/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-exchange', name: '本地化交接', description: '本地化交接：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-contexts'), pin('locale-terminology'), pin('locale-translations'), pin('locale-checks'), pin('locale-previews'), pin('locale-reviews'), pin('locale-releases')], optional: [], services: ['localeExchange'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('exchange'), routes: localeRoutes('exchange') }});

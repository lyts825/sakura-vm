/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-reviews', name: '文案审阅', description: '文案审阅：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-checks'), pin('locale-previews'), pin('locale-translations')], optional: [], services: ['localeReviews'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('reviews'), routes: localeRoutes('reviews') }});

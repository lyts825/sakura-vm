/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-releases', name: '本机语言版本', description: '本机语言版本：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-translations'), pin('locale-checks'), pin('locale-reviews')], optional: [], services: ['localeReleases'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('releases'), routes: localeRoutes('releases') }});

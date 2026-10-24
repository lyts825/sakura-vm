/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-translations', name: '译文与记忆', description: '译文与记忆：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-contexts'), pin('locale-terminology')], optional: [], services: ['localeTranslations'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('translations'), routes: localeRoutes('translations') }});

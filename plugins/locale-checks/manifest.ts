/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-checks', name: '文案质量检查', description: '文案质量检查：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-translations'), pin('locale-terminology'), pin('locale-contexts')], optional: [], services: ['localeChecks'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('checks'), routes: localeRoutes('checks') }});

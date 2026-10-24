/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-previews', name: '固定组件预览', description: '固定组件预览：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-translations'), pin('locale-checks')], optional: [], services: ['localePreviews'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('previews'), routes: localeRoutes('previews') }});

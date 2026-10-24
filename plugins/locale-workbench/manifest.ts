/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-workbench', name: '本地化工作台', description: '本地化工作台：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs'), pin('locale-contexts'), pin('locale-terminology'), pin('locale-translations'), pin('locale-checks'), pin('locale-previews'), pin('locale-reviews'), pin('locale-releases'), pin('locale-exchange')], optional: [], services: ['localeWorkbench'],
contributes: {pages: ['localization-studio'], tabs: [], developmentSections: [], managed: [], http: localeHttp('workbench'), routes: localeRoutes('workbench') }});

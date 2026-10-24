/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-contexts', name: '文案上下文', description: '文案上下文：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [pin('locale-catalogs')], optional: [], services: ['localeContexts'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('contexts'), routes: localeRoutes('contexts') }});

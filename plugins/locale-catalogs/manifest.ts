/** 本地化的独立对象与领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { localeRoutes, localeHttp } from '../../shared/contracts/locale-routes.generated.ts';
export const manifest = definePlugin({ id: 'locale-catalogs', name: '语言目录', description: '语言目录：固定源文、人工编辑与可核对的语言交付。', category: 'development', experimental: true,
requires: [], optional: [pin('files')], services: ['localeCatalogs'],
contributes: { tabs: [], developmentSections: [], managed: [], http: localeHttp('catalogs'), routes: localeRoutes('catalogs') }});

/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-routes',
  name: '应用入口',
  description: '应用入口及可核验的运行记录。',
  category: 'operations',
  requires: [pin('app-targets'), pin('app-observe'), pin('network')],
  services: ['appRoutes'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-routes'],
    http: [http('/api/app-routes', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-routes'),
  },
});

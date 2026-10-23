/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-data',
  name: '应用持久数据',
  description: '应用持久数据及可核验的运行记录。',
  category: 'operations',
  requires: [pin('app-targets'), pin('projects')],
  services: ['appData'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-data'],
    http: [http('/api/app-data', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-data'),
  },
});

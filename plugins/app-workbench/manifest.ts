/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-workbench',
  name: '应用运行工作台',
  description: '应用运行工作台及可核验的运行记录。',
  category: 'operations',
  requires: [
    pin('app-targets'),
    pin('app-packages'),
    pin('app-config'),
    pin('app-data'),
    pin('app-observe'),
    pin('app-routes'),
    pin('app-recovery'),
    pin('app-deploy'),
  ],
  services: ['appWorkbench'],
  contributes: {
    pages: ['app-runtime'],
    tabs: ['development'],
    developmentSections: ['app-workbench'],
    http: [http('/api/app-workbench', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-workbench'),
  },
});

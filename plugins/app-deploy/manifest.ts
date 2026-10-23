/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-deploy',
  name: '应用安装变更',
  description: '应用安装变更及可核验的运行记录。',
  category: 'operations',
  requires: [
    pin('app-targets'),
    pin('app-packages'),
    pin('app-config'),
    pin('app-data'),
    pin('app-observe'),
    pin('app-routes'),
    pin('app-recovery'),
    pin('projects'),
  ],
  services: ['appDeploy'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-deploy'],
    managed: ['jobs', 'job-retry'],
    http: [http('/api/app-deploy', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-deploy'),
  },
});

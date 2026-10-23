/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-targets',
  name: '应用运行目标',
  description: '应用运行目标及可核验的运行记录。',
  category: 'operations',
  requires: [pin('projects')],
  systemDependencies: ['imageAssets', 'egressRules'],
  services: ['appTargets'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-targets'],
    managed: ['jobs', 'job-retry'],
    http: [http('/api/app-targets', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-targets'),
  },
});

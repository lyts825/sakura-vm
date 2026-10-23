/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-observe',
  name: '应用观测',
  description: '应用观测及可核验的运行记录。',
  category: 'operations',
  requires: [pin('app-targets'), pin('projects'), pin('service-health')],
  services: ['appObserve'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-observe'],
    managed: ['jobs', 'schedule'],
    http: [http('/api/app-observe', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-observe'),
  },
});

/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-recovery',
  name: '应用冷备恢复',
  description: '应用冷备恢复及可核验的运行记录。',
  category: 'operations',
  requires: [pin('app-targets'), pin('app-routes'), pin('app-data'), pin('projects'), pin('backups')],
  services: ['appRecovery'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-recovery'],
    managed: ['jobs', 'job-retry', 'schedule'],
    http: [http('/api/app-recovery', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-recovery'),
  },
});

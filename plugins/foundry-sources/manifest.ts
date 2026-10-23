/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-sources',
  name: '镜像来源',
  description: '镜像来源的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundrySources'],
  requires: [],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-sources'],
    http: [http('/api/foundry-sources', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-sources'),
  },
});

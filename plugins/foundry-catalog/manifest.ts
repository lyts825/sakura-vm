/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-catalog',
  name: '环境镜像库',
  description: '环境镜像库的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryCatalog'],
  requires: [
    pin('foundry-sources'),
    pin('foundry-builders'),
    pin('foundry-sanitizers'),
    pin('foundry-checks'),
  ],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-catalog'],
    http: [http('/api/foundry-catalog', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-catalog'),
  },
});

/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-blueprints',
  name: '环境蓝图',
  description: '环境蓝图的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryBlueprints'],
  requires: [pin('foundry-sources')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-blueprints'],
    http: [http('/api/foundry-blueprints', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-blueprints'),
  },
});

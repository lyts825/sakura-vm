/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-builders',
  name: '镜像制作',
  description: '镜像制作的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryBuilders'],
  requires: [pin('foundry-sources'), pin('foundry-blueprints'), pin('foundry-depot')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-builders'],
    http: [http('/api/foundry-builders', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-builders'),
  },
});

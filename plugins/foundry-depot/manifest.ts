/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-depot',
  name: '离线材料',
  description: '离线材料的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryDepot'],
  requires: [pin('foundry-sources'), pin('foundry-blueprints')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-depot'],
    http: [http('/api/foundry-depot', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-depot'),
  },
});

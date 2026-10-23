/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-sanitizers',
  name: '身份清理',
  description: '身份清理的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundrySanitizers'],
  requires: [pin('foundry-builders')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-sanitizers'],
    http: [http('/api/foundry-sanitizers', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-sanitizers'),
  },
});

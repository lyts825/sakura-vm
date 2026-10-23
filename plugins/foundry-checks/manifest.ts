/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-checks',
  name: '镜像验收',
  description: '镜像验收的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryChecks'],
  requires: [pin('foundry-sanitizers')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-checks'],
    http: [http('/api/foundry-checks', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-checks'),
  },
});

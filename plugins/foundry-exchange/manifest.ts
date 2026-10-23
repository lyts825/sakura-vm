/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-exchange',
  name: '镜像交接',
  description: '镜像交接的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryExchange'],
  requires: [pin('foundry-sources'), pin('foundry-catalog'), pin('foundry-checks')],
  contributes: {
    managed: ['jobs', 'job-retry'],
    tabs: ['development'],
    developmentSections: ['foundry-exchange'],
    http: [http('/api/foundry-exchange', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-exchange'),
  },
});

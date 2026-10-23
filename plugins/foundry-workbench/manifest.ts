/** 工坊模块准入和生命周期声明。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'foundry-workbench',
  name: '镜像工坊',
  description: '镜像工坊的独立计划、固定记录、执行和恢复。',
  category: 'development',
  systemDependencies: ['imageAssets'],
  services: ['foundryWorkbench'],
  requires: [
    pin('foundry-sources'),
    pin('foundry-blueprints'),
    pin('foundry-depot'),
    pin('foundry-builders'),
    pin('foundry-sanitizers'),
    pin('foundry-checks'),
    pin('foundry-catalog'),
    pin('foundry-exchange'),
  ],
  contributes: {
    managed: ['jobs', 'job-retry'],
    pages: ['foundry'],
    tabs: ['development'],
    developmentSections: ['foundry-workbench'],
    http: [http('/api/foundry-workbench', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/foundry-workbench'),
  },
});

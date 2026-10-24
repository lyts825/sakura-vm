/** 隔离运行：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-runners',
  name: '隔离运行',
  description: '隔离运行，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [
    pin('integration-specs'),
    pin('integration-scenarios'),
    pin('integration-mocks'),
    pin('integration-environments'),
    pin('integration-fixtures'),
    pin('integration-assertions'),
    pin('projects'),
  ],
  services: ['integrationRunners'],
  systemDependencies: ['imageAssets', 'egressRules', 'preparedWorkerSessions'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-runners'],
    http: [http('/api/integration-runners', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-runners'),
    managed: ['jobs', 'job-retry'],
  },
});

/** 模拟有限负载：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-load',
  name: '模拟有限负载',
  description: '模拟有限负载，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [
    pin('integration-specs'),
    pin('integration-runners'),
    pin('integration-scenarios'),
    pin('integration-environments'),
  ],
  services: ['integrationLoad'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-load'],
    http: [http('/api/integration-load', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-load'),
  },
});

/** 固定样例：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-fixtures',
  name: '固定样例',
  description: '固定样例，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [pin('integration-specs')],
  services: ['integrationFixtures'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-fixtures'],
    http: [http('/api/integration-fixtures', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-fixtures'),
  },
});

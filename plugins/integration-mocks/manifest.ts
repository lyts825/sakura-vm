/** 有限状态模拟：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-mocks',
  name: '有限状态模拟',
  description: '有限状态模拟，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [pin('integration-specs'), pin('integration-fixtures')],
  services: ['integrationMocks'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-mocks'],
    http: [http('/api/integration-mocks', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-mocks'),
  },
});

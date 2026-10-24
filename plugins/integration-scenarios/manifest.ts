/** 请求场景：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-scenarios',
  name: '请求场景',
  description: '请求场景，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [pin('integration-specs'), pin('integration-fixtures'), pin('integration-environments')],
  services: ['integrationScenarios'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-scenarios'],
    http: [http('/api/integration-scenarios', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-scenarios'),
  },
});

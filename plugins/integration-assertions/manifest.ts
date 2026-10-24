/** 响应断言：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-assertions',
  name: '响应断言',
  description: '响应断言，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [pin('integration-specs'), pin('integration-scenarios')],
  services: ['integrationAssertions'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-assertions'],
    http: [http('/api/integration-assertions', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-assertions'),
  },
});

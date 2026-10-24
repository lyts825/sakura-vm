/** 测试环境：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-environments',
  name: '测试环境',
  description: '测试环境，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [pin('integration-specs'), pin('secrets')],
  optional: [pin('app-targets')],
  services: ['integrationEnvironments'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-environments'],
    http: [http('/api/integration-environments', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-environments'),
  },
});

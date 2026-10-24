/** 验证报告：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-reports',
  name: '验证报告',
  description: '验证报告，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [
    pin('integration-specs'),
    pin('integration-assertions'),
    pin('integration-load'),
    pin('integration-runners'),
  ],
  services: ['integrationReports'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-reports'],
    http: [http('/api/integration-reports', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-reports'),
  },
});

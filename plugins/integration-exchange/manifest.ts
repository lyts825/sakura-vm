/** 离线交接：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-exchange',
  name: '离线交接',
  description: '离线交接，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [
    pin('integration-specs'),
    pin('integration-environments'),
    pin('integration-fixtures'),
    pin('integration-mocks'),
    pin('integration-scenarios'),
    pin('integration-assertions'),
    pin('integration-reports'),
  ],
  services: ['integrationExchange'],

  contributes: {
    tabs: ['development'],
    developmentSections: ['integration-exchange'],
    http: [http('/api/integration-exchange', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-exchange'),
  },
});

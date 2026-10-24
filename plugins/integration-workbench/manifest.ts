/** 接口集成工作台：声明直接依赖和 owner 操作。 Explicit domain dependencies and owner routes. */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'integration-workbench',
  name: '接口集成工作台',
  description: '接口集成工作台，固定输入、授权和独立审计记录。',
  category: 'development',
  requires: [
    pin('integration-specs'),
    pin('integration-environments'),
    pin('integration-fixtures'),
    pin('integration-mocks'),
    pin('integration-scenarios'),
    pin('integration-runners'),
    pin('integration-assertions'),
    pin('integration-load'),
    pin('integration-reports'),
    pin('integration-exchange'),
  ],
  services: ['integrationWorkbench'],

  contributes: {
    tabs: [],
    pages: ['integration-lab'],
    developmentSections: [],
    http: [http('/api/integration-workbench', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/integration-workbench'),
  },
});

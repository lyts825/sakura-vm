import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { flowRoutes, flowHttp } from '../../shared/contracts/flow-routes.generated.ts';
export const manifest = definePlugin({
  id: 'flow-connectors',
  name: '原服务连接',
  description: '固定流程图、具体阶段批准、原提供者回执及不可执行的历史交接。',
  category: 'development',
  experimental: true,
  requires: [pin('flow-definitions')],
  optional: [pin('integration-runners'), pin('knowledge-publish')],
  systemDependencies: ['delegatedActions'],
  services: ['flowConnectors'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: flowHttp('connectors'),
    routes: flowRoutes('connectors'),
  },
});

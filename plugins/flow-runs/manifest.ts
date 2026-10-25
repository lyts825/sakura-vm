import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { flowRoutes, flowHttp } from '../../shared/contracts/flow-routes.generated.ts';
export const manifest = definePlugin({
  id: 'flow-runs',
  name: '流程运行',
  description: '固定流程图、具体阶段批准、原提供者回执及不可执行的历史交接。',
  category: 'development',
  experimental: true,
  requires: [
    pin('flow-definitions'),
    pin('flow-inputs'),
    pin('flow-plans'),
    pin('flow-approvals'),
    pin('flow-connectors'),
    pin('flow-journal'),
  ],
  optional: [],
  services: ['flowRuns'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: flowHttp('runs'),
    routes: flowRoutes('runs'),
  },
});

import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { flowRoutes, flowHttp } from '../../shared/contracts/flow-routes.generated.ts';
export const manifest = definePlugin({
  id: 'flow-exchange',
  name: '流程交接',
  description: '固定流程图、具体阶段批准、原提供者回执及不可执行的历史交接。',
  category: 'development',
  experimental: true,
  requires: [
    pin('flow-definitions'),
    pin('flow-inputs'),
    pin('flow-connectors'),
    pin('flow-plans'),
    pin('flow-approvals'),
    pin('flow-journal'),
    pin('flow-runs'),
    pin('flow-timers'),
  ],
  optional: [],
  services: ['flowExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: flowHttp('exchange'),
    routes: flowRoutes('exchange'),
  },
});

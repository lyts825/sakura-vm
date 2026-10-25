import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { flowRoutes, flowHttp } from '../../shared/contracts/flow-routes.generated.ts';
export const manifest = definePlugin({
  id: 'flow-workbench',
  name: '流程工作台',
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
    pin('flow-exchange'),
  ],
  optional: [],
  services: ['flowWorkbench'],
  contributes: {
    pages: ['flow-studio'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: flowHttp('workbench'),
    routes: flowRoutes('workbench'),
  },
});

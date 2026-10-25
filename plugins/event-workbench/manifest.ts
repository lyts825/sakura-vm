import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-workbench',
  name: '事件与队列工作台',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [
    pin('event-contracts'),
    pin('event-fixtures'),
    pin('event-producers'),
    pin('event-consumers'),
    pin('event-scenarios'),
    pin('event-brokers'),
    pin('event-runs'),
    pin('event-assertions'),
    pin('event-reports'),
    pin('event-exchange'),
  ],
  optional: [],
  services: ['eventWorkbench'],
  systemDependencies: [],
  contributes: {
    pages: ['event-lab'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('workbench'),
    routes: eventRoutes('workbench'),
  },
});

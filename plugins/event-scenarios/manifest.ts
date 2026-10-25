import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-scenarios',
  name: '事件场景',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [pin('event-contracts'), pin('event-fixtures'), pin('event-producers'), pin('event-consumers')],
  optional: [],
  services: ['eventScenarios'],
  systemDependencies: [],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('scenarios'),
    routes: eventRoutes('scenarios'),
  },
});

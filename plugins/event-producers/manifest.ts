import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-producers',
  name: '固定生产计划',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [pin('event-contracts'), pin('event-fixtures')],
  optional: [],
  services: ['eventProducers'],
  systemDependencies: [],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('producers'),
    routes: eventRoutes('producers'),
  },
});

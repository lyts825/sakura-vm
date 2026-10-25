import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-consumers',
  name: '消费与幂等策略',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [pin('event-contracts')],
  optional: [],
  services: ['eventConsumers'],
  systemDependencies: [],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('consumers'),
    routes: eventRoutes('consumers'),
  },
});

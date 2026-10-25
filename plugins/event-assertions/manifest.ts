import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-assertions',
  name: '消息语义断言',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [pin('event-contracts'), pin('event-runs'), pin('event-brokers'), pin('event-scenarios')],
  optional: [],
  services: ['eventAssertions'],
  systemDependencies: [],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('assertions'),
    routes: eventRoutes('assertions'),
  },
});

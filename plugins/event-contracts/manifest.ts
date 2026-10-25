import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { eventRoutes, eventHttp } from '../../shared/contracts/event-routes.generated.ts';
export const manifest = definePlugin({
  id: 'event-contracts',
  name: '事件模式与材料',
  description: '固定消息、隔离测试代理、原始投递轨迹与可重算结果。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [],
  services: ['eventContracts'],
  systemDependencies: ['imageAssets'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: eventHttp('contracts'),
    routes: eventRoutes('contracts'),
  },
});

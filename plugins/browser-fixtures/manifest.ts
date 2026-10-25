import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-fixtures',
  name: '合成会话数据',
  description: '合成会话数据，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [pin('browser-targets')],
  optional: [],
  services: ['browserFixtures'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('fixtures'),
    routes: browserRoutes('fixtures'),
  },
});

import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-assertions',
  name: '浏览器断言',
  description: '浏览器断言，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [pin('browser-targets'), pin('browser-journeys'), pin('browser-runners')],
  optional: [],
  services: ['browserAssertions'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('assertions'),
    routes: browserRoutes('assertions'),
  },
});

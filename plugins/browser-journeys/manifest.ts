import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-journeys',
  name: '浏览器旅程',
  description: '浏览器旅程，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [pin('browser-targets'), pin('browser-fixtures')],
  optional: [],
  services: ['browserJourneys'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('journeys'),
    routes: browserRoutes('journeys'),
  },
});

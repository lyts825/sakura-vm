import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-reports',
  name: '浏览器验收报告',
  description: '浏览器验收报告，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [
    pin('browser-targets'),
    pin('browser-journeys'),
    pin('browser-runners'),
    pin('browser-assertions'),
    pin('browser-visual'),
    pin('browser-accessibility'),
  ],
  optional: [],
  services: ['browserReports'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('reports'),
    routes: browserRoutes('reports'),
  },
});

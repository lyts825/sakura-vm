import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-exchange',
  name: '浏览器交接',
  description: '浏览器交接，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [
    pin('browser-targets'),
    pin('browser-fixtures'),
    pin('browser-journeys'),
    pin('browser-runners'),
    pin('browser-assertions'),
    pin('browser-visual'),
    pin('browser-accessibility'),
    pin('browser-reports'),
  ],
  optional: [],
  services: ['browserExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('exchange'),
    routes: browserRoutes('exchange'),
  },
});

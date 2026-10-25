import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-workbench',
  name: '浏览器验收工作台',
  description: '浏览器验收工作台，固定输入修订、实际运行证据与独立权限。',
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
    pin('browser-exchange'),
  ],
  optional: [],
  services: ['browserWorkbench'],
  contributes: {
    pages: ['browser-lab'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('workbench'),
    routes: browserRoutes('workbench'),
  },
});

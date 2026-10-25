import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-runners',
  name: '浏览器运行',
  description: '浏览器运行，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [pin('browser-targets'), pin('browser-fixtures'), pin('browser-journeys'), pin('browser-visual')],
  optional: [],
  systemDependencies: ['browserSessions'],
  services: ['browserRunners'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('runners'),
    routes: browserRoutes('runners'),
  },
});

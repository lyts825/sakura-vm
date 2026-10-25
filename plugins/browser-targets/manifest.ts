import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-targets',
  name: '浏览器目标',
  description: '浏览器目标，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [],
  systemDependencies: ['imageAssets'],
  services: ['browserTargets'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('targets'),
    routes: browserRoutes('targets'),
  },
});

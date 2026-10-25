import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { browserRoutes, browserHttp } from '../../shared/contracts/browser-routes.generated.ts';
export const manifest = definePlugin({
  id: 'browser-visual',
  name: '视觉基线',
  description: '视觉基线，固定输入修订、实际运行证据与独立权限。',
  category: 'development',
  experimental: true,
  requires: [pin('browser-targets'), pin('browser-journeys')],
  optional: [pin('browser-runners')],
  services: ['browserVisual'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: browserHttp('visual'),
    routes: browserRoutes('visual'),
  },
});

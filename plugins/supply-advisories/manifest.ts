/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-http.ts';
export const manifest = definePlugin({
  id: 'supply-advisories',
  name: '公告与匹配',
  description: '公告与匹配：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-sources'), pin('supply-inventory')],
  optional: [],
  services: ['supplyAdvisories'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('advisories'),
    routes: supplyRoutes('advisories'),
  },
});

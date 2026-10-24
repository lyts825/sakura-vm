/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-http.ts';
export const manifest = definePlugin({
  id: 'supply-reports',
  name: '审查报告',
  description: '审查报告：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-sources'), pin('supply-inventory'), pin('supply-policies'), pin('supply-reviews')],
  optional: [],
  services: ['supplyReports'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('reports'),
    routes: supplyRoutes('reports'),
  },
});

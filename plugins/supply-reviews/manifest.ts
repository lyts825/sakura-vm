/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-reviews',
  name: '审阅与例外',
  description: '审阅与例外：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-sources'), pin('supply-policies')],
  optional: [],
  services: ['supplyReviews'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('reviews'),
    routes: supplyRoutes('reviews'),
  },
});

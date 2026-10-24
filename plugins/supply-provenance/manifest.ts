/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-provenance',
  name: '来源与信任',
  description: '来源与信任：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-inventory'), pin('supply-sources')],
  optional: [pin('delivery-releases')],
  services: ['supplyProvenance'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('provenance'),
    routes: supplyRoutes('provenance'),
  },
});

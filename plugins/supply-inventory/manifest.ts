/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-http.ts';
export const manifest = definePlugin({
  id: 'supply-inventory',
  name: '依赖清单',
  description: '依赖清单：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-sources')],
  optional: [],
  services: ['supplyInventory'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('inventory'),
    routes: supplyRoutes('inventory'),
  },
});

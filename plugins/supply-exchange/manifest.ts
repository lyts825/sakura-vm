/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-http.ts';
export const manifest = definePlugin({
  id: 'supply-exchange',
  name: '离线交接',
  description: '离线交接：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [
    pin('supply-sources'),
    pin('supply-inventory'),
    pin('supply-advisories'),
    pin('supply-licenses'),
    pin('supply-provenance'),
    pin('supply-policies'),
    pin('supply-reviews'),
    pin('supply-reports'),
  ],
  optional: [],
  services: ['supplyExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('exchange'),
    routes: supplyRoutes('exchange'),
  },
});

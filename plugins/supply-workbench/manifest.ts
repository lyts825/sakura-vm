/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-workbench',
  name: '供应审查工作台',
  description: '供应审查工作台：固定输入、明确判定与来源保护。',
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
    pin('supply-exchange'),
  ],
  optional: [],
  services: ['supplyWorkbench'],
  contributes: {
    pages: ['supply-audit'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('workbench'),
    routes: supplyRoutes('workbench'),
  },
});

/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-licenses',
  name: '许可证声明',
  description: '许可证声明：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [pin('supply-inventory'), pin('supply-sources')],
  optional: [],
  services: ['supplyLicenses'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('licenses'),
    routes: supplyRoutes('licenses'),
  },
});

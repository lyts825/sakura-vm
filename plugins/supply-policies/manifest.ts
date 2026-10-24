/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-policies',
  name: '审查门槛',
  description: '审查门槛：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [
    pin('supply-sources'),
    pin('supply-inventory'),
    pin('supply-advisories'),
    pin('supply-licenses'),
    pin('supply-provenance'),
  ],
  optional: [],
  services: ['supplyPolicies'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('policies'),
    routes: supplyRoutes('policies'),
  },
});

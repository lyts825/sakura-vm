/** 软件供应审查独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { supplyRoutes, supplyHttp } from '../../shared/contracts/supply-routes.generated.ts';
export const manifest = definePlugin({
  id: 'supply-sources',
  name: '材料与许可',
  description: '材料与许可：固定输入、明确判定与来源保护。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [pin('files')],
  services: ['supplySources'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: supplyHttp('sources'),
    routes: supplyRoutes('sources'),
  },
});

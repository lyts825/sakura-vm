/** 事件案例的独立领域入口。 */
import { definePlugin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-cases',
  name: '事件案例',
  description: '固定事件范围、影响与开闭状态，集中管理案例工作区。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [],
  services: ['incidentCases'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('cases'),
    routes: incidentRoutes('cases'),
  },
});

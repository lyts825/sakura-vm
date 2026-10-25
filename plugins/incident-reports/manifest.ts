/** 事件复盘报告的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-reports',
  name: '事件复盘报告',
  description: '依据有效审阅编写、比较并封存复盘报告，保留来源保护链。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases'), pin('incident-reviews')],
  optional: [],
  services: ['incidentReports'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('reports'),
    routes: incidentRoutes('reports'),
  },
});

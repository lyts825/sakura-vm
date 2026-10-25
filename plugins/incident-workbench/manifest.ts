/** 事件复盘工作台的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-workbench',
  name: '事件复盘工作台',
  description: '集中查看案例、证据、时间线、处置与审阅交付，保持领域权限与有界读取。',
  category: 'development',
  experimental: true,
  requires: [
    pin('incident-cases'),
    pin('incident-evidence'),
    pin('incident-timeline'),
    pin('incident-hypotheses'),
    pin('incident-runbooks'),
    pin('incident-actions'),
    pin('incident-reviews'),
    pin('incident-reports'),
    pin('incident-exchange'),
  ],
  optional: [],
  services: ['incidentWorkbench'],
  contributes: {
    pages: ['incident-desk'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('workbench'),
    routes: incidentRoutes('workbench'),
  },
});

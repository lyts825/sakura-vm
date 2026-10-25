/** 事件复盘交接的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-exchange',
  name: '事件复盘交接',
  description: '交接经过人审的脱敏报告与材料，离线核对完整性并隔离接收。',
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
  ],
  optional: [],
  services: ['incidentExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('exchange'),
    routes: incidentRoutes('exchange'),
  },
});

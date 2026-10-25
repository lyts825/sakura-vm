/** 事件时间线的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-timeline',
  name: '事件时间线',
  description: '从固定证据形成有界时间窗口，保留时钟说明与跨来源顺序的不确定性。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases'), pin('incident-evidence')],
  optional: [],
  services: ['incidentTimeline'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('timeline'),
    routes: incidentRoutes('timeline'),
  },
});

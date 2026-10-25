/** 事件复盘审阅的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-reviews',
  name: '事件复盘审阅',
  description: '审阅明确的固定证据和动作窗口，分开呈现事实、推断与未决事项。',
  category: 'development',
  experimental: true,
  requires: [
    pin('incident-cases'),
    pin('incident-evidence'),
    pin('incident-timeline'),
    pin('incident-hypotheses'),
    pin('incident-actions'),
  ],
  optional: [],
  services: ['incidentReviews'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('reviews'),
    routes: incidentRoutes('reviews'),
  },
});

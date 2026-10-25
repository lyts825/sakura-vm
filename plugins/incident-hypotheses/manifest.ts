/** 事件假设的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-hypotheses',
  name: '事件假设',
  description: '记录人工解释、支持与相反依据，并保留未解决问题。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases'), pin('incident-timeline'), pin('incident-evidence')],
  optional: [],
  services: ['incidentHypotheses'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('hypotheses'),
    routes: incidentRoutes('hypotheses'),
  },
});

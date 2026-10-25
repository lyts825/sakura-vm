/** 事件处置手册的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-runbooks',
  name: '事件处置手册',
  description: '编排固定人工步骤及经原提供者批准的一次性委派动作。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases')],
  optional: [],
  services: ['incidentRunbooks'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('runbooks'),
    routes: incidentRoutes('runbooks'),
  },
});

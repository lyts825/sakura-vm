/** 事件处置的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-actions',
  name: '事件处置',
  description: '通过原提供者执行批准动作，保留一次性票据、未知回执与人工核对记录。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases'), pin('incident-evidence'), pin('incident-runbooks')],
  optional: [pin('maintenance'), pin('resilience-runs')],
  systemDependencies: ['delegatedActions'],
  services: ['incidentActions'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('actions'),
    routes: incidentRoutes('actions'),
  },
});

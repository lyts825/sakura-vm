/** 事件证据的独立领域入口。 */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { incidentRoutes, incidentHttp } from '../../shared/contracts/incident-routes.generated.ts';
export const manifest = definePlugin({
  id: 'incident-evidence',
  name: '事件证据',
  description: '保留来源字节、采样快照、固定材料和经过人工审阅的脱敏副本。',
  category: 'development',
  experimental: true,
  requires: [pin('incident-cases')],
  optional: [pin('metrics'), pin('service-health')],
  services: ['incidentEvidence'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: incidentHttp('evidence'),
    routes: incidentRoutes('evidence'),
  },
});

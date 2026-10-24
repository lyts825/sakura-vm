/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-sources',
  name: '材料与许可',
  description: '材料与许可：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [pin('projects'), pin('files')],
  optional: [pin('project-search'), pin('delivery-artifacts')],
  services: ['knowledgeSources'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('sources'),
    routes: knowledgeRoutes('sources'),
  },
});

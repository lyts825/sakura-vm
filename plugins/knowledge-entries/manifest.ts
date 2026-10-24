/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-entries',
  name: '知识条目',
  description: '知识条目：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [pin('knowledge-sources'), pin('knowledge-index'), pin('knowledge-evidence')],
  optional: [],
  services: ['knowledgeEntries'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('entries'),
    routes: knowledgeRoutes('entries'),
  },
});

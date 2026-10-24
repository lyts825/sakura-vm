/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-index',
  name: '固定索引',
  description: '固定索引：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [pin('knowledge-sources'), pin('knowledge-extract')],
  optional: [],
  services: ['knowledgeIndex'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('index'),
    routes: knowledgeRoutes('index'),
  },
});

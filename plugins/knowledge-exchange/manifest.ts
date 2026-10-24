/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-exchange',
  name: '离线交接',
  description: '离线交接：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [
    pin('knowledge-sources'),
    pin('knowledge-extract'),
    pin('knowledge-evidence'),
    pin('knowledge-entries'),
    pin('knowledge-documents'),
    pin('knowledge-reviews'),
  ],
  optional: [],
  services: ['knowledgeExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('exchange'),
    routes: knowledgeRoutes('exchange'),
  },
});

/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-workbench',
  name: '知识工作台',
  description: '知识工作台：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [
    pin('knowledge-sources'),
    pin('knowledge-extract'),
    pin('knowledge-index'),
    pin('knowledge-evidence'),
    pin('knowledge-entries'),
    pin('knowledge-documents'),
    pin('knowledge-reviews'),
    pin('knowledge-publish'),
    pin('knowledge-exchange'),
  ],
  optional: [],
  services: ['knowledgeWorkbench'],
  contributes: {
    tabs: [],
    pages: ['knowledge-studio'],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('workbench'),
    routes: knowledgeRoutes('workbench'),
  },
});

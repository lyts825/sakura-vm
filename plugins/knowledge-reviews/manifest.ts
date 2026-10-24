/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-reviews',
  name: '人工审阅',
  description: '人工审阅：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [
    pin('knowledge-sources'),
    pin('knowledge-evidence'),
    pin('knowledge-entries'),
    pin('knowledge-documents'),
  ],
  optional: [],
  services: ['knowledgeReviews'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('reviews'),
    routes: knowledgeRoutes('reviews'),
  },
});

/** 所有者领域入口及固定依赖。 Explicit owner routes and pinned dependencies. */
import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { knowledgeRoutes, knowledgeHttp } from '../../shared/contracts/knowledge-http.ts';
export const manifest = definePlugin({
  id: 'knowledge-publish',
  name: '本机阅读',
  description: '本机阅读：固定修订、当前许可和独立恢复。',
  category: 'development',
  requires: [
    pin('knowledge-sources'),
    pin('knowledge-evidence'),
    pin('knowledge-entries'),
    pin('knowledge-documents'),
    pin('knowledge-reviews'),
  ],
  optional: [],
  services: ['knowledgePublish', 'knowledgeActions'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: ['jobs'],
    http: knowledgeHttp('publish'),
    routes: knowledgeRoutes('publish'),
  },
});

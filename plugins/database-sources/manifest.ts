import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-sources',
  name: '数据库材料',
  description: '固定输入、声明式变更、原工具回执与完整数据恢复证明。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [],
  services: ['databaseSources'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('sources'),
    routes: databaseRoutes('sources'),
  },
});

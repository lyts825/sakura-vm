import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-reports',
  name: '演练报告',
  description: '固定输入、声明式变更、原工具回执与完整数据恢复证明。',
  category: 'development',
  experimental: true,
  requires: [
    pin('database-sources'),
    pin('database-runners'),
    pin('database-checks'),
    pin('database-rehearsals'),
  ],
  optional: [],
  services: ['databaseReports'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('reports'),
    routes: databaseRoutes('reports'),
  },
});

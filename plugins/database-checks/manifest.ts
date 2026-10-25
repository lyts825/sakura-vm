import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-checks',
  name: '完整数据检查',
  description: '固定输入、声明式变更、原工具回执与完整数据恢复证明。',
  category: 'development',
  experimental: true,
  requires: [
    pin('database-sources'),
    pin('database-runners'),
    pin('database-fixtures'),
    pin('database-changes'),
  ],
  optional: [],
  services: ['databaseChecks'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('checks'),
    routes: databaseRoutes('checks'),
  },
});

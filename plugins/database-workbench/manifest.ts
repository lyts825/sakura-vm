import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-workbench',
  name: '数据库演进工作台',
  description: '固定输入、声明式变更、原工具回执与完整数据恢复证明。',
  category: 'development',
  experimental: true,
  requires: [
    pin('database-sources'),
    pin('database-schemas'),
    pin('database-changes'),
    pin('database-fixtures'),
    pin('database-runners'),
    pin('database-checks'),
    pin('database-rehearsals'),
    pin('database-reports'),
    pin('database-exchange'),
  ],
  optional: [],
  services: ['databaseWorkbench'],
  contributes: {
    pages: ['database-evolution'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('workbench'),
    routes: databaseRoutes('workbench'),
  },
});

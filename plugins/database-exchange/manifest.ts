import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-exchange',
  name: '数据库交接',
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
  ],
  optional: [],
  services: ['databaseExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('exchange'),
    routes: databaseRoutes('exchange'),
  },
});

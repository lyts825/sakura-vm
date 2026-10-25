import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { databaseRoutes, databaseHttp } from '../../shared/contracts/database-routes.generated.ts';
export const manifest = definePlugin({
  id: 'database-fixtures',
  name: '独立数据库副本',
  description: '固定输入、声明式变更、原工具回执与完整数据恢复证明。',
  category: 'development',
  experimental: true,
  requires: [pin('database-sources'), pin('database-changes'), pin('projects')],
  optional: [],
  services: ['databaseFixtures'],
  systemDependencies: ['databaseRehearsal'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: databaseHttp('fixtures'),
    routes: databaseRoutes('fixtures'),
  },
});

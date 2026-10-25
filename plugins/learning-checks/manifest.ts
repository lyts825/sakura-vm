import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-checks',
  name: '课内检查',
  description: '课内检查，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-lessons')],
  optional: [],
  systemDependencies: [],
  services: ['learningChecks'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('checks'),
    routes: learningRoutes('checks'),
  },
});

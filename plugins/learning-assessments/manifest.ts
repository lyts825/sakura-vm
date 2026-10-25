import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-assessments',
  name: '自学评估',
  description: '自学评估，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-sessions'), pin('learning-checks')],
  optional: [],
  systemDependencies: [],
  services: ['learningAssessments'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('assessments'),
    routes: learningRoutes('assessments'),
  },
});

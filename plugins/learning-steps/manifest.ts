import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-steps',
  name: '固定学习动作',
  description: '固定学习动作，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-lessons'), pin('learning-assets')],
  optional: [],
  systemDependencies: [],
  services: ['learningSteps'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('steps'),
    routes: learningRoutes('steps'),
  },
});

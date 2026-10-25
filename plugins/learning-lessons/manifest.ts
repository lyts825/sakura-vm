import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-lessons',
  name: '课节与目标',
  description: '课节与目标，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-assets')],
  optional: [],
  systemDependencies: [],
  services: ['learningLessons'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('lessons'),
    routes: learningRoutes('lessons'),
  },
});

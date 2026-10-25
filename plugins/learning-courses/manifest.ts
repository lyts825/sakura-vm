import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-courses',
  name: '课程与顺序',
  description: '课程与顺序，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [],
  optional: [pin('learning-lessons')],
  systemDependencies: [],
  services: ['learningCourses'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('courses'),
    routes: learningRoutes('courses'),
  },
});

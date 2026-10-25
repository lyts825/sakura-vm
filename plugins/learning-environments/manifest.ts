import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-environments',
  name: '环境与检查点',
  description: '环境与检查点，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-assets'), pin('learning-lessons')],
  optional: [pin('learning-sessions')],
  systemDependencies: [],
  services: ['learningEnvironments'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('environments'),
    routes: learningRoutes('environments'),
  },
});

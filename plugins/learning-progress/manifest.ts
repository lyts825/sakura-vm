import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-progress',
  name: '学习进度',
  description: '学习进度，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses'), pin('learning-sessions')],
  optional: [],
  systemDependencies: [],
  services: ['learningProgress'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('progress'),
    routes: learningRoutes('progress'),
  },
});

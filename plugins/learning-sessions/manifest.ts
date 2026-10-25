import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-sessions',
  name: '真实学习会话',
  description: '真实学习会话，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [
    pin('learning-courses'),
    pin('learning-environments'),
    pin('learning-steps'),
    pin('learning-checks'),
    pin('learning-lessons'),
    pin('learning-assets'),
  ],
  optional: [],
  systemDependencies: ['learningToolSessions'],
  services: ['learningSessions'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('sessions'),
    routes: learningRoutes('sessions'),
  },
});

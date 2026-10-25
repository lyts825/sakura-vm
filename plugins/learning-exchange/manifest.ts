import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-exchange',
  name: '学习资料交接',
  description: '学习资料交接，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [
    pin('learning-courses'),
    pin('learning-assets'),
    pin('learning-lessons'),
    pin('learning-environments'),
    pin('learning-steps'),
    pin('learning-checks'),
    pin('learning-sessions'),
    pin('learning-progress'),
    pin('learning-assessments'),
  ],
  optional: [],
  systemDependencies: [],
  services: ['learningExchange'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('exchange'),
    routes: learningRoutes('exchange'),
  },
});

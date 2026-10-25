import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-workbench',
  name: '交互式实验',
  description: '交互式实验，固定课程、实际文件检查和所有者自学记录。',
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
    pin('learning-exchange'),
  ],
  optional: [],
  systemDependencies: [],
  services: ['learningWorkbench'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    pages: ['learning-lab'],
    http: learningHttp('workbench'),
    routes: learningRoutes('workbench'),
  },
});

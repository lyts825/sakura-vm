import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { learningRoutes, learningHttp } from '../../shared/contracts/learning-routes.generated.ts';
export const manifest = definePlugin({
  id: 'learning-assets',
  name: '课件与镜像',
  description: '课件与镜像，固定课程、实际文件检查和所有者自学记录。',
  category: 'development',
  experimental: true,
  requires: [pin('learning-courses')],
  optional: [],
  systemDependencies: ['imageAssets'],
  services: ['learningAssets'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: learningHttp('assets'),
    routes: learningRoutes('assets'),
  },
});

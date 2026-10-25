import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { mediaRoutes, mediaHttp } from '../../shared/contracts/media-routes.generated.ts';
export const manifest = definePlugin({
  id: 'media-workbench',
  name: '媒体制作工作台',
  description: '固定媒体材料与配方，在专用副本解码、处理、核验并审阅交付。',
  category: 'development',
  experimental: true,
  requires: [
    pin('media-sources'),
    pin('media-inspect'),
    pin('media-recipes'),
    pin('media-workers'),
    pin('media-captions'),
    pin('media-collections'),
    pin('media-reviews'),
    pin('media-exchange'),
  ],
  optional: [],
  services: ['mediaWorkbench'],
  contributes: {
    pages: ['media-studio'],
    tabs: [],
    developmentSections: [],
    managed: [],
    http: mediaHttp('workbench'),
    routes: mediaRoutes('workbench'),
  },
});

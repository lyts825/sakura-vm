import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { mediaRoutes, mediaHttp } from '../../shared/contracts/media-routes.generated.ts';
export const manifest = definePlugin({
  id: 'media-recipes',
  name: '固定媒体配方',
  description: '固定媒体材料与配方，在专用副本解码、处理、核验并审阅交付。',
  category: 'development',
  experimental: true,
  requires: [pin('media-sources'), pin('media-inspect')],
  optional: [],
  services: ['mediaRecipes'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: mediaHttp('recipes'),
    routes: mediaRoutes('recipes'),
  },
});

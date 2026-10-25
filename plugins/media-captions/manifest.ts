import { definePlugin, pin } from '../../shared/plugin-protocol.ts';
import { mediaRoutes, mediaHttp } from '../../shared/contracts/media-routes.generated.ts';
export const manifest = definePlugin({
  id: 'media-captions',
  name: '手工字幕',
  description: '固定媒体材料与配方，在专用副本解码、处理、核验并审阅交付。',
  category: 'development',
  experimental: true,
  requires: [pin('media-sources'), pin('media-workers')],
  optional: [],
  services: ['mediaCaptions'],
  contributes: {
    tabs: [],
    developmentSections: [],
    managed: [],
    http: mediaHttp('captions'),
    routes: mediaRoutes('captions'),
  },
});

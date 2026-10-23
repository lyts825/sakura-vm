/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-transforms',
  name: 'SQL 变换',
  description: 'SQL 变换：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-runtime'), pin('data-datasets'), pin('delivery-artifacts')],
  services: ['dataTransforms'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-transforms'],
    http: [http('/api/data-transforms', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-transforms'),
  },
});

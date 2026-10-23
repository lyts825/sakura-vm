/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-datasets',
  name: '数据版本',
  description: '数据版本：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-runtime'), pin('data-sources'), pin('delivery-artifacts')],
  services: ['dataDatasets'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-datasets'],
    http: [http('/api/data-datasets', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-datasets'),
  },
});

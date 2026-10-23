/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-exchange',
  name: '数据交接',
  description: '数据交接：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-datasets'), pin('delivery-artifacts')],
  optional: [pin('data-runtime'), pin('data-lineage')],
  services: ['dataExchange'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-exchange'],
    http: [http('/api/data-exchange', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-exchange'),
  },
});

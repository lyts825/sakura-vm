/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-sources',
  name: '数据来源',
  description: '数据来源：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('projects'), pin('delivery-artifacts')],
  services: ['dataSources'],
  optional: [pin('secrets')],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-sources'],
    http: [http('/api/data-sources', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-sources'),
  },
});

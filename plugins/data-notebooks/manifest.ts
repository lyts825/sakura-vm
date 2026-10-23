/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-notebooks',
  name: 'Notebook',
  description: 'Notebook：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-runtime'), pin('data-datasets'), pin('delivery-artifacts'), pin('projects')],
  services: ['dataNotebooks'],
  systemDependencies: ['imageAssets', 'notebookEnvironmentsV2'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-notebooks'],
    http: [http('/api/data-notebooks', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-notebooks'),
  },
});

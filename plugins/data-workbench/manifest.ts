/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-workbench',
  name: '数据工作台',
  description: '数据工作台：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [
    pin('data-runtime'),
    pin('data-sources'),
    pin('data-datasets'),
    pin('data-transforms'),
    pin('data-quality'),
    pin('data-notebooks'),
    pin('data-experiments'),
    pin('data-lineage'),
    pin('data-exchange'),
    pin('delivery-artifacts'),
  ],
  services: ['dataWorkbench'],
  contributes: {
    pages: ['data-lab'],
    tabs: ['development'],
    developmentSections: ['data-workbench'],
    http: [http('/api/data-workbench', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-workbench'),
  },
});

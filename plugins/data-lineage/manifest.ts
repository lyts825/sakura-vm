/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-lineage',
  name: '血缘与比较',
  description: '血缘与比较：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [
    pin('data-datasets'),
    pin('data-transforms'),
    pin('data-quality'),
    pin('data-notebooks'),
    pin('data-runtime'),
  ],
  services: ['dataLineage'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-lineage'],
    http: [http('/api/data-lineage', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-lineage'),
  },
});

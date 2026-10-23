/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-experiments',
  name: '参数实验',
  description: '参数实验：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-transforms'), pin('data-notebooks')],
  services: ['dataExperiments'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-experiments'],
    http: [http('/api/data-experiments', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-experiments'),
  },
});

/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-quality',
  name: '质量验证',
  description: '质量验证：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('data-runtime'), pin('data-datasets'), pin('delivery-artifacts')],
  services: ['dataQuality'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-quality'],
    http: [http('/api/data-quality', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/data-quality'),
  },
});

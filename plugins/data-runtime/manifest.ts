/** 数据插件的能力、依赖与所有者准入。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'data-runtime',
  name: '数据环境',
  description: '数据环境：固定输入、明确预算、独立回执。',
  category: 'development',
  requires: [pin('projects'), pin('delivery-artifacts')],
  services: ['dataRuntime'],
  systemDependencies: ['imageAssets'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['data-runtime'],
    http: [http('/api/data-runtime', ['GET', 'POST'])],
    managed: ['jobs', 'job-retry'],
    routes: ownerDomainRoutes('/api/data-runtime'),
  },
});

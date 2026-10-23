/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-packages',
  name: '应用安装制品',
  description: '应用安装制品及可核验的运行记录。',
  category: 'operations',
  requires: [],
  optional: [pin('delivery-releases'), pin('delivery-artifacts')],
  services: ['appPackages'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-packages'],
    http: [http('/api/app-packages', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-packages'),
  },
});

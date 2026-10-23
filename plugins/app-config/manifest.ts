/** 应用领域插件的显式依赖、所有者路由与生命周期贡献。 */
import { definePlugin, pin, http, ownerDomainRoutes } from '../../shared/plugin-protocol.ts';
export const manifest = definePlugin({
  id: 'app-config',
  name: '应用配置',
  description: '应用配置及可核验的运行记录。',
  category: 'operations',
  requires: [pin('app-targets'), pin('secrets')],
  services: ['appConfig'],
  contributes: {
    tabs: ['development'],
    developmentSections: ['app-config'],
    http: [http('/api/app-config', ['GET', 'POST'])],
    routes: ownerDomainRoutes('/api/app-config'),
  },
});

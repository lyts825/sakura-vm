import { definePlugin, pin, http } from '../../shared/plugin-protocol.ts';

export const manifest = definePlugin({
  id: 'secrets',
  name: '私密配置',
  description: '主机私密配置存储与项目环境变量引用。',
  category: 'operations',
  optional: [pin('projects')],
  services: ['secrets'],
  contributes: {
    http: [
      http('/api/vms/:vmId/secrets', ['GET', 'PUT', 'DELETE'], true),
      http('/api/vms/:vmId/secret-rotation', ['GET', 'PATCH'], true),
    ],
    tabs: ['development'],
    developmentSections: ['secrets'],
  },
});
